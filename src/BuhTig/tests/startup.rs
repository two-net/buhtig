//! Starts the real binary to check how it treats its config file and environment.

mod support;

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

use support::{
    ENVIRONMENT, buhtig, buhtig_with, cluster, run_to_exit, start, start_command, stderr, stdout,
    write_config,
};

const CONFIG: &str = r#"
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

[log]
level = "debug"
"#;

/// A config file for a fresh database in the test cluster.
fn config() -> String {
    let cluster = cluster();
    CONFIG.replace("{database_url}", &cluster.url(&cluster.create_database()))
}

#[test]
fn environment_does_not_fill_in_a_missing_key() {
    let dir = tempfile::tempdir().unwrap();
    let config = CONFIG.replace(r#"url = "{database_url}""#, "");
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
    let (_running, log) = start(&write_config(&dir, &config(), 0o600));

    let removed = log
        .iter()
        .find(|line| line.contains("removed environment variables"))
        .unwrap_or_else(|| panic!("no removal line in {log:#?}"));
    let mut names: Vec<&str> = ENVIRONMENT.iter().map(|(name, _)| *name).collect();
    // On macOS, CoreFoundation (linked through chrono) sets one more in every process
    // before `main` runs.
    if cfg!(target_os = "macos") {
        names.push("__CF_USER_TEXT_ENCODING");
    }
    names.sort_unstable();
    assert!(removed.ends_with(&format!("names={names:?}")), "{removed}");
    // Only the file's settings were used: with `PGSSLMODE=require` from the environment,
    // sqlx could not have connected to the test cluster, nor migrated with `PGOPTIONS`
    // (AC-07).
    assert!(
        log.iter()
            .any(|line| line.contains("connected to PostgreSQL")),
        "{log:#?}"
    );
    for line in &log {
        assert!(!line.contains("env-"), "{line}");
        // `log.level` is `debug`, whatever `RUST_LOG` says.
        assert!(!line.contains("TRACE"), "{line}");
        assert!(!line.contains("file-password"), "{line}");
        assert!(!line.contains("github-client-secret"), "{line}");
        assert!(!line.contains("can be read by other accounts"), "{line}");
    }
    assert!(
        log.iter().any(|line| line.contains("access_mode=public")),
        "{log:#?}"
    );
}

/// FR-CFG-02: a `.env` file is no source of settings either.
#[test]
fn a_dotenv_file_does_not_fill_in_a_missing_key() {
    let cluster = cluster();
    let url = cluster.url(&cluster.create_database());
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(".env"),
        format!("DATABASE_URL={url}\nBUHTIG_DATABASE_URL={url}\nPGSSLMODE=require\n"),
    )
    .unwrap();
    let config = CONFIG.replace(r#"url = "{database_url}""#, "");
    let output = buhtig_with(&write_config(&dir, &config, 0o600))
        .current_dir(dir.path())
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(1));
    let stderr = stderr(&output);
    assert!(
        stderr.contains("database.url: required key is missing"),
        "{stderr}"
    );
}

/// FR-CFG-03: a key BuhTig does not know stops it, and is named. One that looks like a
/// sensitive key has its value left out, as any value is.
#[test]
fn an_unknown_key_stops_startup_and_is_named() {
    let dir = tempfile::tempdir().unwrap();
    let config = config().replace(
        r#"client_secret = "github-client-secret""#,
        "client_secret = \"github-client-secret\"\nclient_secrets = \"hunter2\"",
    );
    let output = buhtig_with(&write_config(&dir, &config, 0o600))
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(1));
    let stderr = stderr(&output);
    assert!(
        stderr.contains("github.client_secrets: unknown key"),
        "{stderr}"
    );
    assert!(!format!("{stderr}{}", stdout(&output)).contains("hunter2"));
}

/// A proxy that forwards nothing: it keeps the request line and headers of each request
/// made through it, and answers 502.
fn record_connections(listener: TcpListener) -> Arc<Mutex<Vec<String>>> {
    let heads = Arc::new(Mutex::new(Vec::new()));
    let recorded = heads.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = stream.unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            // Up to the blank line that ends the headers, or the end of the connection.
            while reader.read_line(&mut head).unwrap_or(0) > 0 && !head.ends_with("\r\n\r\n") {}
            recorded.lock().unwrap().push(head);
            let _ = stream.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
        }
    });
    heads
}

/// FR-CFG-02: requests to GitHub go through `github.proxy_url` alone, whatever proxy the
/// environment names. Neither proxy forwards anything, so no request reaches GitHub.
#[test]
fn github_is_reached_through_the_configured_proxy_only() {
    let configured = TcpListener::bind("127.0.0.1:0").unwrap();
    let configured_url = format!("http://{}", configured.local_addr().unwrap());
    let from_environment = TcpListener::bind("127.0.0.1:0").unwrap();
    let environment_url = format!("http://{}", from_environment.local_addr().unwrap());
    let through_configured = record_connections(configured);
    let through_environment = record_connections(from_environment);

    let dir = tempfile::tempdir().unwrap();
    let config = config().replace(
        r#"client_secret = "github-client-secret""#,
        &format!("client_secret = \"github-client-secret\"\nproxy_url = \"{configured_url}\""),
    );
    let mut command = buhtig_with(&write_config(&dir, &config, 0o600));
    for name in [
        "ALL_PROXY",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "all_proxy",
        "http_proxy",
        "https_proxy",
    ] {
        command.env(name, &environment_url);
    }
    let (running, _) = start_command(command);
    running.get("/-/api/repositories/octo/public");

    let through_configured = through_configured.lock().unwrap();
    assert!(
        through_configured
            .first()
            .is_some_and(|head| head.starts_with("CONNECT api.github.com:443 HTTP/1.1\r\n")),
        "{through_configured:?}"
    );
    assert_eq!(*through_environment.lock().unwrap(), Vec::<String>::new());
}

#[cfg(unix)]
#[test]
fn warns_when_others_can_read_the_config_file() {
    let dir = tempfile::tempdir().unwrap();
    let (_running, log) = start(&write_config(&dir, &config(), 0o644));

    assert!(
        log.iter()
            .any(|line| line.contains("WARN") && line.contains("can be read by other accounts")),
        "{log:#?}"
    );
}

#[test]
fn exits_when_the_database_rejects_the_connection() {
    let cluster = cluster();
    let url = cluster.url_as(&cluster.create_database(), "postgres", "hunter2");
    let dir = tempfile::tempdir().unwrap();
    let output = run_to_exit(&write_config(
        &dir,
        &CONFIG.replace("{database_url}", &url),
        0o600,
    ));

    assert_eq!(output.status.code(), Some(1));
    let log = stdout(&output);
    assert!(
        log.contains("cannot connect to the database (database.url): ")
            && log.contains("password authentication failed"),
        "{log}"
    );
    assert!(!log.contains("hunter2"), "{log}");
    assert!(!log.contains("listening on"), "{log}");
}

/// FR-CFG-02: a URL without a password must not send sqlx to ~/.pgpass, which it would
/// find through the account database even with the environment cleared.
#[test]
fn a_url_without_a_password_reads_no_pgpass_file() {
    let cluster = cluster();
    let url = cluster
        .url(&cluster.create_database())
        .replace(&format!("&password={}", support::PASSWORD), "");
    let dir = tempfile::tempdir().unwrap();
    let output = run_to_exit(&write_config(
        &dir,
        &CONFIG.replace("{database_url}", &url),
        0o600,
    ));

    // The cluster wants a password, so the empty one fails.
    assert_eq!(output.status.code(), Some(1));
    let log = stdout(&output);
    assert!(log.contains("password authentication failed"), "{log}");
    assert!(!log.contains("pgpass"), "{log}");
}

/// FR-CFG-04: sqlx logs connection parameters it does not know, with their values, so
/// BuhTig refuses them before sqlx sees them.
#[test]
fn unknown_connection_parameters_are_refused_unseen() {
    let cluster = cluster();
    let url = format!(
        "{}&sslpassword=hunter2",
        cluster.url(&cluster.create_database())
    );
    let dir = tempfile::tempdir().unwrap();
    let output = buhtig_with(&write_config(
        &dir,
        &CONFIG.replace("{database_url}", &url),
        0o600,
    ))
    .output()
    .unwrap();

    assert_eq!(output.status.code(), Some(1));
    let stderr = stderr(&output);
    assert!(
        stderr.contains("database.url: has a parameter that sqlx does not support"),
        "{stderr}"
    );
    assert!(!format!("{stderr}{}", stdout(&output)).contains("hunter2"));
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
