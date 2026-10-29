//! Starts the real binary against empty, older and newer databases to check automatic
//! migration (SRS §4.12, AC-06, NFR-MNT-02).

mod support;

use std::path::PathBuf;

use support::{
    Cluster, VERSION, cluster, minimal_config, run_to_exit, start, stdout, write_config,
};
use tempfile::TempDir;

/// A fresh database and a config file for it.
struct Setup {
    cluster: &'static Cluster,
    database: String,
    config: PathBuf,
    _dir: TempDir,
}

fn setup() -> Setup {
    let cluster = cluster();
    let database = cluster.create_database();
    setup_with(cluster, database.clone(), &cluster.url(&database))
}

fn setup_with(cluster: &'static Cluster, database: String, url: &str) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let config = write_config(&dir, &minimal_config(url), 0o600);
    Setup {
        cluster,
        database,
        config,
        _dir: dir,
    }
}

impl Setup {
    fn psql(&self, sql: &str) -> String {
        self.cluster.psql(&self.database, sql)
    }

    fn fingerprint(&self) -> String {
        self.cluster.fingerprint(&self.database)
    }

    /// Starts BuhTig once, so that it creates the schema, and stops it again.
    fn migrate(&self) {
        drop(start(&self.config));
    }
}

/// The schema that BuhTig creates in an empty database.
fn fresh_fingerprint() -> String {
    let fresh = setup();
    fresh.migrate();
    fresh.fingerprint()
}

fn assert_logged(log: &[String], message: &str) {
    assert!(
        log.iter().any(|line| line.contains(message)),
        "{message:?} not in {log:#?}"
    );
}

#[test]
fn first_start_creates_the_schema_and_a_restart_changes_nothing() {
    let db = setup();

    let (running, log) = start(&db.config);
    assert_logged(
        &log,
        &format!("created the database schema for BuhTig {VERSION}"),
    );
    let home = running.get("/");
    assert!(home.starts_with("HTTP/1.1 200 "), "{home}");
    drop(running);
    let created = db.fingerprint();
    assert_eq!(
        db.psql(
            "SELECT string_agg(table_name, ' ' ORDER BY table_name) \
             FROM information_schema.tables WHERE table_schema = 'public'"
        ),
        "cache_entries credentials history_entries pins schema_versions sessions users"
    );

    let (_running, log) = start(&db.config);
    assert_logged(
        &log,
        &format!("the database schema is up to date for BuhTig {VERSION}"),
    );
    assert_eq!(db.fingerprint(), created);
    assert_eq!(db.psql("SELECT version FROM schema_versions"), VERSION);
}

/// DR-06: every timestamp is stored in UTC.
#[test]
fn timestamps_carry_their_time_zone() {
    let db = setup();
    db.migrate();

    let types = db.psql(
        "SELECT DISTINCT data_type FROM information_schema.columns \
         WHERE table_schema = 'public' AND data_type LIKE 'timestamp%'",
    );
    assert_eq!(types, "timestamp with time zone");
}

/// NFR-MNT-02, FR-DB-04. The previous release had no schema yet, so the older schema
/// is simulated: the current one, with data, missing a table, a column and an index.
#[test]
fn upgrade_keeps_data_and_adds_what_is_missing() {
    let expected = fresh_fingerprint();
    let db = setup();
    db.migrate();
    db.psql(
        r#"
        INSERT INTO users (id, github_id, login, name, avatar_url, created_at, last_sign_in_at)
            VALUES (1, 583231, 'octocat', 'The Octocat', 'https://avatars.example/u/1', now(), now());
        INSERT INTO sessions (id_hash, user_id, created_at, last_used_at, expires_at)
            VALUES ('\x01', 1, now(), now(), now() + interval '7 days');
        INSERT INTO credentials (user_id, kind, encrypted_value, pat_type, last_four, status)
            VALUES (1, 'pat', '\x02', 'classic', 'abcd', 'valid');
        INSERT INTO history_entries (user_id, resource_kind, resource_name, last_viewed_at)
            VALUES (1, 'repository', 'octocat/Hello-World', now());
        INSERT INTO pins (user_id, resource_kind, resource_name, position)
            VALUES (1, 'organization', 'github', 0);

        UPDATE schema_versions SET version = '0.0.1';
        DROP TABLE cache_entries;
        ALTER TABLE users DROP COLUMN name;
        DROP INDEX "idx-pins-resource";
        DROP INDEX "idx-sessions-user_id";
        "#,
    );

    let (_running, log) = start(&db.config);
    assert_logged(
        &log,
        &format!("upgraded the database schema from BuhTig 0.0.1 to {VERSION}"),
    );
    assert_eq!(db.fingerprint(), expected);
    assert_eq!(
        db.psql(
            "SELECT login || ' ' || avatar_url FROM users;
             SELECT encode(id_hash, 'hex') FROM sessions;
             SELECT kind || ' ' || last_four FROM credentials;
             SELECT resource_name FROM history_entries;
             SELECT resource_name FROM pins;
             SELECT string_agg(version, ' ' ORDER BY applied_at) FROM schema_versions;"
        ),
        format!(
            "octocat https://avatars.example/u/1\n01\npat abcd\noctocat/Hello-World\ngithub\n0.0.1 {VERSION}"
        )
    );
}

/// FR-DB-06: processes that start together take turns, so only one creates the schema.
#[test]
fn concurrent_starts_migrate_one_at_a_time() {
    assert_concurrent_starts_take_turns(&setup());
}

/// FR-DB-06 again, where transactions would by default not see what others commit
/// after they start.
#[test]
fn concurrent_starts_take_turns_whatever_the_default_isolation() {
    let db = setup();
    db.cluster.psql(
        "postgres",
        &format!(
            "ALTER DATABASE {} SET default_transaction_isolation = 'serializable'",
            db.database
        ),
    );
    assert_concurrent_starts_take_turns(&db);
}

fn assert_concurrent_starts_take_turns(db: &Setup) {
    let expected = fresh_fingerprint();

    let started: Vec<_> = std::thread::scope(|scope| {
        let starting: Vec<_> = (0..4).map(|_| scope.spawn(|| start(&db.config))).collect();
        starting
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect()
    });

    let count = |message: &str| {
        started
            .iter()
            .filter(|(_, log)| log.iter().any(|line| line.contains(message)))
            .count()
    };
    assert_eq!(count("created the database schema"), 1);
    assert_eq!(count("the database schema is up to date"), 3);
    assert_eq!(db.psql("SELECT version FROM schema_versions"), VERSION);
    assert_eq!(db.fingerprint(), expected);
}

/// FR-DB-07: downgrades are not supported, and the schema is left alone.
#[test]
fn refuses_a_schema_from_a_newer_version() {
    let db = setup();
    db.migrate();
    // Missing a table, so that migrating anyway would show.
    db.psql(
        "INSERT INTO schema_versions (version, applied_at) VALUES ('999.0.0', now());
         DROP TABLE pins;",
    );
    let before = db.fingerprint();

    let output = run_to_exit(&db.config);
    assert_eq!(output.status.code(), Some(1));
    let log = stdout(&output);
    assert!(
        log.contains(&format!(
            "the database schema is from BuhTig 999.0.0, newer than this BuhTig {VERSION}; \
             downgrades are not supported"
        )),
        "{log}"
    );
    assert!(!log.contains("listening on"), "{log}");
    assert_eq!(db.fingerprint(), before);
}

/// FR-DB-05, A-05: the role in `database.url` must be allowed to create tables.
#[test]
fn a_role_that_cannot_create_tables_stops_startup() {
    let cluster = cluster();
    let database = cluster.create_database();
    let role = format!("reader_{database}");
    cluster.psql(
        "postgres",
        &format!("CREATE ROLE {role} LOGIN PASSWORD '{}'", support::PASSWORD),
    );
    let db = setup_with(
        cluster,
        database.clone(),
        &cluster.url_as(&database, &role, support::PASSWORD),
    );

    let output = run_to_exit(&db.config);
    assert_eq!(output.status.code(), Some(1));
    let log = stdout(&output);
    assert!(
        log.contains("database migration failed: ")
            && log.contains("permission denied for schema public"),
        "{log}"
    );
    assert!(!log.contains("listening on"), "{log}");
}

/// FR-DB-05: a migration that fails part-way leaves the schema as it was.
#[test]
fn a_failed_migration_changes_nothing() {
    let db = setup();
    // Creating `sessions` fails, after `schema_versions` and others have been created.
    db.psql("CREATE VIEW sessions AS SELECT 1 AS id");

    let output = run_to_exit(&db.config);
    assert_eq!(output.status.code(), Some(1));
    let log = stdout(&output);
    assert!(log.contains("database migration failed: "), "{log}");
    assert!(!log.contains("listening on"), "{log}");
    assert_eq!(
        db.psql(
            "SELECT string_agg(table_name || ' ' || table_type, ', ') \
             FROM information_schema.tables WHERE table_schema = 'public'"
        ),
        "sessions VIEW"
    );
}

/// DR-05, DR-04: the database enforces uniqueness and relationships itself, and
/// deleting a user deletes their data.
#[test]
fn the_database_enforces_uniqueness_and_relationships() {
    let db = setup();
    db.migrate();
    db.psql(
        r#"
        INSERT INTO users (id, github_id, login, avatar_url, created_at, last_sign_in_at)
            VALUES (1, 101, 'alice', '', now(), now()), (2, 102, 'bob', '', now(), now());
        INSERT INTO sessions (id_hash, user_id, created_at, last_used_at, expires_at)
            VALUES ('\x01', 1, now(), now(), now());
        INSERT INTO credentials (user_id, kind, encrypted_value)
            VALUES (1, 'sign_in', '\x01'), (1, 'pat', '\x02');
        INSERT INTO cache_entries (scope, resource_key, user_id, data, fetched_at, expires_at)
            VALUES ('shared', 'repo:owner/repo', NULL, '{}', now(), now()),
                   ('user:1', 'repo:owner/repo', 1, '{}', now(), now());
        INSERT INTO history_entries (user_id, resource_kind, resource_name, last_viewed_at)
            VALUES (1, 'repository', 'owner/repo', now());
        INSERT INTO pins (user_id, resource_kind, resource_name, position)
            VALUES (1, 'repository', 'owner/repo', 0), (2, 'repository', 'owner/repo', 0);
        "#,
    );

    for (sql, problem) in [
        (
            "INSERT INTO users (github_id, login, avatar_url, created_at, last_sign_in_at) \
             VALUES (101, 'alice-renamed', '', now(), now())",
            "duplicate key value violates unique constraint",
        ),
        (
            "INSERT INTO credentials (user_id, kind, encrypted_value) VALUES (1, 'pat', '\\x03')",
            "duplicate key value violates unique constraint",
        ),
        (
            "INSERT INTO cache_entries (scope, resource_key, data, fetched_at, expires_at) \
             VALUES ('shared', 'repo:owner/repo', '{}', now(), now())",
            "duplicate key value violates unique constraint",
        ),
        (
            "INSERT INTO history_entries (user_id, resource_kind, resource_name, last_viewed_at) \
             VALUES (1, 'repository', 'owner/repo', now())",
            "duplicate key value violates unique constraint",
        ),
        (
            "INSERT INTO pins (user_id, resource_kind, resource_name, position) \
             VALUES (1, 'repository', 'owner/repo', 1)",
            "duplicate key value violates unique constraint",
        ),
        (
            "INSERT INTO pins (user_id, resource_kind, resource_name, position) \
             VALUES (99, 'repository', 'owner/repo', 0)",
            "violates foreign key constraint",
        ),
    ] {
        let error = db.cluster.try_psql(&db.database, sql).unwrap_err();
        assert!(error.contains(problem), "{sql}: {error}");
    }

    db.psql("DELETE FROM users WHERE id = 1");
    assert_eq!(
        db.psql(
            "SELECT (SELECT count(*) FROM sessions) || ' ' || (SELECT count(*) FROM credentials)
                || ' ' || (SELECT string_agg(scope, ' ') FROM cache_entries)
                || ' ' || (SELECT count(*) FROM history_entries)
                || ' ' || (SELECT string_agg(user_id::text, ' ') FROM pins)"
        ),
        "0 0 shared 0 2"
    );
}
