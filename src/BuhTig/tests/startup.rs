//! Starts the real binary to check how it treats its config file and environment.

mod support;

use support::{buhtig, buhtig_with, cluster, run_to_exit, start, stderr, stdout, write_config};

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
    // On macOS, CoreFoundation (linked through chrono) sets one more in every process
    // before `main` runs.
    let names = if cfg!(target_os = "macos") {
        r#"names=["DATABASE_URL", "HTTPS_PROXY", "PGPASSWORD", "PGSSLMODE", "TOKIO_WORKER_THREADS", "__CF_USER_TEXT_ENCODING"]"#
    } else {
        r#"names=["DATABASE_URL", "HTTPS_PROXY", "PGPASSWORD", "PGSSLMODE", "TOKIO_WORKER_THREADS"]"#
    };
    assert!(removed.ends_with(names), "{removed}");
    // Only the file's settings were used: with `PGSSLMODE=require` from the environment,
    // sqlx could not have connected to the test cluster (AC-07).
    assert!(
        log.iter()
            .any(|line| line.contains("connected to PostgreSQL")),
        "{log:#?}"
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
