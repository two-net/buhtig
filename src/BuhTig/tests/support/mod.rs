//! What the integration tests share: a throwaway PostgreSQL cluster, and helpers to run
//! the real BuhTig binary against it.
//!
//! The cluster is started from the PostgreSQL 15+ binaries on PATH, or in
//! `pg_config --bindir`, and is reachable only through a Unix socket. The tests set up
//! and inspect databases with plain SQL through `psql`; CON-03 (no hand-written SQL)
//! governs BuhTig's own code, not its tests.

#![allow(
    dead_code,
    reason = "each test file uses a different part of this module"
)]

use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock, mpsc};
use std::time::{Duration, Instant};

use tempfile::TempDir;

/// The password of the cluster's `postgres` superuser.
pub const PASSWORD: &str = "file-password";

/// Values a library would pick up from the environment if BuhTig let it (AC-07).
/// BuhTig starts only if it removed them: tokio panics on `TOKIO_WORKER_THREADS=0`, and
/// sqlx would insist on TLS for `PGSSLMODE=require`, which the test cluster lacks.
pub const ENVIRONMENT: [(&str, &str); 5] = [
    (
        "DATABASE_URL",
        "postgres://env-user:env-password@env-host/env-db",
    ),
    ("HTTPS_PROXY", "http://env-proxy:3128"),
    ("PGPASSWORD", "env-password"),
    ("PGSSLMODE", "require"),
    ("TOKIO_WORKER_THREADS", "0"),
];

/// The BuhTig version under test, as it is recorded in `schema_versions`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// A config file with the five required keys (AC-06), plus `server.listen` so that
/// tests can run side by side.
pub fn minimal_config(database_url: &str) -> String {
    format!(
        r#"
[server]
public_url = "https://buhtig.example.com"
listen = "127.0.0.1:0"

[database]
url = "{database_url}"

[github]
client_id = "Iv1.client-id"
client_secret = "github-client-secret"

[security]
encryption_key = "E9kO4wdc96sDx81yxStONaEoRd/p1+5zlz2JSlcH8Xc="
"#
    )
}

pub fn write_config(dir: &TempDir, contents: &str, mode: u32) -> PathBuf {
    let path = dir.path().join("BuhTig.toml");
    std::fs::write(&path, contents).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
    }
    #[cfg(not(unix))]
    let _ = mode;
    path
}

pub fn buhtig(args: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_BuhTig"));
    command.args(args).env_clear().envs(ENVIRONMENT);
    command
}

pub fn buhtig_with(config: &Path) -> Command {
    let mut command = buhtig(&["--config"]);
    command.arg(config);
    command
}

pub fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

pub fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

/// A running BuhTig, killed when dropped.
pub struct Running {
    child: Child,
    /// Where it listens, such as `127.0.0.1:52817`.
    pub address: String,
    /// What it writes to stdout and stderr, line by line.
    log: mpsc::Receiver<String>,
}

impl Running {
    /// Waits for BuhTig to log a line that contains one of `messages`, and returns it.
    pub fn wait_for(&self, messages: &[&str]) -> String {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut log = Vec::new();
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self.log.recv_timeout(remaining) {
                Ok(line) if messages.iter().any(|message| line.contains(message)) => {
                    return line;
                }
                Ok(line) => log.push(line),
                Err(_) => panic!("BuhTig did not log any of {messages:?}; it logged {log:#?}"),
            }
        }
    }

    /// Sends `GET path` and returns the whole response.
    pub fn get(&self, path: &str) -> String {
        let mut stream = TcpStream::connect(&self.address).unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
            self.address
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Starts BuhTig and returns its log lines up to and including the "listening" line.
pub fn start(config: &Path) -> (Running, Vec<String>) {
    const LISTENING: &str = "listening on http://";

    let mut child = buhtig_with(config)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let (lines, received) = mpsc::channel();
    // Stderr too, so that a panic shows up in the log.
    let pipes: [Box<dyn Read + Send>; 2] = [
        Box::new(child.stdout.take().unwrap()),
        Box::new(child.stderr.take().unwrap()),
    ];
    for pipe in pipes {
        let lines = lines.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines() {
                if lines.send(line.unwrap()).is_err() {
                    break;
                }
            }
        });
    }
    let mut running = Running {
        child,
        address: String::new(),
        log: received,
    };

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut log = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match running.log.recv_timeout(remaining) {
            Ok(line) => {
                let address = line
                    .split_once(LISTENING)
                    .map(|(_, address)| address.to_owned());
                log.push(line);
                if let Some(address) = address {
                    running.address = address;
                    return (running, log);
                }
            }
            Err(_) => panic!("BuhTig did not start listening; log so far: {log:#?}"),
        }
    }
}

/// Runs BuhTig and waits for it to exit on its own, which it should do quickly when it
/// cannot start.
pub fn run_to_exit(config: &Path) -> Output {
    let mut child = buhtig_with(config)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // Read both pipes while BuhTig runs, so that it never blocks on a full one.
    let read_all = |mut pipe: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            pipe.read_to_end(&mut bytes).unwrap();
            bytes
        })
    };
    let out = read_all(Box::new(child.stdout.take().unwrap()));
    let err = read_all(Box::new(child.stderr.take().unwrap()));

    let deadline = Instant::now() + Duration::from_secs(30);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            let log = String::from_utf8_lossy(&out.join().unwrap()).into_owned();
            panic!("BuhTig kept running; it logged {log}");
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    Output {
        status,
        stdout: out.join().unwrap(),
        stderr: err.join().unwrap(),
    }
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
