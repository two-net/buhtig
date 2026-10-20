//! Starts the real binary against databases with rows to clean up, to check in-app
//! housekeeping (FR-DB-08, FR-DATA-12, A-07).

mod support;

use std::path::PathBuf;
use std::process::Child;
use std::time::{Duration, Instant};

use support::{Cluster, Running, cluster, minimal_config, start, write_config};
use tempfile::TempDir;

// How a pass ends. sqlx logs every statement at debug level, so these include the target.
const FINISHED: &str = "BuhTig::housekeeping: housekeeping finished";
const SKIPPED: &str = "BuhTig::housekeeping: housekeeping skipped";
const FAILED: &str = "BuhTig::housekeeping: housekeeping failed";

/// `db::HOUSEKEEPING_LOCK`, "BuhTigH" in ASCII.
const HOUSEKEEPING_LOCK: i64 = 0x42_7568_5469_6748;

/// What a pass deleted.
#[derive(Debug, Default, PartialEq)]
struct Deleted {
    sessions: u64,
    cache_entries: u64,
    history_entries: u64,
}

/// A database with BuhTig's schema, and a config file for it that logs at debug level, so
/// that every pass logs how it ended.
struct Setup {
    cluster: &'static Cluster,
    database: String,
    config: PathBuf,
    _dir: TempDir,
}

/// `settings` are added to the config file, such as an `[auth]` section.
fn setup(settings: &str) -> Setup {
    let cluster = cluster();
    let database = cluster.create_database();
    let dir = tempfile::tempdir().unwrap();
    let contents = format!(
        "{}{settings}\n[log]\nlevel = \"debug\"\n",
        minimal_config(&cluster.url(&database))
    );
    let config = write_config(&dir, &contents, 0o600);
    let db = Setup {
        cluster,
        database,
        config,
        _dir: dir,
    };
    // Creates the schema. Its pass is waited for: a process killed in the middle of one
    // may hold the lock for a moment after.
    let (running, _) = start(&db.config);
    assert_eq!(pass(&running), Some(Deleted::default()));
    db
}

impl Setup {
    fn psql(&self, sql: &str) -> String {
        self.cluster.psql(&self.database, sql)
    }

    /// The ids of one user's history entries.
    fn history(&self, user: i64) -> String {
        self.psql(&format!(
            "SELECT string_agg(id::text, ' ' ORDER BY id) FROM history_entries \
             WHERE user_id = {user}"
        ))
    }

    /// Everything a pass may delete, and the rows it must not touch.
    fn rows(&self) -> String {
        self.psql(
            "SELECT string_agg(encode(id_hash, 'hex'), ' ' ORDER BY id_hash) FROM sessions;
             SELECT string_agg(id::text, ' ' ORDER BY id) FROM cache_entries;
             SELECT string_agg(id::text, ' ' ORDER BY id) FROM history_entries;
             SELECT count(*) FROM users;
             SELECT count(*) FROM pins;",
        )
    }
}

/// Waits for the pass that BuhTig runs as it starts, and returns what it deleted, or
/// `None` if it was skipped.
fn pass(running: &Running) -> Option<Deleted> {
    let line = running.wait_for(&[FINISHED, SKIPPED, FAILED]);
    assert!(!line.contains(FAILED), "{line}");
    if line.contains(SKIPPED) {
        return None;
    }
    let count = |field: &str| {
        line.split(' ')
            .find_map(|word| word.strip_prefix(field)?.strip_prefix('='))
            .and_then(|count| count.parse().ok())
            .unwrap_or_else(|| panic!("no {field} count in {line:?}"))
    };
    Some(Deleted {
        sessions: count("sessions"),
        cache_entries: count("cache_entries"),
        history_entries: count("history_entries"),
    })
}

fn ids(ids: impl IntoIterator<Item = i64>) -> String {
    ids.into_iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Rows for the default settings, a day or an hour on either side of each limit. What
/// [`assert_cleaned_up`] expects is noted against each.
fn seed(db: &Setup) {
    db.psql(
        r#"
        INSERT INTO users (id, github_id, login, avatar_url, created_at, last_sign_in_at)
            VALUES (1, 101, 'alice', '', now(), now()), (2, 102, 'bob', '', now(), now());

        INSERT INTO sessions (id_hash, user_id, created_at, last_used_at, expires_at) VALUES
            -- Kept: used 6 days ago, and 29 days old.
            ('\x01', 1, now() - interval '29 days', now() - interval '6 days',
                now() + interval '1 day'),
            -- Past its expiry.
            ('\x02', 1, now() - interval '1 day', now() - interval '1 hour',
                now() - interval '1 hour'),
            -- Idle for longer than auth.session_idle_timeout (7 days).
            ('\x03', 1, now() - interval '8 days', now() - interval '7 days 1 hour',
                now() + interval '1 day'),
            -- Older than auth.session_max_age (30 days).
            ('\x04', 2, now() - interval '30 days 1 hour', now() - interval '1 hour',
                now() + interval '1 day');

        INSERT INTO cache_entries (id, scope, resource_key, user_id, data, fetched_at, expires_at)
        VALUES
            -- Kept: long expired, but stale data is still served when GitHub fails
            -- (FR-DATA-05), up to cache.retention (30 days).
            (1, 'shared', 'repo:a/b', NULL, '{}', now() - interval '29 days 23 hours',
                now() - interval '29 days'),
            (2, 'shared', 'repo:a/c', NULL, '{}', now() - interval '30 days 1 hour',
                now() - interval '30 days'),
            (3, 'user:1', 'repo:a/c', 1, '{}', now() - interval '30 days 1 hour',
                now() - interval '30 days');

        -- Alice viewed 25 dashboards, one an hour. 20 and 21 tie for 20th newest, and the
        -- higher id wins, so 20 and 22 to 25 go.
        INSERT INTO history_entries (id, user_id, resource_kind, resource_name, last_viewed_at)
            SELECT i, 1, 'repository', 'alice/repo-' || i,
                now() - make_interval(hours => CASE WHEN i = 21 THEN 20 ELSE i END)
            FROM generate_series(1, 25) AS i;
        -- Kept: Bob viewed exactly 20, however long ago.
        INSERT INTO history_entries (id, user_id, resource_kind, resource_name, last_viewed_at)
            SELECT 100 + i, 2, 'repository', 'bob/repo-' || i, now() - make_interval(days => i)
            FROM generate_series(1, 20) AS i;

        -- Kept, although the history entry for it goes.
        INSERT INTO pins (user_id, resource_kind, resource_name, position)
            VALUES (1, 'repository', 'alice/repo-25', 0);
        "#,
    );
}

/// What [`seed`]'s rows have been cleaned up to.
fn assert_cleaned_up(db: &Setup) {
    assert_eq!(
        db.psql("SELECT string_agg(encode(id_hash, 'hex'), ' ' ORDER BY id_hash) FROM sessions"),
        "01"
    );
    assert_eq!(
        db.psql("SELECT string_agg(id::text, ' ' ORDER BY id) FROM cache_entries"),
        "1"
    );
    assert_eq!(db.history(1), ids((1..=19).chain([21])));
    assert_eq!(db.history(2), ids(101..=120));
    assert_eq!(
        db.psql("SELECT (SELECT count(*) FROM users) || ' ' || (SELECT count(*) FROM pins)"),
        "2 1"
    );
}

const SEEDED: Deleted = Deleted {
    sessions: 3,
    cache_entries: 2,
    history_entries: 5,
};

#[test]
fn a_pass_at_startup_deletes_what_has_outlived_its_use() {
    let db = setup("");
    seed(&db);

    let (running, _) = start(&db.config);
    assert_eq!(pass(&running), Some(SEEDED));
    assert_cleaned_up(&db);
}

#[test]
fn cleanup_follows_the_configured_durations() {
    let db = setup(
        r#"
[auth]
session_idle_timeout = "1h"
session_max_age = "60d"

[cache]
retention = "2h"
"#,
    );
    db.psql(
        r#"
        INSERT INTO users (id, github_id, login, avatar_url, created_at, last_sign_in_at)
            VALUES (1, 101, 'alice', '', now(), now());
        INSERT INTO sessions (id_hash, user_id, created_at, last_used_at, expires_at) VALUES
            -- Idle for longer than 1 hour, though not 7 days.
            ('\x01', 1, now() - interval '2 hours', now() - interval '2 hours',
                now() + interval '1 day'),
            -- Kept: older than 30 days, but not 60.
            ('\x02', 1, now() - interval '45 days', now() - interval '10 minutes',
                now() + interval '1 day');
        INSERT INTO cache_entries (id, scope, resource_key, user_id, data, fetched_at, expires_at)
        VALUES
            -- Fetched more than 2 hours ago, though not 30 days.
            (1, 'shared', 'repo:a/b', NULL, '{}', now() - interval '3 hours', now()),
            -- Kept.
            (2, 'shared', 'repo:a/c', NULL, '{}', now() - interval '1 hour', now());
        "#,
    );

    let (running, _) = start(&db.config);
    assert_eq!(
        pass(&running),
        Some(Deleted {
            sessions: 1,
            cache_entries: 1,
            history_entries: 0,
        })
    );
    assert_eq!(
        db.psql(
            "SELECT string_agg(encode(id_hash, 'hex'), ' ') FROM sessions;
             SELECT string_agg(id::text, ' ') FROM cache_entries;"
        ),
        "02\n2"
    );
}

/// A-07: while another process does housekeeping, a pass deletes nothing.
#[test]
fn a_pass_is_skipped_while_another_process_holds_the_lock() {
    let db = setup("");
    seed(&db);
    let before = db.rows();

    let mut holder = hold_lock(&db);
    let (running, _) = start(&db.config);
    assert_eq!(pass(&running), None);
    assert_eq!(db.rows(), before);

    drop(running);
    let _ = holder.kill();
    let _ = holder.wait();
}

/// Holds the housekeeping lock from psql, until psql is killed.
fn hold_lock(db: &Setup) -> Child {
    let holder = db.cluster.spawn_psql(
        &db.database,
        &format!("SELECT pg_advisory_lock({HOUSEKEEPING_LOCK}); SELECT pg_sleep(60);"),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    while db.psql(
        "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted \
         AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
    ) != "1"
    {
        assert!(Instant::now() < deadline, "psql did not take the lock");
        std::thread::sleep(Duration::from_millis(20));
    }
    holder
}

/// A-07: processes that start together delete each row once between them, and no more.
#[test]
fn concurrent_processes_delete_each_row_once() {
    let db = setup("");
    seed(&db);

    let passes: Vec<Option<Deleted>> = std::thread::scope(|scope| {
        let starting: Vec<_> = (0..4)
            .map(|_| {
                scope.spawn(|| {
                    let (running, _) = start(&db.config);
                    pass(&running)
                })
            })
            .collect();
        starting
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect()
    });

    let total = passes
        .iter()
        .flatten()
        .fold(Deleted::default(), |total, pass| Deleted {
            sessions: total.sessions + pass.sessions,
            cache_entries: total.cache_entries + pass.cache_entries,
            history_entries: total.history_entries + pass.history_entries,
        });
    assert_eq!(total, SEEDED, "{passes:?}");
    assert_cleaned_up(&db);
}
