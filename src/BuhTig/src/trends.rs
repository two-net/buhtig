//! How a repository's stat cards' figures changed (FR-REPO-17): what BuhTig observed of
//! them as dashboards were opened (FR-DATA-13), and the changes over the periods a
//! dashboard compares, where those observations allow (FR-DATA-14).
//!
//! Observations are made only of what GitHub gives anyway when a repository's dashboard is
//! opened, never by crawling it, so they are as sparse as the views: a repository nobody
//! opens has none. A scope keeps one a day of each repository, the latest, for
//! [`KEPT_DAYS`]. What was not observed is told as such, as gaps: never as zero, never filled
//! in from the observations either side, and the first observation is never taken for one
//! from before it.
//!
//! Each observation belongs to the scope that the data it was made of was cached in
//! (FR-DATA-04), and is told only within that scope, to a viewer who may see the repository
//! now (FR-ACC-07). One made with a PAT goes with the PAT (FR-PAT-05), and with the user
//! (DR-04).

use sea_orm::entity::prelude::{Date, DateTimeUtc};
use sea_orm::sea_query::prelude::chrono::TimeDelta;
use sea_orm::sea_query::{Expr, ExprTrait, LockType, OnConflict};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbErr, EntityTrait, Insert, QueryFilter,
    QueryOrder, QuerySelect, Set, TransactionTrait,
};
use serde_json::{Value, json};

use crate::cache::{Source, iso};
use crate::entity::cache_entry::Scope;
use crate::entity::credential::{self, Kind, PatStatus};
use crate::entity::repository_observation::{self, Column, KEPT_DAYS, Model};
use crate::entity::user;

/// FR-REPO-17: the periods a dashboard compares, in days.
pub const PERIODS: [i64; 3] = [7, 30, 90];

/// The most observations told of a repository: one a day over [`KEPT_DAYS`], and the day
/// that the oldest of them is on.
const MOST: u64 = KEPT_DAYS.unsigned_abs() + 1;

/// What a repository's stat cards showed (FR-REPO-02).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Figures {
    pub stars: i64,
    pub forks: i64,
    /// Without the open pull requests, which GitHub counts as open issues too.
    pub open_issues: i64,
    pub open_pull_requests: i64,
}

/// An observation of a repository's figures, to be recorded.
#[derive(Clone, Debug, PartialEq)]
pub struct Observation {
    /// Whose the data it is made of is, and so it is (FR-DATA-04).
    pub source: Source,
    /// The repository's ID on GitHub.
    pub repository_id: i64,
    /// When GitHub gave or confirmed the repository: never the time of recording, so that
    /// recording what is still cached changes nothing.
    pub observed_at: DateTimeUtc,
    /// When GitHub gave or confirmed the count of open pull requests.
    pub pull_requests_observed_at: DateTimeUtc,
    pub figures: Figures,
}

/// Records `observation`, unless its scope already has one of the repository that day that
/// is as late (FR-DATA-13), and says whether it did. The latest of a day wins, and neither of
/// its times ever goes back, even with several processes recording at once (A-07).
///
/// One made with a PAT is recorded only while the PAT is the user's and valid, with its row
/// locked: either the PAT is marked invalid after, and this observation is deleted with the
/// rest of its data, or before, and it is not recorded (FR-PAT-07). Nor is one whose PAT is
/// gone (FR-PAT-05). The user's row is locked first, as deleting the user locks it before
/// their PAT's, so that neither waits for the other. Nothing is recorded in a user's scope
/// without a PAT, as the cache of an early build may hold, since it would then go with
/// neither (FR-DATA-14).
pub async fn record(db: &DatabaseConnection, observation: &Observation) -> Result<bool, DbErr> {
    let (user_id, pat) = match observation.source {
        Source {
            scope: Scope::Shared,
            pat: None,
        } => return Ok(upsert(observation).exec_without_returning(db).await? > 0),
        Source {
            scope: Scope::User(user_id),
            pat: Some(pat),
        } => (user_id, pat),
        // A PAT's data is never shared (FR-DATA-04), and a user's scope goes with its PAT.
        Source { .. } => return Ok(false),
    };
    let txn = db.begin().await?;
    let user = user::Entity::find_by_id(user_id)
        .lock(LockType::KeyShare)
        .one(&txn)
        .await?;
    if user.is_none() {
        return Ok(false);
    }
    let valid = credential::Entity::find_by_id(pat)
        .filter(credential::Column::UserId.eq(user_id))
        .filter(credential::Column::Kind.eq(Kind::Pat))
        .filter(credential::Column::Status.eq(PatStatus::Valid))
        .lock_shared()
        .one(&txn)
        .await?;
    if valid.is_none() {
        // Dropping the transaction rolls it back.
        return Ok(false);
    }
    let recorded = upsert(observation).exec_without_returning(&txn).await?;
    txn.commit().await?;
    Ok(recorded > 0)
}

/// The insert of `observation`, or else the update of that day's observation in its scope,
/// if it is later and goes back in neither of its times.
fn upsert(observation: &Observation) -> Insert<repository_observation::ActiveModel> {
    let Source { scope, pat } = observation.source;
    let Figures {
        stars,
        forks,
        open_issues,
        open_pull_requests,
    } = observation.figures;
    let row = repository_observation::ActiveModel {
        scope: Set(scope.key()),
        repository_id: Set(observation.repository_id),
        day: Set(observation.observed_at.date_naive()),
        user_id: Set(scope.user_id()),
        credential_id: Set(pat),
        observed_at: Set(observation.observed_at),
        pull_requests_observed_at: Set(observation.pull_requests_observed_at),
        stars: Set(stars),
        forks: Set(forks),
        open_issues: Set(open_issues),
        open_pull_requests: Set(open_pull_requests),
        ..Default::default()
    };
    let incoming = |column: Column| Expr::col(("excluded", column));
    let stored = |column: Column| Expr::col((repository_observation::Entity, column));
    let later = incoming(Column::ObservedAt)
        .gte(stored(Column::ObservedAt))
        .and(incoming(Column::PullRequestsObservedAt).gte(stored(Column::PullRequestsObservedAt)))
        .and(
            incoming(Column::ObservedAt)
                .gt(stored(Column::ObservedAt))
                .or(incoming(Column::PullRequestsObservedAt)
                    .gt(stored(Column::PullRequestsObservedAt))),
        );
    repository_observation::Entity::insert(row).on_conflict(
        OnConflict::columns([Column::Scope, Column::RepositoryId, Column::Day])
            .update_columns([
                Column::ObservedAt,
                Column::PullRequestsObservedAt,
                Column::Stars,
                Column::Forks,
                Column::OpenIssues,
                Column::OpenPullRequests,
            ])
            .action_and_where(later)
            .to_owned(),
    )
}

/// What was observed of the repository `repository_id` in `source`'s scope, with its PAT if
/// it has one, over the [`KEPT_DAYS`] before `now`, oldest first. The caller must have read
/// the repository for the viewer just now, so that they may see it (FR-DATA-14).
pub async fn read(
    db: &DatabaseConnection,
    source: Source,
    repository_id: i64,
    now: DateTimeUtc,
) -> Result<Vec<Model>, DbErr> {
    let pat = match source {
        Source {
            scope: Scope::Shared,
            pat: None,
        } => Column::CredentialId.is_null(),
        Source {
            scope: Scope::User(_),
            pat: Some(pat),
        } => Column::CredentialId.eq(pat),
        // As `record` records nothing for them.
        Source { .. } => return Ok(Vec::new()),
    };
    let mut observations = repository_observation::Entity::find()
        .filter(Column::Scope.eq(source.scope.key()))
        .filter(Column::RepositoryId.eq(repository_id))
        .filter(pat)
        .filter(Column::ObservedAt.gte(now - TimeDelta::days(KEPT_DAYS)))
        .order_by_desc(Column::ObservedAt)
        .limit(MOST)
        .all(db)
        .await?;
    observations.reverse();
    Ok(observations)
}

/// Deletes what was observed of the repository `repository_id` in `scope`, which may no
/// longer see it (FR-DATA-14).
pub async fn forget(
    db: &impl ConnectionTrait,
    scope: Scope,
    repository_id: i64,
) -> Result<u64, DbErr> {
    Ok(repository_observation::Entity::delete_many()
        .filter(Column::Scope.eq(scope.key()))
        .filter(Column::RepositoryId.eq(repository_id))
        .exec(db)
        .await?
        .rows_affected)
}

/// Deletes what was observed with the PAT `credential_id`, as when it is marked invalid
/// (FR-PAT-07), which keeps its row.
pub async fn forget_pat(db: &impl ConnectionTrait, credential_id: i64) -> Result<u64, DbErr> {
    Ok(repository_observation::Entity::delete_many()
        .filter(Column::CredentialId.eq(credential_id))
        .exec(db)
        .await?
        .rows_affected)
}

/// What the dashboard tells of `observations`, those of one repository in one scope oldest
/// first, as [`read`] gives them (FR-REPO-17):
///
/// ```json
/// {"scope": "shared" | "private", "kept_days": 90,
///  "tracking_since": "2026-10-12T09:30:00.000Z" | null,
///  "observations": [{"day": "2026-10-12", "observed_at": …, "pull_requests_observed_at": …,
///                    "stars": …, "forks": …, "open_issues": …, "open_pull_requests": …}, …],
///  "gaps": [{"from": "2026-10-13", "to": "2026-10-15"}, …],
///  "periods": [{"days": 7, …}, {"days": 30, …}, {"days": 90, …}]}
/// ```
///
/// `scope` is `private` for what was observed with the viewer's PAT, which only they are
/// told. `tracking_since` is when the oldest observation kept was made. `gaps` are the runs
/// of UTC days between the first observation and the latest without one. Each period is as
/// [`period`] tells it.
pub fn summarize(scope: Scope, observations: &[Model]) -> Value {
    json!({
        "scope": match scope {
            Scope::Shared => "shared",
            Scope::User(_) => "private",
        },
        "kept_days": KEPT_DAYS,
        "tracking_since": observations.first().map(|first| iso(first.observed_at)),
        "observations": observations.iter().map(observed).collect::<Vec<_>>(),
        "gaps": gaps(observations),
        "periods": PERIODS
            .iter()
            .map(|days| period(observations, *days))
            .collect::<Vec<_>>(),
    })
}

/// An observation, as [`summarize`] tells it.
fn observed(observation: &Model) -> Value {
    json!({
        "day": observation.day.to_string(),
        "observed_at": iso(observation.observed_at),
        "pull_requests_observed_at": iso(observation.pull_requests_observed_at),
        "stars": observation.stars,
        "forks": observation.forks,
        "open_issues": observation.open_issues,
        "open_pull_requests": observation.open_pull_requests,
    })
}

/// The change over `days` days to the latest observation, E, from the baseline B: the
/// observation nearest to `days` days before E, within a tenth of that, and at least a day,
/// either side, the earlier of two as near (FR-DATA-14):
///
/// ```json
/// {"days": 7, "target": …, "first_day": "2026-11-02", "observed_days": 5,
///  "supported": true, "from": B, "to": E,
///  "changes": {"stars": 12, "forks": -1, "open_issues": 3, "open_pull_requests": 0}}
/// ```
///
/// `target` is the time `days` days before E, and `first_day` its UTC day, or B's if that is
/// earlier: the period's days are those from it to E's, on `observed_days` of which there is
/// an observation.
/// Without a baseline, `supported` is false, with why as `reason`:
///
/// - `no_observations` when there are none, and nothing else is told;
/// - `first_observation` when E is the only one, so that there is no earlier one at all;
/// - `tracked_later` when the first observation is after the period's start, give or take;
/// - `no_observation_then` when there are observations before and after it, but none near.
fn period(observations: &[Model], days: i64) -> Value {
    let Some((latest, earlier)) = observations.split_last() else {
        return json!({ "days": days, "supported": false, "reason": "no_observations" });
    };
    let length = TimeDelta::days(days);
    let tolerance = TimeDelta::days(1).max(length / 10);
    let target = latest.observed_at - length;
    let baseline = earlier
        .iter()
        .map(|observation| ((observation.observed_at - target).abs(), observation))
        .filter(|(distance, _)| *distance <= tolerance)
        .min_by_key(|(distance, observation)| (*distance, observation.observed_at))
        .map(|(_, observation)| observation);
    // So that the period's days, as charted, include the baseline.
    let first_day = baseline.map_or(latest.day - length, |baseline| {
        std::cmp::min(baseline.day, latest.day - length)
    });
    let observed_days = observations
        .iter()
        .filter(|observation| observation.day >= first_day)
        .count();
    let mut told = json!({
        "days": days,
        "target": iso(target),
        "first_day": first_day.to_string(),
        "observed_days": observed_days,
    });
    let fields = told.as_object_mut().expect("an object");
    match baseline {
        Some(baseline) => {
            fields.insert("supported".into(), true.into());
            fields.insert("from".into(), observed(baseline));
            fields.insert("to".into(), observed(latest));
            fields.insert(
                "changes".into(),
                json!({
                    "stars": latest.stars - baseline.stars,
                    "forks": latest.forks - baseline.forks,
                    "open_issues": latest.open_issues - baseline.open_issues,
                    "open_pull_requests": latest.open_pull_requests - baseline.open_pull_requests,
                }),
            );
        }
        None => {
            let reason = match earlier.first() {
                None => "first_observation",
                Some(first) if first.observed_at > target + tolerance => "tracked_later",
                Some(_) => "no_observation_then",
            };
            fields.insert("supported".into(), false.into());
            fields.insert("reason".into(), reason.into());
        }
    }
    told
}

/// The runs of UTC days between the first observation and the last without one.
fn gaps(observations: &[Model]) -> Vec<Value> {
    observations
        .windows(2)
        .filter_map(|pair| {
            let (from, to) = (next(pair[0].day)?, previous(pair[1].day)?);
            (from <= to).then(|| json!({ "from": from.to_string(), "to": to.to_string() }))
        })
        .collect()
}

fn next(day: Date) -> Option<Date> {
    day.succ_opt()
}

fn previous(day: Date) -> Option<Date> {
    day.pred_opt()
}

#[cfg(test)]
mod tests {
    use sea_orm::ActiveModelTrait;
    use url::Url;

    use super::*;
    use crate::config::{DatabaseConfig, Secret};
    use crate::db;
    use crate::entity::user;
    use crate::test_cluster::cluster;

    /// An observation in the shared scope, at `at`, with `stars` and the other figures
    /// derived from it, so that each change tells which observations it was between.
    fn observation(at: &str, stars: i64) -> Model {
        let observed_at: DateTimeUtc = at.parse().unwrap();
        Model {
            id: 0,
            scope: Scope::Shared.key(),
            repository_id: 42,
            day: observed_at.date_naive(),
            user_id: None,
            credential_id: None,
            observed_at,
            pull_requests_observed_at: observed_at - TimeDelta::minutes(1),
            stars,
            forks: stars / 10,
            open_issues: 100 - stars / 2,
            open_pull_requests: 7,
        }
    }

    fn periods(observations: &[Model]) -> Vec<Value> {
        summarize(Scope::Shared, observations)["periods"]
            .as_array()
            .unwrap()
            .clone()
    }

    fn period_of(observations: &[Model], days: i64) -> Value {
        periods(observations)
            .into_iter()
            .find(|period| period["days"] == days)
            .unwrap()
    }

    #[test]
    fn nothing_observed_tells_nothing() {
        let summary = summarize(Scope::Shared, &[]);
        assert_eq!(
            summary,
            json!({
                "scope": "shared",
                "kept_days": 90,
                "tracking_since": null,
                "observations": [],
                "gaps": [],
                "periods": [
                    {"days": 7, "supported": false, "reason": "no_observations"},
                    {"days": 30, "supported": false, "reason": "no_observations"},
                    {"days": 90, "supported": false, "reason": "no_observations"},
                ],
            })
        );
    }

    #[test]
    fn a_first_observation_has_no_baseline() {
        let first = observation("2026-11-09T14:05:00Z", 120);
        let summary = summarize(Scope::User(3), std::slice::from_ref(&first));
        assert_eq!(summary["scope"], "private");
        assert_eq!(summary["tracking_since"], "2026-11-09T14:05:00.000Z");
        assert_eq!(
            summary["observations"],
            json!([{
                "day": "2026-11-09",
                "observed_at": "2026-11-09T14:05:00.000Z",
                "pull_requests_observed_at": "2026-11-09T14:04:00.000Z",
                "stars": 120, "forks": 12, "open_issues": 40, "open_pull_requests": 7,
            }])
        );
        assert_eq!(
            period_of(&[first], 7),
            json!({
                "days": 7, "target": "2026-11-02T14:05:00.000Z", "first_day": "2026-11-02",
                "observed_days": 1, "supported": false, "reason": "first_observation",
            })
        );
    }

    #[test]
    fn changes_are_between_the_recorded_values_at_their_times() {
        let observations = [
            observation("2026-11-02T10:00:00Z", 100),
            observation("2026-11-05T10:00:00Z", 104),
            observation("2026-11-09T09:00:00Z", 112),
        ];
        let week = period_of(&observations, 7);
        assert_eq!(week["supported"], true);
        assert_eq!(week["from"]["observed_at"], "2026-11-02T10:00:00.000Z");
        assert_eq!(week["to"]["observed_at"], "2026-11-09T09:00:00.000Z");
        assert_eq!(
            week["changes"],
            json!({"stars": 12, "forks": 1, "open_issues": -6, "open_pull_requests": 0})
        );
        assert_eq!(week["observed_days"], 3);
        assert_eq!(week["first_day"], "2026-11-02");
    }

    #[test]
    fn a_baseline_is_within_a_tenth_of_the_period_and_a_day_at_least() {
        let latest = "2026-11-09T12:00:00Z";
        // A week before is 2 November at noon, give or take a day.
        for (at, supported) in [
            ("2026-11-01T12:00:00Z", true),
            ("2026-11-01T11:59:59Z", false),
            ("2026-11-03T12:00:00Z", true),
            ("2026-11-03T12:00:01Z", false),
        ] {
            let observations = [observation(at, 1), observation(latest, 2)];
            assert_eq!(period_of(&observations, 7)["supported"], supported, "{at}");
        }
        // 30 days before is 10 October at noon, give or take 3 days.
        for (at, supported) in [
            ("2026-10-07T12:00:00Z", true),
            ("2026-10-07T11:59:59Z", false),
            ("2026-10-13T12:00:00Z", true),
            ("2026-10-13T12:00:01Z", false),
        ] {
            let observations = [observation(at, 1), observation(latest, 2)];
            assert_eq!(period_of(&observations, 30)["supported"], supported, "{at}");
        }
        // 90 days before is 11 August at noon, give or take 9 days.
        for (at, supported) in [
            ("2026-08-20T12:00:00Z", true),
            ("2026-08-20T12:00:01Z", false),
        ] {
            let observations = [observation(at, 1), observation(latest, 2)];
            assert_eq!(period_of(&observations, 90)["supported"], supported, "{at}");
        }
    }

    #[test]
    fn the_nearest_baseline_is_taken_and_the_earlier_of_two_as_near() {
        let observations = [
            observation("2026-11-01T18:00:00Z", 1),
            observation("2026-11-02T06:00:00Z", 2),
            observation("2026-11-02T18:00:00Z", 3),
            observation("2026-11-09T12:00:00Z", 10),
        ];
        // 6 hours either side of 2 November at noon.
        let week = period_of(&observations, 7);
        assert_eq!(week["from"]["observed_at"], "2026-11-02T06:00:00.000Z");
        assert_eq!(week["changes"]["stars"], 8);
    }

    #[test]
    fn changes_may_be_negative_and_are_never_clamped() {
        let observations = [
            observation("2026-11-02T12:00:00Z", 50),
            observation("2026-11-09T12:00:00Z", 20),
        ];
        assert_eq!(
            period_of(&observations, 7)["changes"],
            json!({"stars": -30, "forks": -3, "open_issues": 15, "open_pull_requests": 0})
        );
    }

    #[test]
    fn periods_without_a_baseline_say_why() {
        // Tracked for 5 days: too short for a week, let alone a month.
        let short = [
            observation("2026-11-04T12:00:00Z", 1),
            observation("2026-11-09T12:00:00Z", 2),
        ];
        assert_eq!(period_of(&short, 7)["reason"], "tracked_later");
        assert_eq!(period_of(&short, 30)["reason"], "tracked_later");
        // Tracked for long enough, but not observed around a week ago.
        let gap = [
            observation("2026-10-01T12:00:00Z", 1),
            observation("2026-11-06T12:00:00Z", 2),
            observation("2026-11-09T12:00:00Z", 3),
        ];
        let week = period_of(&gap, 7);
        assert_eq!(
            (&week["supported"], &week["reason"]),
            (&json!(false), &json!("no_observation_then"))
        );
        assert!(week.get("changes").is_none() && week.get("from").is_none());
        assert_eq!(period_of(&gap, 30)["reason"], "no_observation_then");
        assert_eq!(period_of(&gap, 90)["reason"], "tracked_later");
    }

    #[test]
    fn gaps_are_the_days_without_an_observation() {
        let observations = [
            observation("2026-11-01T12:00:00Z", 1),
            observation("2026-11-02T12:00:00Z", 2),
            observation("2026-11-06T23:59:59Z", 3),
            observation("2026-11-08T00:00:00Z", 4),
            observation("2026-11-09T12:00:00Z", 5),
        ];
        let summary = summarize(Scope::Shared, &observations);
        assert_eq!(
            summary["gaps"],
            json!([
                {"from": "2026-11-03", "to": "2026-11-05"},
                {"from": "2026-11-07", "to": "2026-11-07"},
            ])
        );
        // Each observation is told once, and no day without one is told as an observation.
        assert_eq!(summary["observations"].as_array().unwrap().len(), 5);
        // The week is from 2 November.
        assert_eq!(period_of(&observations, 7)["observed_days"], 4);
    }

    #[test]
    fn the_days_of_a_period_include_its_baseline() {
        // 30 days before is 10 October at noon: 8 October is within 3 days of it.
        let observations = [
            observation("2026-10-08T12:00:00Z", 1),
            observation("2026-10-12T12:00:00Z", 2),
            observation("2026-11-09T12:00:00Z", 3),
        ];
        let month = period_of(&observations, 30);
        assert_eq!(month["from"]["day"], "2026-10-08");
        assert_eq!(month["first_day"], "2026-10-08");
        assert_eq!(month["observed_days"], 3);
        // Without one, the period's days are its own.
        assert_eq!(period_of(&observations, 7)["first_day"], "2026-11-02");
    }

    #[test]
    fn the_period_is_counted_from_the_latest_observation() {
        let observations = [
            observation("2026-08-01T12:00:00Z", 1),
            observation("2026-10-31T12:00:00Z", 2),
            observation("2026-11-09T12:00:00Z", 3),
        ];
        let quarter = period_of(&observations, 90);
        assert_eq!(quarter["first_day"], "2026-08-11");
        assert_eq!(quarter["observed_days"], 2);
        // 1 August is 10 days before 11 August: further than 9.
        assert_eq!(quarter["reason"], "no_observation_then");
    }

    /// A database of its own, with Alice and Bob, who have each saved a PAT, as user and
    /// credential IDs.
    struct Setup {
        db: DatabaseConnection,
        alice: (i64, i64),
        bob: (i64, i64),
    }

    async fn setup() -> Setup {
        let cluster = cluster();
        let database = cluster.create_database();
        let db = db::connect(&DatabaseConfig {
            url: Secret::new(Url::parse(&cluster.url(&database)).unwrap()),
            max_connections: 5,
        })
        .await
        .unwrap();
        db::migrate(&db, crate::config::GITHUB_COM).await.unwrap();
        let mut users = Vec::new();
        for (github_id, login) in [(1, "alice"), (2, "bob")] {
            let user = user::ActiveModel {
                github_id: Set(github_id),
                login: Set(login.to_owned()),
                name: Set(None),
                avatar_url: Set(String::new()),
                created_at: Set(at("2026-11-01T00:00:00Z")),
                last_sign_in_at: Set(at("2026-11-01T00:00:00Z")),
                ..Default::default()
            }
            .insert(&db)
            .await
            .unwrap()
            .id;
            let pat = credential::ActiveModel {
                user_id: Set(user),
                kind: Set(Kind::Pat),
                encrypted_value: Set(vec![1, 2, 3]),
                status: Set(Some(PatStatus::Valid)),
                ..Default::default()
            }
            .insert(&db)
            .await
            .unwrap()
            .id;
            users.push((user, pat));
        }
        Setup {
            db,
            alice: users[0],
            bob: users[1],
        }
    }

    fn at(time: &str) -> DateTimeUtc {
        time.parse().unwrap()
    }

    const SHARED: Source = Source {
        scope: Scope::Shared,
        pat: None,
    };

    fn private((user, pat): (i64, i64)) -> Source {
        Source {
            scope: Scope::User(user),
            pat: Some(pat),
        }
    }

    /// An observation of the repository 42 in `source`'s scope, at `time`, with `stars`.
    fn made(source: Source, time: &str, stars: i64) -> Observation {
        Observation {
            source,
            repository_id: 42,
            observed_at: at(time),
            pull_requests_observed_at: at(time),
            figures: Figures {
                stars,
                forks: 2,
                open_issues: 3,
                open_pull_requests: 4,
            },
        }
    }

    impl Setup {
        async fn record(&self, observation: &Observation) -> bool {
            record(&self.db, observation).await.unwrap()
        }

        /// The stars and times of what `source`'s scope observed of the repository 42 by
        /// `now`, as [`read`] gives them.
        async fn read(&self, source: Source, now: &str) -> Vec<(i64, String)> {
            read(&self.db, source, 42, at(now))
                .await
                .unwrap()
                .into_iter()
                .map(|observation| (observation.stars, iso(observation.observed_at)))
                .collect()
        }
    }

    #[tokio::test]
    async fn a_scope_keeps_the_latest_observation_of_each_day() {
        let setup = setup().await;
        assert!(setup.record(&made(SHARED, "2026-11-09T10:00:00Z", 1)).await);
        // The same again, as when the figures are still cached: nothing changes.
        assert!(!setup.record(&made(SHARED, "2026-11-09T10:00:00Z", 1)).await);
        // A later one that day takes its place, and an earlier one does not.
        assert!(setup.record(&made(SHARED, "2026-11-09T18:00:00Z", 2)).await);
        assert!(!setup.record(&made(SHARED, "2026-11-09T12:00:00Z", 3)).await);
        // Nor does one whose pull requests were counted earlier, though the rest is later.
        let mut behind = made(SHARED, "2026-11-09T20:00:00Z", 4);
        behind.pull_requests_observed_at = at("2026-11-09T17:00:00Z");
        assert!(!setup.record(&behind).await);
        // The next day has one of its own.
        assert!(setup.record(&made(SHARED, "2026-11-10T00:00:00Z", 5)).await);
        assert_eq!(
            setup.read(SHARED, "2026-11-10T12:00:00Z").await,
            [
                (2, "2026-11-09T18:00:00.000Z".to_owned()),
                (5, "2026-11-10T00:00:00.000Z".to_owned()),
            ]
        );
    }

    #[tokio::test]
    async fn each_scope_is_told_only_what_it_observed() {
        let setup = setup().await;
        let (alice, bob) = (private(setup.alice), private(setup.bob));
        for (source, stars) in [(SHARED, 1), (alice, 2), (bob, 3)] {
            assert!(
                setup
                    .record(&made(source, "2026-11-09T10:00:00Z", stars))
                    .await
            );
        }
        let now = "2026-11-09T12:00:00Z";
        let observed = |stars: i64| vec![(stars, "2026-11-09T10:00:00.000Z".to_owned())];
        assert_eq!(setup.read(SHARED, now).await, observed(1));
        assert_eq!(setup.read(alice, now).await, observed(2));
        assert_eq!(setup.read(bob, now).await, observed(3));
        // Alice's scope with another PAT than the one that observed is told nothing.
        let other = Source {
            pat: Some(setup.bob.1),
            ..alice
        };
        assert_eq!(setup.read(other, now).await, []);
        // Nor is another repository's.
        assert!(
            read(&setup.db, alice, 43, at(now))
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn only_a_valid_pat_of_the_scopes_user_records() {
        let setup = setup().await;
        let alice = private(setup.alice);
        // A PAT that is not Alice's, nor anyone's, nor any in a shared scope.
        for source in [
            Source {
                pat: Some(setup.bob.1),
                ..alice
            },
            Source {
                pat: Some(999),
                ..alice
            },
            Source {
                scope: Scope::Shared,
                pat: Some(setup.alice.1),
            },
        ] {
            assert!(!setup.record(&made(source, "2026-11-09T10:00:00Z", 1)).await);
        }
        // Once marked invalid, hers records nothing either, and what it did is gone.
        assert!(setup.record(&made(alice, "2026-11-09T10:00:00Z", 1)).await);
        crate::tokens::invalidate(&setup.db, setup.alice.1)
            .await
            .unwrap();
        assert!(!setup.record(&made(alice, "2026-11-10T10:00:00Z", 2)).await);
        let rows = repository_observation::Entity::find()
            .all(&setup.db)
            .await
            .unwrap();
        assert!(rows.is_empty(), "{rows:?}");
    }

    #[tokio::test]
    async fn a_users_scope_without_its_pat_neither_records_nor_is_told() {
        let setup = setup().await;
        let without = Source {
            scope: Scope::User(setup.alice.0),
            pat: None,
        };
        assert!(
            !setup
                .record(&made(without, "2026-11-09T10:00:00Z", 1))
                .await
        );
        // Nor is it told one that has no PAT, such as one made before PATs were kept apart.
        repository_observation::ActiveModel {
            scope: Set(without.scope.key()),
            repository_id: Set(42),
            day: Set(at("2026-11-09T10:00:00Z").date_naive()),
            user_id: Set(Some(setup.alice.0)),
            credential_id: Set(None),
            observed_at: Set(at("2026-11-09T10:00:00Z")),
            pull_requests_observed_at: Set(at("2026-11-09T10:00:00Z")),
            stars: Set(1),
            forks: Set(1),
            open_issues: Set(1),
            open_pull_requests: Set(1),
            ..Default::default()
        }
        .insert(&setup.db)
        .await
        .unwrap();
        assert_eq!(setup.read(without, "2026-11-09T12:00:00Z").await, []);
    }

    #[tokio::test]
    async fn what_was_observed_90_days_ago_or_more_is_not_told() {
        let setup = setup().await;
        for (time, stars) in [
            ("2026-08-11T11:59:59Z", 1),
            ("2026-08-11T12:00:00Z", 2),
            ("2026-11-09T12:00:00Z", 3),
        ] {
            assert!(setup.record(&made(SHARED, time, stars)).await);
        }
        let stars: Vec<i64> = setup
            .read(SHARED, "2026-11-09T12:00:00Z")
            .await
            .into_iter()
            .map(|(stars, _)| stars)
            .collect();
        assert_eq!(stars, [2, 3]);
    }

    #[tokio::test]
    async fn forgetting_is_by_scope_and_repository_or_by_pat() {
        let setup = setup().await;
        let (alice, bob) = (private(setup.alice), private(setup.bob));
        for source in [SHARED, alice, bob] {
            assert!(setup.record(&made(source, "2026-11-09T10:00:00Z", 1)).await);
            let mut other = made(source, "2026-11-09T10:00:00Z", 1);
            other.repository_id = 43;
            assert!(setup.record(&other).await);
        }
        assert_eq!(forget(&setup.db, alice.scope, 42).await.unwrap(), 1);
        assert_eq!(forget_pat(&setup.db, setup.bob.1).await.unwrap(), 2);
        let left: Vec<(String, i64)> = repository_observation::Entity::find()
            .order_by_asc(Column::Id)
            .all(&setup.db)
            .await
            .unwrap()
            .into_iter()
            .map(|observation| (observation.scope, observation.repository_id))
            .collect();
        assert_eq!(
            left,
            [
                (Scope::Shared.key(), 42),
                (Scope::Shared.key(), 43),
                (alice.scope.key(), 43),
            ]
        );
    }
}
