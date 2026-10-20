//! Starts the real binary to check how it treats its config file and environment.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use tempfile::TempDir;

const CONFIG: &str = r#"
[server]
public_url = "https://buhtig.example.com"
listen = "127.0.0.1:0"

[database]
url = "postgres://buhtig:file-password@file-host/buhtig"

[github]
client_id = "Iv1.client-id"
client_secret = "github-client-secret"

[security]
encryption_key = "E9kO4wdc96sDx81yxStONaEoRd/p1+5zlz2JSlcH8Xc="

[log]
level = "debug"
"#;

/// Values a library would pick up from the environment if BuhTig let it (AC-07).
/// tokio panics on `TOKIO_WORKER_THREADS=0`, so BuhTig starts only if it removed them.
const ENVIRONMENT: [(&str, &str); 4] = [
    (
        "DATABASE_URL",
        "postgres://env-user:env-password@env-host/env-db",
    ),
    ("HTTPS_PROXY", "http://env-proxy:3128"),
    ("PGPASSWORD", "env-password"),
    ("TOKIO_WORKER_THREADS", "0"),
];

fn write_config(dir: &TempDir, contents: &str, mode: u32) -> PathBuf {
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

fn buhtig(args: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_BuhTig"));
    command.args(args).env_clear().envs(ENVIRONMENT);
    command
}

fn buhtig_with(config: &Path) -> Command {
    let mut command = buhtig(&["--config"]);
    command.arg(config);
    command
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

/// A running BuhTig, killed when dropped.
struct Running(Child);

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Starts BuhTig and returns its log lines up to and including the "listening" line.
fn start(config: &Path) -> (Running, Vec<String>) {
    let mut child = buhtig_with(config)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let stdout = child.stdout.take().unwrap();
    let running = Running(child);

    let (lines, received) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if lines.send(line.unwrap()).is_err() {
                break;
            }
        }
    });

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut log = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match received.recv_timeout(remaining) {
            Ok(line) => {
                let listening = line.contains("listening on http://127.0.0.1:");
                log.push(line);
                if listening {
                    return (running, log);
                }
            }
            Err(_) => panic!("BuhTig did not start listening; log so far: {log:#?}"),
        }
    }
}

#[test]
fn environment_does_not_fill_in_a_missing_key() {
    let dir = tempfile::tempdir().unwrap();
    let config = CONFIG.replace("url = \"postgres://", "# url = \"postgres://");
    let output = buhtig_with(&write_config(&dir, &config, 0o600))
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(1));
    let stderr = stderr(&output);
    assert!(
        stderr.contains("database.url: required key is missing"),
        "{stderr}"
    );
    assert!(!stderr.contains("env-"), "{stderr}");
}

#[test]
fn starts_from_the_config_file_with_the_environment_removed() {
    let dir = tempfile::tempdir().unwrap();
    let (_running, log) = start(&write_config(&dir, CONFIG, 0o600));

    let removed = log
        .iter()
        .find(|line| line.contains("removed environment variables"))
        .unwrap_or_else(|| panic!("no removal line in {log:#?}"));
    assert!(
        removed.ends_with(
            r#"names=["DATABASE_URL", "HTTPS_PROXY", "PGPASSWORD", "TOKIO_WORKER_THREADS"]"#
        ),
        "{removed}"
    );
    for line in &log {
        assert!(!line.contains("env-"), "{line}");
        assert!(!line.contains("file-password"), "{line}");
        assert!(!line.contains("github-client-secret"), "{line}");
        assert!(!line.contains("can be read by other accounts"), "{line}");
    }
    assert!(
        log.iter().any(|line| line.contains("access_mode=public")),
        "{log:#?}"
    );
}

#[cfg(unix)]
#[test]
fn warns_when_others_can_read_the_config_file() {
    let dir = tempfile::tempdir().unwrap();
    let (_running, log) = start(&write_config(&dir, CONFIG, 0o644));

    assert!(
        log.iter()
            .any(|line| line.contains("WARN") && line.contains("can be read by other accounts")),
        "{log:#?}"
    );
}

#[test]
fn a_missing_config_file_is_named() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("missing.toml");
    let output = buhtig_with(&path).output().unwrap();

    assert_eq!(output.status.code(), Some(1));
    let stderr = stderr(&output);
    assert!(
        stderr.starts_with(&format!(
            "error: cannot read config file {}: ",
            path.display()
        )),
        "{stderr}"
    );
}

#[test]
fn arguments_other_than_config_are_refused() {
    let output = buhtig(&["--listen", "0.0.0.0:1"]).output().unwrap();

    assert_eq!(output.status.code(), Some(2));
    let stderr = stderr(&output);
    assert!(
        stderr.starts_with("error: unknown argument --listen\n"),
        "{stderr}"
    );
    assert!(
        stderr.contains("Usage: BuhTig [--config <path>]"),
        "{stderr}"
    );
}
