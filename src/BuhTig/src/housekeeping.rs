//! In-app housekeeping (FR-DB-08): every hour, BuhTig deletes the rows that have outlived
//! their use, so that every table stays bounded (SRS §5.3) with no separate worker or
//! scheduler (CON-06).
//!
//! A pass is one transaction that holds an advisory lock, so that when several BuhTig
//! processes share the database (A-07), one of them does the work and the others skip
//! that pass. Each delete would be correct without the lock too: it is one statement,
//! which decides what to delete from a single snapshot, and READ COMMITTED rechecks any
//! row that another transaction changed in the meantime, so a row used again is kept.
//! The lock saves the duplicate work, and keeps two passes from locking the same rows in
//! different orders.
//!
//! Ages are measured with BuhTig's own clock, which also writes the timestamps. A pass
//! that fails is logged and tried again an hour later.

use std::time::Duration;

use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
use sea_orm::sea_query::prelude::chrono::{DateTime, TimeDelta};
use sea_orm::sea_query::{Expr, ExprTrait, Func, Order, Query, WindowStatement};
use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, DbErr, DeleteMany, EntityTrait, IsolationLevel,
    QueryFilter, TransactionTrait,
};
use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;
use tracing::{debug, error, info};

use crate::db;
use crate::entity::{cache_entry, history_entry, session};

/// FR-DB-08: at least hourly.
const INTERVAL: Duration = Duration::from_secs(60 * 60);

/// What housekeeping needs from the config file.
pub struct Settings {
    pub session_idle_timeout: Duration,
    pub session_max_age: Duration,
    pub cache_retention: Duration,
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Deleted {
        sessions: u64,
        cache_entries: u64,
        history_entries: u64,
    },
    /// Another BuhTig process is doing housekeeping.
    Skipped,
}

/// Runs a pass now, and then every hour.
pub fn spawn(db: DatabaseConnection, settings: Settings) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(INTERVAL);
        // A pass that starts late, for example after the machine slept, does not bring
        // on more passes to catch up.
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            report(run(&db, &settings, ChronoUtc::now()).await);
        }
    })
}

/// Logs how a pass ended. A pass that deleted nothing is logged only for debugging,
/// rather than add a line every hour.
fn report(result: Result<Outcome, DbErr>) {
    match result {
        Ok(Outcome::Deleted {
            sessions,
            cache_entries,
            history_entries,
        }) => {
            if sessions + cache_entries + history_entries > 0 {
                info!(
                    sessions,
                    cache_entries, history_entries, "housekeeping finished"
                );
            } else {
                debug!(
                    sessions,
                    cache_entries, history_entries, "housekeeping finished"
                );
            }
        }
        Ok(Outcome::Skipped) => {
            debug!("housekeeping skipped: another BuhTig process is running it");
        }
        Err(error) => error!("housekeeping failed: {error}"),
    }
}

/// One pass, as of `now`.
pub async fn run(
    db: &DatabaseConnection,
    settings: &Settings,
    now: DateTimeUtc,
) -> Result<Outcome, DbErr> {
    // READ COMMITTED, whatever the database's default: a row that another transaction
    // changes during the pass must be rechecked, rather than fail the pass.
    let txn = db
        .begin_with_config(Some(IsolationLevel::ReadCommitted), None)
        .await?;
    if !db::try_lock(&txn, db::HOUSEKEEPING_LOCK).await? {
        return Ok(Outcome::Skipped);
    }

    // In the order that `entity::schema` registers the tables, so that row locks are
    // always taken in the same order.
    let sessions = expired_sessions(now, settings)
        .exec(&txn)
        .await?
        .rows_affected;
    let cache_entries = match old_cache_entries(now, settings) {
        Some(delete) => delete.exec(&txn).await?.rows_affected,
        None => 0,
    };
    let history_entries = surplus_history().exec(&txn).await?.rows_affected;
    txn.commit().await?;
    Ok(Outcome::Deleted {
        sessions,
        cache_entries,
        history_entries,
    })
}

/// Sessions that have ended (FR-AUTH-06): past their `expires_at`, or ended by the
/// current settings, which may have been shortened since the session began.
fn expired_sessions(now: DateTimeUtc, settings: &Settings) -> DeleteMany<session::Entity> {
    session::Entity::delete_many().filter(
        Condition::any()
            .add(session::Column::ExpiresAt.lte(now))
            .add_option(
                cutoff(now, settings.session_idle_timeout)
                    .map(|cutoff| session::Column::LastUsedAt.lte(cutoff)),
            )
            .add_option(
                cutoff(now, settings.session_max_age)
                    .map(|cutoff| session::Column::CreatedAt.lte(cutoff)),
            ),
    )
}

/// Cache entries fetched more than `cache.retention` ago (FR-DATA-12), or `None` if
/// that is before anything can have been stored.
fn old_cache_entries(
    now: DateTimeUtc,
    settings: &Settings,
) -> Option<DeleteMany<cache_entry::Entity>> {
    let cutoff = cutoff(now, settings.cache_retention)?;
    Some(cache_entry::Entity::delete_many().filter(cache_entry::Column::FetchedAt.lt(cutoff)))
}

/// History entries beyond each user's [`history_entry::KEPT_PER_USER`] newest.
///
/// They are matched on `last_viewed_at` as well as `id`, so that an entry the user views
/// again during the pass no longer matches, and is kept.
fn surplus_history() -> DeleteMany<history_entry::Entity> {
    use history_entry::Column;

    let ranked = Query::select()
        .columns([Column::Id, Column::LastViewedAt])
        .expr_window_as(
            Func::cust("row_number"),
            WindowStatement::partition_by(Column::UserId)
                .order_by(Column::LastViewedAt, Order::Desc)
                .order_by(Column::Id, Order::Desc)
                .take(),
            "newness",
        )
        .from(history_entry::Entity)
        .take();
    // Qualified with the subquery's name: `history_entries` here would name the row
    // being deleted, which always matches itself.
    let surplus = Query::select()
        .columns([("ranked", Column::Id), ("ranked", Column::LastViewedAt)])
        .from_subquery(ranked, "ranked")
        .and_where(Expr::col(("ranked", "newness")).gt(history_entry::KEPT_PER_USER))
        .take();
    history_entry::Entity::delete_many().filter(
        Expr::tuple([Expr::col(Column::Id), Expr::col(Column::LastViewedAt)]).in_subquery(surplus),
    )
}

/// The time `age` before `now`, or `None` if that is before 1970. Nothing BuhTig stores
/// is that old, and a long enough setting, such as `"2500000d"`, would otherwise give a
/// time that PostgreSQL cannot store.
fn cutoff(now: DateTimeUtc, age: Duration) -> Option<DateTimeUtc> {
    TimeDelta::from_std(age)
        .ok()
        .and_then(|age| now.checked_sub_signed(age))
        .filter(|cutoff| *cutoff >= DateTime::UNIX_EPOCH)
}

#[cfg(test)]
mod tests {
    use sea_orm::{DbBackend, QueryTrait};

    use super::*;

    const DAY: u64 = 24 * 60 * 60;

    fn now() -> DateTimeUtc {
        "2026-10-20T12:00:00Z".parse().unwrap()
    }

    fn settings() -> Settings {
        Settings {
            session_idle_timeout: Duration::from_secs(7 * DAY),
            session_max_age: Duration::from_secs(30 * DAY),
            cache_retention: Duration::from_secs(30 * DAY),
        }
    }

    fn sql<E: EntityTrait>(delete: DeleteMany<E>) -> String {
        delete.build(DbBackend::Postgres).to_string()
    }

    #[test]
    fn cutoffs_are_ages_before_now() {
        assert_eq!(
            cutoff(now(), Duration::from_secs(30 * DAY)),
            Some("2026-09-20T12:00:00Z".parse().unwrap())
        );
        assert_eq!(
            cutoff(now(), Duration::from_secs(56 * 365 * DAY)),
            Some("1970-11-03T12:00:00Z".parse().unwrap())
        );
    }

    #[test]
    fn cutoffs_before_1970_match_nothing() {
        for age in [
            Duration::from_secs(57 * 365 * DAY),
            // Representable by chrono, but before the earliest time PostgreSQL stores.
            Duration::from_secs(2_500_000 * DAY),
            // Beyond chrono's range of dates.
            Duration::from_secs(999_999 * 365 * DAY),
            // Beyond chrono's range of durations.
            Duration::MAX,
        ] {
            assert_eq!(cutoff(now(), age), None, "{age:?}");
        }
    }

    #[test]
    fn sessions_end_by_expiry_idleness_or_age() {
        assert_eq!(
            sql(expired_sessions(now(), &settings())),
            r#"DELETE FROM "sessions" WHERE "sessions"."expires_at" <= '2026-10-20 12:00:00.000000 +00:00' OR "sessions"."last_used_at" <= '2026-10-13 12:00:00.000000 +00:00' OR "sessions"."created_at" <= '2026-09-20 12:00:00.000000 +00:00'"#
        );
        let endless = Settings {
            session_idle_timeout: Duration::MAX,
            session_max_age: Duration::MAX,
            ..settings()
        };
        assert_eq!(
            sql(expired_sessions(now(), &endless)),
            r#"DELETE FROM "sessions" WHERE "sessions"."expires_at" <= '2026-10-20 12:00:00.000000 +00:00'"#
        );
    }

    #[test]
    fn cache_entries_are_deleted_by_when_they_were_fetched() {
        assert_eq!(
            sql(old_cache_entries(now(), &settings()).unwrap()),
            r#"DELETE FROM "cache_entries" WHERE "cache_entries"."fetched_at" < '2026-09-20 12:00:00.000000 +00:00'"#
        );
        let forever = Settings {
            cache_retention: Duration::MAX,
            ..settings()
        };
        assert!(old_cache_entries(now(), &forever).is_none());
    }

    #[test]
    fn history_beyond_the_newest_20_per_user_is_deleted() {
        assert_eq!(
            sql(surplus_history()),
            r#"DELETE FROM "history_entries" WHERE ("id", "last_viewed_at") IN (SELECT "ranked"."id", "ranked"."last_viewed_at" FROM (SELECT "id", "last_viewed_at", row_number() OVER ( PARTITION BY "user_id" ORDER BY "last_viewed_at" DESC, "id" DESC ) AS "newness" FROM "history_entries") AS "ranked" WHERE "ranked"."newness" > 20)"#
        );
    }
}
