//! A throwaway PostgreSQL cluster, shared by the integration tests and by BuhTig's own
//! unit tests, which include this file with `#[path]`. So it uses nothing that only one
//! kind of test has, such as `CARGO_BIN_EXE_BuhTig`.
//!
//! The cluster is started from the PostgreSQL 15+ binaries on PATH, or in
//! `pg_config --bindir`, and is reachable only through a Unix socket. The tests set up
//! and inspect databases with plain SQL through `psql`; CON-03 (no hand-written SQL)
//! governs BuhTig's own code, not its tests.

#![allow(
    dead_code,
    reason = "each test binary uses a different part of this module"
)]

use std::env;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// The password of the cluster's `postgres` superuser.
pub const PASSWORD: &str = "file-password";

pub fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

pub fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

/// The cluster shared by every test in this test binary.
pub fn cluster() -> &'static Cluster {
    static CLUSTER: OnceLock<Cluster> = OnceLock::new();
    CLUSTER.get_or_init(Cluster::start)
}

/// A PostgreSQL cluster in a temporary directory, which also holds its socket.
pub struct Cluster {
    bin: PathBuf,
    dir: PathBuf,
    /// A shell that holds PostgreSQL, reading from a pipe this process never writes to.
    /// When this process exits, even if it is killed, the pipe closes, and the watchdog
    /// stops PostgreSQL and removes `dir`. It is never waited for, since it outlives us.
    _watchdog: Mutex<Child>,
}

/// Only names the socket file, since the cluster does not listen on TCP.
const PORT: u16 = 5432;

impl Cluster {
    fn start() -> Cluster {
        let bin = postgres_bin_dir();
        let dir = tempfile::Builder::new()
            .prefix("buhtig-pg")
            .tempdir()
            .unwrap()
            .keep();
        let password_file = dir.join("password");
        std::fs::write(&password_file, PASSWORD).unwrap();
        let initdb = Command::new(bin.join("initdb"))
            .arg("--pgdata")
            .arg(dir.join("data"))
            .arg("--pwfile")
            .arg(&password_file)
            .args(["--username=postgres", "--auth=scram-sha-256"])
            .args([
                "--encoding=UTF8",
                "--locale=C",
                "--no-sync",
                "--no-instructions",
            ])
            .env_clear()
            .output()
            .unwrap();
        assert!(
            initdb.status.success(),
            "initdb failed: {}",
            stderr(&initdb)
        );

        let watchdog = r#"
            "$0" -D "$1/data" -k "$1" -p "$2" -c listen_addresses= -F >"$1/postgres.log" 2>&1 &
            postgres=$!
            trap '' INT
            read -r _
            kill -INT "$postgres"
            wait "$postgres"
            rm -rf "$1"
        "#;
        let watchdog = Command::new("/bin/sh")
            .arg("-c")
            .arg(watchdog)
            .arg(bin.join("postgres"))
            .arg(&dir)
            .arg(PORT.to_string())
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        let cluster = Cluster {
            bin,
            dir,
            _watchdog: Mutex::new(watchdog),
        };

        let deadline = Instant::now() + Duration::from_secs(30);
        while !cluster.is_ready() {
            assert!(
                Instant::now() < deadline,
                "PostgreSQL did not start: {}",
                std::fs::read_to_string(cluster.dir.join("postgres.log")).unwrap_or_default()
            );
            std::thread::sleep(Duration::from_millis(50));
        }
        cluster
    }

    fn is_ready(&self) -> bool {
        Command::new(self.bin.join("pg_isready"))
            .arg("--host")
            .arg(&self.dir)
            .args(["--port", &PORT.to_string(), "--quiet"])
            .env_clear()
            .status()
            .unwrap()
            .success()
    }

    /// Creates an empty database for one test and returns its name.
    pub fn create_database(&self) -> String {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let name = format!("test_{}", NEXT.fetch_add(1, Ordering::Relaxed));
        self.psql("postgres", &format!("CREATE DATABASE {name}"));
        name
    }

    /// Makes a database unreachable, as if it had gone down: it takes no new connections,
    /// and those it has are cut. The rest of the cluster carries on.
    pub fn refuse_connections(&self, database: &str) {
        // Committed first, so that nothing can reconnect once the sessions are cut.
        self.psql(
            "postgres",
            &format!("ALTER DATABASE {database} WITH ALLOW_CONNECTIONS false"),
        );
        self.psql(
            "postgres",
            &format!(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
                 WHERE datname = '{database}'"
            ),
        );
    }

    /// Makes a database reachable again after [`Cluster::refuse_connections`].
    pub fn allow_connections(&self, database: &str) {
        self.psql(
            "postgres",
            &format!("ALTER DATABASE {database} WITH ALLOW_CONNECTIONS true"),
        );
    }

    /// The `database.url` of a database, as the `postgres` superuser.
    pub fn url(&self, database: &str) -> String {
        self.url_as(database, "postgres", PASSWORD)
    }

    pub fn url_as(&self, database: &str, user: &str, password: &str) -> String {
        format!(
            "postgres:///{database}?host={}&port={PORT}&user={user}&password={password}",
            self.dir.display()
        )
    }

    /// Runs SQL and returns its output, one row per line and columns separated by `|`.
    pub fn psql(&self, database: &str, sql: &str) -> String {
        self.try_psql(database, sql)
            .unwrap_or_else(|error| panic!("{sql}\nfailed: {error}"))
    }

    pub fn try_psql(&self, database: &str, sql: &str) -> Result<String, String> {
        let output = self.psql_command(database, sql).output().unwrap();
        if output.status.success() {
            Ok(stdout(&output).trim_end().to_owned())
        } else {
            Err(stderr(&output))
        }
    }

    /// Runs SQL in the background, for example to hold a lock while it sleeps.
    pub fn spawn_psql(&self, database: &str, sql: &str) -> Child {
        self.psql_command(database, sql)
            .stdout(Stdio::null())
            .spawn()
            .unwrap()
    }

    fn psql_command(&self, database: &str, sql: &str) -> Command {
        let mut command = Command::new(self.bin.join("psql"));
        command
            .args(["--no-psqlrc", "--no-align", "--tuples-only"])
            .args(["--set", "ON_ERROR_STOP=1"])
            .arg("--host")
            .arg(&self.dir)
            .args(["--port", &PORT.to_string(), "--username", "postgres"])
            .args(["--dbname", database, "--command", sql])
            .env_clear()
            .env("PGPASSWORD", PASSWORD);
        command
    }

    /// Everything about a database's schema that migration may change: columns,
    /// constraints and indexes, sorted so that the order of columns does not matter.
    pub fn fingerprint(&self, database: &str) -> String {
        self.psql(
            database,
            r#"
            SELECT 'column ' || table_name || '.' || column_name || ' ' || data_type
                || CASE WHEN is_nullable = 'NO' THEN ' not null' ELSE '' END
                || CASE WHEN is_identity = 'YES' THEN ' identity' ELSE '' END
                || coalesce(' default ' || column_default, '')
            FROM information_schema.columns
            WHERE table_schema = 'public'
            UNION ALL
            SELECT 'constraint ' || conrelid::regclass || ' ' || conname || ' '
                || pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE connamespace = 'public'::regnamespace
            UNION ALL
            SELECT 'index ' || indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY 1
            "#,
        )
    }
}

/// Where `initdb`, `postgres`, `psql` and `pg_isready` are, checking that they are
/// PostgreSQL 15 or newer, the oldest version BuhTig supports.
fn postgres_bin_dir() -> PathBuf {
    let has_postgres = |dir: &Path| dir.join("initdb").is_file() && dir.join("postgres").is_file();
    let on_path =
        env::var_os("PATH").and_then(|path| env::split_paths(&path).find(|dir| has_postgres(dir)));
    let dir = on_path
        .or_else(|| {
            let output = Command::new("pg_config").arg("--bindir").output().ok()?;
            Some(PathBuf::from(stdout(&output).trim()))
        })
        .filter(|dir| has_postgres(dir))
        .expect("the tests need PostgreSQL 15 or newer: put initdb, postgres and psql on PATH");

    // Such as "postgres (PostgreSQL) 16.14 (Homebrew)".
    let output = Command::new(dir.join("postgres"))
        .arg("--version")
        .output()
        .unwrap();
    let version = stdout(&output);
    let major: u32 = version
        .split_once(") ")
        .and_then(|(_, rest)| rest.split(['.', ' ']).next())
        .and_then(|major| major.trim().parse().ok())
        .unwrap_or_else(|| panic!("cannot read the PostgreSQL version from {version:?}"));
    assert!(
        major >= 15,
        "the tests need PostgreSQL 15 or newer, but {} is {version}",
        dir.display()
    );
    dir
}
