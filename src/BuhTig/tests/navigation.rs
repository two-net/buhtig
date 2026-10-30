//! Starts the real binary to check dashboards' URLs: a GitHub link with BuhTig's host
//! opens the matching dashboard, at the tab that shows the most of what GitHub's page does
//! (SRS §4.2).

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
fn pages_beneath_a_dashboard_redirect_to_its_matching_tab() {
    let cluster = cluster();
    let dir = tempfile::tempdir().unwrap();
    let config = write_config(
        &dir,
        &minimal_config(&cluster.url(&cluster.create_database())),
        0o600,
    );
    let (running, _) = start(&config);

    for (path, tab) in [
        // GitHub's query belongs to its page, not to the tab.
        ("/owner/repo/issues/7?q=bug", "/owner/repo/issues"),
        ("/owner/repo/Issues", "/owner/repo/issues"),
        ("/owner/repo/issues/", "/owner/repo/issues"),
        ("/owner/repo/pull/42", "/owner/repo/pulls"),
        ("/owner/repo/pulls/octocat", "/owner/repo/pulls"),
        ("/owner/repo/commits/main", "/owner/repo/activity"),
        ("/owner/repo/commit/a1b2c3d", "/owner/repo/activity"),
        ("/owner/repo/pulse", "/owner/repo/activity"),
        ("/owner/repo/graphs/commit-activity", "/owner/repo/activity"),
        ("/owner/repo/graphs", "/owner/repo/activity"),
        (
            "/owner/repo/graphs/contributors/",
            "/owner/repo/graphs/contributors",
        ),
        ("/owner/repo/tags", "/owner/repo/releases"),
        ("/owner/repo/releases/tag/v1", "/owner/repo/releases"),
        ("/owner/repo/releases/latest", "/owner/repo/releases"),
        ("/owner/repo/tree/main/src", "/owner/repo"),
        ("/owner/repo/blob/main/README.md", "/owner/repo"),
        ("/owner/repo/wiki", "/owner/repo"),
        ("/owner/repo.git", "/owner/repo"),
        ("/owner/repo.git/issues", "/owner/repo/issues"),
        ("/Owner/Repo/Pulls", "/Owner/Repo/pulls"),
        ("/orgs/acme", "/acme"),
        ("/orgs/acme/teams", "/acme"),
        ("/orgs/acme/repositories/extra", "/acme"),
        ("/ORGS/acme/people", "/orgs/acme/people"),
        ("/orgs/acme/Repositories/", "/orgs/acme/repositories"),
        ("/acme/", "/acme"),
    ] {
        let response = running.get(path);
        assert_status(&response, 308);
        assert_eq!(header(&response, "location"), Some(tab), "{path}");
        assert_eq!(
            header(&response, "cache-control"),
            Some("no-cache"),
            "{path}"
        );
    }

    for path in [
        "/owner/repo",
        "/owner/repo/activity",
        "/owner/repo/issues",
        "/owner/repo/pulls",
        "/owner/repo/graphs/contributors",
        "/owner/repo/releases",
        "/Owner/Repo/issues",
        "/acme",
        "/orgs/acme/repositories",
        "/orgs/acme/people",
        "/owner/repo?tab=x",
        "/owner/repo/issues?q=bug",
        "/-/about",
        "/-/x/y/z",
    ] {
        let response = running.get(path);
        assert_status(&response, 200);
        assert_eq!(header(&response, "location"), None, "{path}");
    }
}
