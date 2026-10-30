//! What the integration tests share: a throwaway PostgreSQL cluster (in `cluster.rs`,
//! which BuhTig's unit tests use too), and helpers to run the real BuhTig binary against
//! it.

#![allow(
    dead_code,
    reason = "each test file uses a different part of this module"
)]

mod cluster;

pub use cluster::*;

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use tempfile::TempDir;

/// Values a library would pick up from the environment if BuhTig let it (FR-CFG-02,
/// AC-07): those PostgreSQL clients such as sqlx read, the proxies and CA files HTTP
/// clients read, tokio's and tracing's.
///
/// BuhTig starts only if it removed them: tokio panics on `TOKIO_WORKER_THREADS=0`, sqlx
/// would insist on TLS for `PGSSLMODE=require`, which the test cluster lacks, and
/// `PGOPTIONS` would make every transaction read-only, so migration would fail. The others
/// name hosts and files that are not there, with `env-` in them so that tests can check
/// none reaches the log. `RUST_LOG` would log at TRACE, and `NO_PROXY` would take GitHub
/// past `github.proxy_url`.
pub const ENVIRONMENT: &[(&str, &str)] = &[
    ("ALL_PROXY", "http://env-proxy:3128"),
    (
        "DATABASE_URL",
        "postgres://env-user:env-password@env-host/env-db",
    ),
    ("HTTPS_PROXY", "http://env-proxy:3128"),
    ("HTTP_PROXY", "http://env-proxy:3128"),
    ("NO_PROXY", "api.github.com"),
    ("PGAPPNAME", "env-application"),
    ("PGDATABASE", "env-db"),
    ("PGHOST", "env-host"),
    ("PGHOSTADDR", "192.0.2.1"),
    ("PGOPTIONS", "-c default_transaction_read_only=on"),
    ("PGPASSFILE", "/env-pgpass"),
    ("PGPASSWORD", "env-password"),
    ("PGPORT", "1"),
    ("PGSERVICE", "env-service"),
    ("PGSERVICEFILE", "/env-pg_service.conf"),
    ("PGSSLCERT", "/env-client.crt"),
    ("PGSSLKEY", "/env-client.key"),
    ("PGSSLMODE", "require"),
    ("PGSSLROOTCERT", "/env-root.crt"),
    ("PGUSER", "env-user"),
    ("RUST_LOG", "trace"),
    ("SSL_CERT_DIR", "/env-certs"),
    ("SSL_CERT_FILE", "/env-cert.pem"),
    ("TOKIO_WORKER_THREADS", "0"),
    ("all_proxy", "http://env-proxy:3128"),
    ("http_proxy", "http://env-proxy:3128"),
    ("https_proxy", "http://env-proxy:3128"),
    ("no_proxy", "api.github.com"),
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
    command
        .args(args)
        .env_clear()
        .envs(ENVIRONMENT.iter().copied());
    command
}

pub fn buhtig_with(config: &Path) -> Command {
    let mut command = buhtig(&["--config"]);
    command.arg(config);
    command
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
        self.log_until(messages).pop().unwrap()
    }

    /// Waits for BuhTig to log a line that contains one of `messages`, and returns every
    /// line it logged up to and including that one.
    pub fn log_until(&self, messages: &[&str]) -> Vec<String> {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut log = Vec::new();
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self.log.recv_timeout(remaining) {
                Ok(line) => {
                    let found = messages.iter().any(|message| line.contains(message));
                    log.push(line);
                    if found {
                        return log;
                    }
                }
                Err(_) => panic!("BuhTig did not log any of {messages:?}; it logged {log:#?}"),
            }
        }
    }

    /// Sends `GET path` and returns the whole response.
    pub fn get(&self, path: &str) -> String {
        self.request(&format!(
            "GET {path} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
            self.address
        ))
    }

    /// Sends a raw HTTP request, which should ask to close the connection, and returns
    /// the whole response, with any bytes that are not UTF-8 replaced.
    pub fn request(&self, request: &str) -> String {
        let mut stream = TcpStream::connect(&self.address).unwrap();
        stream.write_all(request.as_bytes()).unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        String::from_utf8_lossy(&response).into_owned()
    }

    /// Asks BuhTig to stop with SIGTERM, as a service manager would, and waits for it to
    /// exit. Its log can still be read afterwards.
    #[cfg(unix)]
    pub fn terminate(&mut self) -> ExitStatus {
        let kill = Command::new("kill")
            .args(["-TERM", &self.child.id().to_string()])
            .status()
            .unwrap();
        assert!(kill.success(), "kill failed");
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "BuhTig kept running after SIGTERM"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
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
    start_command(buhtig_with(config))
}

/// Like [`start`], for a command that [`buhtig_with`] made and a test changed.
pub fn start_command(mut command: Command) -> (Running, Vec<String>) {
    const LISTENING: &str = "listening on http://";

    let mut child = command
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
