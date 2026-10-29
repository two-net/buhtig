//! Starts the real binary to check what BuhTig keeps of a visitor, and what it sets in
//! their browser (SRS §6.5).

mod support;

use support::{cluster, minimal_config, start, write_config};

/// Every `Set-Cookie` of a response, which BuhTig sends in lowercase.
fn set_cookies(response: &str) -> Vec<&str> {
    let (head, _) = response.split_once("\r\n\r\n").unwrap_or((response, ""));
    head.lines()
        .filter_map(|line| line.strip_prefix("set-cookie: "))
        .collect()
}

/// NFR-PRIV-01, NFR-PRIV-02: a visitor gets no cookie but sign-in's own, and leaves no
/// record but the request log, which names neither them nor what they asked in a query.
#[test]
fn visitors_leave_nothing_behind_but_the_request_log() {
    let cluster = cluster();
    let database = cluster.create_database();
    let dir = tempfile::tempdir().unwrap();
    let config = minimal_config(&cluster.url(&database));
    let (running, _) = start(&write_config(&dir, &config, 0o600));

    // None of these asks GitHub, so the log shows all that a visit leaves.
    for path in [
        "/",
        "/owner/repo",
        "/-/about",
        "/-/privacy?ref=newsletter",
        "/-/api/session",
        "/-/health",
    ] {
        let response = running.get(path);
        assert_eq!(set_cookies(&response), Vec::<&str>::new(), "{path}");
    }

    // Sign-in keeps its state for 10 minutes, for its callback alone.
    let response = running.get("/-/auth/sign-in");
    let cookies = set_cookies(&response);
    assert_eq!(cookies.len(), 1, "{response}");
    assert!(cookies[0].starts_with("buhtig_sign_in="), "{}", cookies[0]);
    assert!(
        cookies[0].ends_with("; Path=/-/auth/; Max-Age=600; HttpOnly; SameSite=Lax; Secure"),
        "{}",
        cookies[0]
    );

    let log = running.log_until(&["path=/-/auth/sign-in"]);
    let requests: Vec<&String> = log
        .iter()
        .filter(|line| line.contains("handled request"))
        .collect();
    assert_eq!(requests.len(), 7, "{log:#?}");
    for line in requests {
        assert!(!line.contains("ref="), "{line}");
        assert!(!line.contains("127.0.0.1"), "{line}");
    }

    assert_eq!(
        cluster.psql(
            &database,
            "SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM sessions) \
             + (SELECT count(*) FROM credentials) + (SELECT count(*) FROM history_entries) \
             + (SELECT count(*) FROM pins)",
        ),
        "0"
    );
}
