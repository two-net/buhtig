//! Starts the real binary to check what guards every request and response, whichever part
//! of BuhTig answers it (SRS §6.4).

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

/// A BuhTig with the five required keys alone, on `https://buhtig.example.com`, and the
/// directory of its config file, which must outlive it.
fn buhtig() -> (Running, tempfile::TempDir) {
    let cluster = cluster();
    let dir = tempfile::tempdir().unwrap();
    let config = minimal_config(&cluster.url(&cluster.create_database()));
    let (running, _) = start(&write_config(&dir, &config, 0o600));
    (running, dir)
}

/// Sends `request`, such as `POST /path`, with `headers` and `body`.
fn send(running: &Running, request: &str, headers: &str, body: &str) -> String {
    running.request(&format!(
        "{request} HTTP/1.1\r\nHost: {}\r\nContent-Length: {}\r\nConnection: close\r\n\
         {headers}\r\n{body}",
        running.address,
        body.len()
    ))
}

/// NFR-SEC-06, NFR-SEC-07: pages, data, files, redirects and errors alike.
#[test]
fn every_response_is_guarded() {
    let (running, _dir) = buhtig();
    for response in [
        running.get("/"),
        running.get("/owner/repo"),
        running.get("/owner/repo/pull/42"),
        running.get("/favicon.ico"),
        running.get("/-/health"),
        running.get("/-/api/session"),
        send(&running, "DELETE /-/api/history", "", ""),
        send(&running, "DELETE /", "", ""),
    ] {
        let status = response.lines().next().unwrap();
        assert_eq!(
            header(&response, "x-content-type-options"),
            Some("nosniff"),
            "{status}"
        );
        assert_eq!(
            header(&response, "x-frame-options"),
            Some("DENY"),
            "{status}"
        );
        assert_eq!(
            header(&response, "referrer-policy"),
            Some("strict-origin-when-cross-origin"),
            "{status}"
        );
        // `server.public_url` is https.
        assert_eq!(
            header(&response, "strict-transport-security"),
            Some("max-age=31536000"),
            "{status}"
        );
        let policy = header(&response, "content-security-policy").unwrap();
        for directive in [
            "default-src 'self'",
            "script-src 'self';",
            "img-src 'self' https://avatars.githubusercontent.com",
            "frame-ancestors 'none'",
        ] {
            assert!(policy.contains(directive), "{status}: {policy}");
        }
    }

    // The app's page lets in the styles that carry its nonce, if the UI is built and has
    // somewhere to put one, and no other page's.
    let page = running.get("/");
    let policy = header(&page, "content-security-policy").unwrap();
    assert!(!body(&page).contains("BUHTIG_CSP_NONCE"), "{page}");
    if let Some((_, rest)) = policy.split_once("'nonce-") {
        let nonce = rest.split('\'').next().unwrap();
        assert!(body(&page).contains(&format!("=\"{nonce}\"")), "{page}");
        let again = running.get("/");
        assert!(!body(&again).contains(nonce));
    }
}

/// NFR-SEC-02: whatever changes state, other origins' pages cannot ask for.
#[test]
fn other_origins_pages_cannot_change_state() {
    let (running, _dir) = buhtig();
    for from in [
        "Sec-Fetch-Site: cross-site\r\n",
        "Sec-Fetch-Site: same-site\r\nOrigin: https://www.example.com\r\n",
        "Origin: https://evil.example\r\n",
        "Origin: null\r\n",
    ] {
        for request in [
            "POST /-/auth/sign-out",
            "POST /-/api/repositories/owner/repo/refresh",
            "POST /-/api/organizations/acme/view",
            "PUT /-/api/repositories/owner/repo/pin",
            "PUT /-/api/pins",
            "PUT /-/api/token",
            "DELETE /-/api/history",
            "DELETE /-/api/token",
            "DELETE /-/api/user",
        ] {
            let response = send(&running, request, from, "");
            assert_status(&response, 403);
            assert_eq!(header(&response, "cache-control"), Some("no-store"));
            assert_eq!(body(&response), "", "{request}");
        }
    }

    // BuhTig's own pages may, and clients that are no browser.
    for from in [
        "Sec-Fetch-Site: same-origin\r\nOrigin: https://buhtig.example.com\r\n",
        "Origin: https://buhtig.example.com\r\n",
        "",
    ] {
        let response = send(&running, "POST /-/auth/sign-out", from, "");
        assert_status(&response, 303);
        assert_eq!(header(&response, "location"), Some("/"));
        // A visitor is then asked to sign in.
        assert_status(&send(&running, "DELETE /-/api/history", from, ""), 401);
    }
}

/// NFR-SEC-09: what BuhTig cannot read gets its status alone, rather than what axum or a
/// parser makes of it.
#[test]
fn errors_say_nothing_of_how_buhtig_works() {
    let (running, _dir) = buhtig();
    for (request, headers, sent, status) in [
        (
            "PUT /-/api/token",
            "Content-Type: application/json\r\n",
            "{\"token\": ",
            400,
        ),
        ("PUT /-/api/pins", "", "{\"pins\": []}", 415),
        ("GET /-/api/repositories/%FF/repo", "", "", 400),
        ("GET /-/api/organizations/%C3%28", "", "", 400),
    ] {
        let response = send(&running, request, headers, sent);
        assert_status(&response, status);
        assert_eq!(body(&response), "", "{request}");
        assert_eq!(header(&response, "content-type"), None, "{request}");
        assert_eq!(header(&response, "cache-control"), Some("no-store"));
    }
}
