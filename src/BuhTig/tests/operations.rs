//! Starts the real binary to check what operators rely on: the health check, the request
//! log, riding out a database outage, and graceful shutdown (SRS §4.13, FR-DB-09).

mod support;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use support::{Cluster, PASSWORD, Running, VERSION, cluster, minimal_config, start, write_config};
use tempfile::TempDir;

/// A fresh database and a config file for it, which logs at the default level, `info`.
struct Setup {
    cluster: &'static Cluster,
    database: String,
    config: PathBuf,
    _dir: TempDir,
}

fn setup() -> Setup {
    let cluster = cluster();
    let database = cluster.create_database();
    let dir = tempfile::tempdir().unwrap();
    let config = write_config(&dir, &minimal_config(&cluster.url(&database)), 0o600);
    Setup {
        cluster,
        database,
        config,
        _dir: dir,
    }
}

/// The value of a response header, which BuhTig sends in lowercase.
fn header<'a>(response: &'a str, name: &str) -> Option<&'a str> {
    let (head, _) = response.split_once("\r\n\r\n")?;
    head.lines()
        .find_map(|line| line.strip_prefix(name)?.strip_prefix(": "))
}

fn assert_status(response: &str, status: u16) {
    assert!(
        response.starts_with(&format!("HTTP/1.1 {status} ")),
        "{response}"
    );
}

/// Polls `path` until it answers with `status`.
fn wait_for_status(running: &Running, path: &str, status: u16) -> String {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let response = running.get(path);
        if response.starts_with(&format!("HTTP/1.1 {status} ")) {
            return response;
        }
        assert!(
            Instant::now() < deadline,
            "{path} did not answer {status}: {response}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn health_reports_a_reachable_database() {
    let db = setup();
    let (running, _) = start(&db.config);

    let health = running.get("/-/health");
    assert_status(&health, 200);
    assert_eq!(header(&health, "cache-control"), Some("no-store"));
    // Only that it is healthy: no version, configuration or internals (FR-OPS-01).
    assert!(health.ends_with("\r\n\r\nok\n"), "{health}");

    let head = running.request(&format!(
        "HEAD /-/health HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        running.address
    ));
    assert_status(&head, 200);
    assert!(head.ends_with("\r\n\r\n"), "{head}");
}

/// FR-DB-09: while the database is unreachable, BuhTig says so and shows a friendly page,
/// and once it is back, BuhTig carries on as before, without a restart.
#[test]
fn a_database_outage_is_reported_and_recovered_from_without_a_restart() {
    let db = setup();
    let (running, _) = start(&db.config);
    assert_status(&running.get("/-/health"), 200);
    assert_status(&running.get("/owner/repo"), 200);

    db.cluster.refuse_connections(&db.database);
    let health = running.get("/-/health");
    assert_status(&health, 503);
    assert!(health.ends_with("\r\n\r\nunavailable\n"), "{health}");

    let page = running.get("/owner/repo");
    assert_status(&page, 503);
    assert_eq!(
        header(&page, "content-type"),
        Some("text/html; charset=utf-8")
    );
    assert_eq!(header(&page, "cache-control"), Some("no-store"));
    assert_eq!(header(&page, "retry-after"), Some("30"));
    assert!(page.contains("can't reach its database"), "{page}");
    assert!(page.contains("try again in a few minutes"), "{page}");
    // NFR-SEC-09: nothing about the cause.
    for internal in ["postgres", &db.database, "accepting connections", "Error"] {
        assert!(!page.contains(internal), "{internal:?} in {page}");
    }
    // A GitHub link with BuhTig's host leads to its dashboard without the database
    // (FR-NAV-02).
    let link = running.get("/owner/repo/pull/42");
    assert_status(&link, 308);
    assert_eq!(header(&link, "location"), Some("/owner/repo"));
    // When the UI is built, its files need no database.
    let ui = Path::new(env!("CARGO_MANIFEST_DIR")).join("../BuhTig.Angular/dist/BuhTig/browser");
    if ui.join("favicon.ico").is_file() {
        assert_status(&running.get("/favicon.ico"), 200);
    }

    db.cluster.allow_connections(&db.database);
    wait_for_status(&running, "/-/health", 200);
    assert_status(&running.get("/owner/repo"), 200);

    // The outage is logged once as it begins, however often it is noticed, and once as it
    // ends.
    let log = running.log_until(&["the database is reachable again"]);
    let unreachable: Vec<&String> = log
        .iter()
        .filter(|line| line.contains("the database is unreachable"))
        .collect();
    assert_eq!(unreachable.len(), 1, "{log:#?}");
    assert!(unreachable[0].contains("ERROR"), "{log:#?}");
    for line in &log {
        assert!(!line.contains(PASSWORD), "{line}");
    }
}

/// FR-OPS-04: startup, and one line per request with its method, path, status and
/// duration, but never a credential, session identifier or OAuth code.
#[test]
fn startup_and_each_request_are_logged_without_secrets() {
    let db = setup();
    let (running, startup) = start(&db.config);
    assert!(
        startup.iter().any(|line| line.contains("starting BuhTig")
            && line.contains(&format!("version=\"{VERSION}\""))
            && line.contains("access_mode=public")),
        "{startup:#?}"
    );
    assert!(
        startup
            .iter()
            .any(|line| line.contains("created the database schema for BuhTig")),
        "{startup:#?}"
    );

    let callback = running.request(&format!(
        "GET /-/auth/callback?code=oauth-code-123&state=state-456 HTTP/1.1\r\n\
         Host: {}\r\n\
         Cookie: buhtig_session=session-id-789\r\n\
         Authorization: Bearer token-abc\r\n\
         Connection: close\r\n\r\n",
        running.address
    ));
    // The state matches no sign-in this browser started (FR-AUTH-03).
    assert_status(&callback, 303);
    let post = running.request(&format!(
        "POST /-/health HTTP/1.1\r\nHost: {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        running.address
    ));
    assert_status(&post, 405);

    let log = running.log_until(&["path=/-/health status=405"]);
    let requests: Vec<&String> = log
        .iter()
        .filter(|line| line.contains("handled request"))
        .collect();
    assert_eq!(requests.len(), 2, "{log:#?}");
    assert!(
        requests[0].contains(" INFO ")
            && requests[0].contains("method=GET path=/-/auth/callback status=303 duration="),
        "{}",
        requests[0]
    );
    assert!(
        requests[1].contains("method=POST path=/-/health status=405 duration="),
        "{}",
        requests[1]
    );
    for line in startup.iter().chain(&log) {
        for secret in [
            "oauth-code-123",
            "state-456",
            "session-id-789",
            "token-abc",
            PASSWORD,
            "github-client-secret",
        ] {
            assert!(!line.contains(secret), "{secret:?} in {line}");
        }
    }
}

/// FR-OPS-05: SIGTERM stops BuhTig cleanly, without waiting for connections that are
/// open but idle, as a browser leaves them between requests.
#[cfg(unix)]
#[test]
fn sigterm_stops_buhtig_without_waiting_for_idle_connections() {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let db = setup();
    let (mut running, _) = start(&db.config);

    let mut idle = TcpStream::connect(&running.address).unwrap();
    write!(
        idle,
        "GET /-/health HTTP/1.1\r\nHost: {}\r\n\r\n",
        running.address
    )
    .unwrap();
    let mut response = Vec::new();
    let mut buffer = [0; 1024];
    while !response.ends_with(b"\r\n\r\nok\n") {
        let read = idle.read(&mut buffer).unwrap();
        assert!(read > 0, "{}", String::from_utf8_lossy(&response));
        response.extend_from_slice(&buffer[..read]);
    }

    let start = Instant::now();
    let status = running.terminate();
    assert!(status.success(), "{status}");
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "took {:?}",
        start.elapsed()
    );
    idle.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    assert!(
        !matches!(idle.read(&mut buffer), Ok(read) if read > 0),
        "the idle connection is still open"
    );
    assert!(TcpStream::connect(&running.address).is_err());

    let log = running.log_until(&["BuhTig: stopped"]);
    assert!(
        log.iter()
            .any(|line| line.contains("shutting down; waiting up to 10s for requests in flight")),
        "{log:#?}"
    );
}
