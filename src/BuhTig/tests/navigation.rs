//! Starts the real binary to check dashboards' URLs: a GitHub link with BuhTig's host
//! opens the matching dashboard (SRS §4.2).

mod support;

use support::{cluster, minimal_config, start, write_config};

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

/// FR-NAV-01, FR-NAV-02, FR-NAV-03.
#[test]
fn pages_beneath_a_dashboard_redirect_to_it() {
    let cluster = cluster();
    let dir = tempfile::tempdir().unwrap();
    let config = write_config(
        &dir,
        &minimal_config(&cluster.url(&cluster.create_database())),
        0o600,
    );
    let (running, _) = start(&config);

    for (path, dashboard) in [
        // GitHub's query belongs to its page, not to the dashboard.
        ("/owner/repo/issues?q=bug", "/owner/repo"),
        ("/owner/repo/pull/42", "/owner/repo"),
        ("/owner/repo.git", "/owner/repo"),
        ("/orgs/acme/people", "/acme"),
        ("/acme/", "/acme"),
    ] {
        let response = running.get(path);
        assert_status(&response, 308);
        assert_eq!(header(&response, "location"), Some(dashboard), "{path}");
        assert_eq!(
            header(&response, "cache-control"),
            Some("no-cache"),
            "{path}"
        );
    }

    for path in [
        "/owner/repo",
        "/acme",
        "/owner/repo?tab=x",
        "/-/about",
        "/-/x/y/z",
    ] {
        let response = running.get(path);
        assert_status(&response, 200);
        assert_eq!(header(&response, "location"), None, "{path}");
    }
}
