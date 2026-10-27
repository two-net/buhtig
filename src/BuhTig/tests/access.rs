//! Starts the real binary to check what a visitor may reach without signing in: in public
//! mode, dashboards, and in private mode, only what signing in needs (SRS §4.7).

mod support;

use support::{Running, cluster, minimal_config, start, write_config};

/// The value of a response header, which BuhTig sends in lowercase.
fn header<'a>(response: &'a str, name: &str) -> Option<&'a str> {
    let (head, _) = response.split_once("\r\n\r\n")?;
    head.lines()
        .find_map(|line| line.strip_prefix(name)?.strip_prefix(": "))
}

fn body(response: &str) -> &str {
    response.split_once("\r\n\r\n").map_or("", |(_, body)| body)
}

fn assert_status(response: &str, status: u16) {
    assert!(
        response.starts_with(&format!("HTTP/1.1 {status} ")),
        "{response}"
    );
}

/// A BuhTig whose config file adds `access` to the five required keys, with its log up to
/// when it listens, and the directory of its config file, which must outlive it.
fn buhtig(access: &str) -> (Running, Vec<String>, tempfile::TempDir) {
    let cluster = cluster();
    let dir = tempfile::tempdir().unwrap();
    let config = format!(
        "{}\n[access]\n{access}\n",
        minimal_config(&cluster.url(&cluster.create_database()))
    );
    let (running, log) = start(&write_config(&dir, &config, 0o600));
    (running, log, dir)
}

/// Sends `POST path` with no body, as a visitor.
fn post(running: &Running, path: &str) -> String {
    running.request(&format!(
        "POST {path} HTTP/1.1\r\nHost: {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        running.address
    ))
}

/// FR-ACC-03, AC-05: a visitor is sent to sign in, and then back to the page they asked
/// for, and gets no data.
#[test]
fn private_mode_lets_visitors_reach_only_what_signing_in_needs() {
    let (running, log, _dir) = buhtig(r#"mode = "private""#);
    assert!(
        log.iter().any(|line| line.contains("access_mode=private")),
        "{log:#?}"
    );

    for (path, location) in [
        ("/", "/-/sign-in"),
        ("/owner/repo", "/-/sign-in?return_to=%2Fowner%2Frepo"),
        (
            "/owner/repo/pull/42?x=1",
            "/-/sign-in?return_to=%2Fowner%2Frepo%2Fpull%2F42%3Fx%3D1",
        ),
        ("/acme", "/-/sign-in?return_to=%2Facme"),
        ("/-/settings", "/-/sign-in?return_to=%2F-%2Fsettings"),
    ] {
        let response = running.get(path);
        assert_status(&response, 303);
        assert_eq!(header(&response, "location"), Some(location), "{path}");
        assert_eq!(
            header(&response, "cache-control"),
            Some("no-store"),
            "{path}"
        );
    }

    for path in [
        "/-/api/repositories/owner/repo",
        "/-/api/organizations/acme",
        "/-/api/accounts/acme",
        "/-/api/surprise",
        "/-/api/shortcuts",
    ] {
        let response = running.get(path);
        assert_status(&response, 401);
        assert_eq!(body(&response), "", "{path}");
    }
    assert_status(
        &post(&running, "/-/api/repositories/owner/repo/refresh"),
        401,
    );

    // What signing in needs stays open.
    let health = running.get("/-/health");
    assert_status(&health, 200);
    for path in [
        "/-/sign-in?return_to=%2Fowner%2Frepo",
        "/-/about",
        "/-/privacy",
        "/-/not-allowed",
        "/-/sign-in-failed",
    ] {
        let response = running.get(path);
        assert_status(&response, 200);
        assert!(body(&response).contains("<title>"), "{path}: {response}");
    }
    let session = running.get("/-/api/session");
    assert_status(&session, 200);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(body(&session)).unwrap(),
        serde_json::json!({ "user": null, "token": null })
    );

    let sign_in = running.get("/-/auth/sign-in?return_to=%2Fowner%2Frepo");
    assert_status(&sign_in, 303);
    let to = header(&sign_in, "location").unwrap();
    assert!(
        to.starts_with("https://github.com/login/oauth/authorize?"),
        "{to}"
    );
    // A callback that is not the end of this browser's sign-in fails, rather than asking
    // to sign in.
    let callback = running.get("/-/auth/callback?code=x&state=y");
    assert_status(&callback, 303);
    assert_eq!(header(&callback, "location"), Some("/-/sign-in-failed"));
}

/// FR-ACC-02: in public mode, a visitor may open any dashboard, but not refresh it.
#[test]
fn public_mode_lets_visitors_view_dashboards() {
    let (running, log, _dir) = buhtig(r#"mode = "public""#);
    assert!(
        log.iter().any(|line| line.contains("access_mode=public")),
        "{log:#?}"
    );
    for path in ["/", "/owner/repo", "/acme", "/-/sign-in", "/-/settings"] {
        let response = running.get(path);
        assert_status(&response, 200);
        assert_eq!(header(&response, "location"), None, "{path}");
    }
    for path in [
        "/-/api/repositories/owner/repo/refresh",
        "/-/api/organizations/acme/refresh",
    ] {
        let response = post(&running, path);
        assert_status(&response, 401);
        assert_eq!(body(&response), "", "{path}");
    }
}
