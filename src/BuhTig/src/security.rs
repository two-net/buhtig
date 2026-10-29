//! What guards every request and response, whichever part of BuhTig answers it (SRS §6.4).
//!
//! Other sites cannot have a browser change anything in BuhTig (NFR-SEC-02). Whatever
//! changes state is a POST, PUT or DELETE, and browsers say where such a request comes
//! from: `Sec-Fetch-Site` tells how its page is related to BuhTig, and older browsers send
//! the page's `Origin` instead. A request from a page of another origin is refused before
//! anything reads its session. That needs no token, so no cookie besides the two BuhTig
//! sets (NFR-PRIV-01), and nothing of the UI, whose requests come from BuhTig's own pages.
//! A request that carries neither header does not come from a browser's page, so it brings
//! no one's cookie but its sender's.
//!
//! Every response carries a Content Security Policy, under which pages run scripts and
//! apply styles from BuhTig alone, and show images from BuhTig and GitHub's avatars
//! (NFR-SEC-06). The UI's build writes no script or style into its page, since it does not
//! inline critical CSS (`inlineCritical` in `angular.json`). Angular adds the styles of its
//! components to the page as it renders them, though, so each page names a nonce of its
//! own for those ([`with_nonce`]).
//!
//! Responses also keep other sites from framing BuhTig, browsers from guessing types, and
//! the `Referer` of requests to other sites to BuhTig's origin, and they keep browsers on
//! HTTPS once BuhTig is on it (NFR-SEC-07).
//!
//! An error says no more than its status unless BuhTig wrote it (NFR-SEC-09).

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use tracing::debug;
use url::Url;

use crate::crypto;

/// What a page has where its nonce goes, which [`with_nonce`] replaces with one of the
/// response's own: in the app's page, Angular's `ngCspNonce`.
pub const NONCE: &str = "BUHTIG_CSP_NONCE";

/// GitHub's avatar host, the one other place that pages show images from (FR-DATA-01).
const AVATARS: &str = "https://avatars.githubusercontent.com";

const SEC_FETCH_SITE: &str = "sec-fetch-site";

pub struct Security {
    /// `server.public_url`'s origin, as browsers write it in `Origin`.
    origin: String,
    /// Whether BuhTig is on HTTPS, as `server.public_url` says (IF-04). TLS is terminated
    /// in front of it (A-06), so its requests do not tell.
    https: bool,
}

impl Security {
    pub fn new(public_url: &Url) -> Security {
        Security {
            origin: public_url.origin().ascii_serialization(),
            https: public_url.scheme() == "https",
        }
    }

    /// Whether a request may do what `method` does from where `headers` say it comes
    /// from. Requests that only read may come from anywhere.
    fn admits(&self, method: &Method, headers: &HeaderMap) -> bool {
        if matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) {
            return true;
        }
        // `none` is the user's own doing, such as a bookmark.
        if let Some(site) = headers.get(SEC_FETCH_SITE) {
            return site == "same-origin" || site == "none";
        }
        headers
            .get(header::ORIGIN)
            .is_none_or(|origin| origin == self.origin.as_str())
    }
}

/// Refuses a request that would change state from another origin's page with 403
/// (NFR-SEC-02).
pub async fn same_origin(
    State(security): State<Arc<Security>>,
    request: Request,
    next: Next,
) -> Response {
    if security.admits(request.method(), request.headers()) {
        return next.run(request).await;
    }
    debug!(
        method = %request.method(),
        "refused a request from another origin's page"
    );
    (StatusCode::FORBIDDEN, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

/// Gives every response the headers of NFR-SEC-06 and NFR-SEC-07, and its [`policy`]
/// unless it has its own, and takes from an error what BuhTig did not write (NFR-SEC-09).
pub async fn headers(
    State(security): State<Arc<Security>>,
    request: Request,
    next: Next,
) -> Response {
    let mut response = plain(next.run(request).await);
    let headers = response.headers_mut();
    headers
        .entry(header::CONTENT_SECURITY_POLICY)
        .or_insert_with(|| policy(None));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    // Not `no-referrer`, under which browsers send `Origin: null` with BuhTig's own POSTs.
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    if security.https {
        // A year. Not for subdomains, which need not be BuhTig's.
        headers.insert(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000"),
        );
    }
    response
}

/// `response`, or if it is an error that BuhTig did not write, the error without its body.
///
/// BuhTig's own responses all say how long they may be kept, and axum's never do. axum
/// answers requests that it cannot read, such as a body that is no JSON, with what its
/// parser made of them.
fn plain(response: Response) -> Response {
    let status = response.status();
    if !(status.is_client_error() || status.is_server_error())
        || response.headers().contains_key(header::CACHE_CONTROL)
    {
        return response;
    }
    let (mut parts, _) = response.into_parts();
    parts.headers.remove(header::CONTENT_TYPE);
    parts.headers.remove(header::CONTENT_LENGTH);
    parts
        .headers
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Response::from_parts(parts, Body::empty())
}

/// The Content Security Policy of a response (NFR-SEC-06): scripts, styles and everything
/// else from BuhTig alone, besides styles in elements that carry `nonce`, if there is one,
/// and images from GitHub's avatar host. Nothing may frame BuhTig or embed objects, and
/// pages may not move their base or send their forms elsewhere.
pub fn policy(nonce: Option<&str>) -> HeaderValue {
    let style = match nonce {
        Some(nonce) => format!("'self' 'nonce-{nonce}'"),
        None => "'self'".to_owned(),
    };
    HeaderValue::try_from(format!(
        "default-src 'self'; script-src 'self'; style-src {style}; img-src 'self' {AVATARS}; \
         object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    ))
    .expect("a nonce of base64url is a header")
}

/// `page` with a new nonce wherever it has [`NONCE`], and the [`policy`] under which its
/// styles with that nonce apply. A page without one is as any other response.
pub fn with_nonce(page: &[u8]) -> (HeaderValue, Vec<u8>) {
    let placeholder = NONCE.as_bytes();
    if find(page, placeholder).is_none() {
        return (policy(None), page.to_vec());
    }
    let nonce = crypto::random_id();
    let mut with = Vec::with_capacity(page.len());
    let mut rest = page;
    while let Some(at) = find(rest, placeholder) {
        with.extend_from_slice(&rest[..at]);
        with.extend_from_slice(nonce.as_bytes());
        rest = &rest[at + placeholder.len()..];
    }
    with.extend_from_slice(rest);
    (policy(Some(&nonce)), with)
}

/// The nonce that `policy` lets styles in with.
#[cfg(test)]
pub fn nonce(policy: &HeaderValue) -> &str {
    let policy = policy.to_str().unwrap();
    let start = policy.find("'nonce-").unwrap() + "'nonce-".len();
    let end = start + policy[start..].find('\'').unwrap();
    &policy[start..end]
}

/// Where `needle` first is in `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    use axum::routing::{get, post, put};
    use axum::{Json, Router, middleware};
    use serde_json::Value;
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    use super::*;
    use crate::web;

    const PUBLIC_URL: &str = "https://buhtig.example.com";

    fn security(public_url: &str) -> Arc<Security> {
        Arc::new(Security::new(&Url::parse(public_url).unwrap()))
    }

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        pairs
            .iter()
            .map(|(name, value)| (name.parse().unwrap(), HeaderValue::from_static(value)))
            .collect()
    }

    #[test]
    fn only_buhtigs_own_pages_may_change_state() {
        let security = security(PUBLIC_URL);
        let changes = [Method::POST, Method::PUT, Method::DELETE, Method::PATCH];
        for (pairs, admitted) in [
            (vec![("sec-fetch-site", "same-origin")], true),
            (vec![("sec-fetch-site", "none")], true),
            (vec![("sec-fetch-site", "same-site")], false),
            (vec![("sec-fetch-site", "cross-site")], false),
            (vec![("sec-fetch-site", "")], false),
            // Browsers that send it say where a request comes from with it alone.
            (
                vec![
                    ("sec-fetch-site", "cross-site"),
                    ("origin", "https://buhtig.example.com"),
                ],
                false,
            ),
            (vec![("origin", "https://buhtig.example.com")], true),
            (vec![("origin", "https://evil.example")], false),
            (
                vec![("origin", "https://buhtig.example.com.evil.example")],
                false,
            ),
            (vec![("origin", "http://buhtig.example.com")], false),
            (vec![("origin", "https://buhtig.example.com:8443")], false),
            (vec![("origin", "null")], false),
            // Not from a browser's page.
            (vec![], true),
        ] {
            for method in &changes {
                assert_eq!(
                    security.admits(method, &headers(&pairs)),
                    admitted,
                    "{method} {pairs:?}"
                );
            }
        }
        for method in [Method::GET, Method::HEAD, Method::OPTIONS] {
            let headers = headers(&[
                ("sec-fetch-site", "cross-site"),
                ("origin", "https://evil.example"),
            ]);
            assert!(security.admits(&method, &headers), "{method}");
        }

        let local = self::security("http://localhost:8080");
        let from = |origin| headers(&[("origin", origin)]);
        assert!(local.admits(&Method::POST, &from("http://localhost:8080")));
        assert!(!local.admits(&Method::POST, &from("http://localhost:4200")));
    }

    #[test]
    fn policies_let_in_styles_with_their_nonce_alone() {
        assert_eq!(
            policy(None),
            "default-src 'self'; script-src 'self'; style-src 'self'; \
             img-src 'self' https://avatars.githubusercontent.com; object-src 'none'; \
             base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
        );
        assert_eq!(
            policy(Some("abc_-1")),
            "default-src 'self'; script-src 'self'; style-src 'self' 'nonce-abc_-1'; \
             img-src 'self' https://avatars.githubusercontent.com; object-src 'none'; \
             base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
        );
    }

    #[test]
    fn each_page_gets_a_nonce_of_its_own() {
        let page = format!("<style nonce=\"{NONCE}\"></style><app-root ngCspNonce=\"{NONCE}\">");
        let (policy, with) = with_nonce(page.as_bytes());
        let nonce = nonce(&policy).to_owned();
        assert_eq!(nonce.len(), 43);
        assert_eq!(
            String::from_utf8(with).unwrap(),
            format!("<style nonce=\"{nonce}\"></style><app-root ngCspNonce=\"{nonce}\">")
        );

        let (again, _) = with_nonce(page.as_bytes());
        assert_ne!(self::nonce(&again), nonce);

        let (policy, with) = with_nonce(b"<p>no styles</p>");
        assert_eq!(policy, self::policy(None));
        assert_eq!(with, b"<p>no styles</p>");
    }

    /// An app guarded as BuhTig is, behind `public_url`.
    fn app(public_url: &str) -> Router {
        let security = security(public_url);
        Router::new()
            .route("/", get(|| async { "page" }))
            .route("/-/auth/sign-out", post(|| async { "signed out" }))
            .route(
                "/-/api/token",
                put(|Json(_): Json<Value>| async { "saved" }),
            )
            .route(
                "/-/health",
                get(|| async {
                    (
                        StatusCode::SERVICE_UNAVAILABLE,
                        [(header::CACHE_CONTROL, "no-store")],
                        "unavailable\n",
                    )
                }),
            )
            .route(
                "/-/own",
                get(|| async {
                    (
                        [(header::CONTENT_SECURITY_POLICY, "default-src 'none'")],
                        "own",
                    )
                }),
            )
            .layer(middleware::from_fn_with_state(
                security.clone(),
                same_origin,
            ))
            .layer(middleware::from_fn_with_state(security, super::headers))
    }

    /// Serves `app` as BuhTig does, and sends it `request` with `headers` and `body`. The
    /// status line, the headers by their lowercase names, and the body.
    async fn send(
        app: Router,
        request: &str,
        headers: &str,
        body: &str,
    ) -> (String, Vec<(String, String)>, String) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (stop, stopped) = oneshot::channel::<()>();
        let shutdown = async {
            let _ = stopped.await;
        };
        let server = tokio::spawn(web::serve(listener, app, shutdown, Duration::from_secs(5)));
        let raw = format!(
            "{request} HTTP/1.1\r\nHost: test\r\nConnection: close\r\nContent-Length: {}\r\n\
             {headers}\r\n{body}",
            body.len()
        );
        let response = tokio::task::spawn_blocking(move || {
            let mut stream = TcpStream::connect(address).unwrap();
            stream.write_all(raw.as_bytes()).unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            response
        })
        .await
        .unwrap();
        stop.send(()).unwrap();
        server.await.unwrap().unwrap();

        let (head, body) = response.split_once("\r\n\r\n").unwrap();
        let mut lines = head.lines();
        let status = lines.next().unwrap().to_owned();
        let headers = lines
            .filter_map(|line| line.split_once(": "))
            .map(|(name, value)| (name.to_owned(), value.to_owned()))
            .collect();
        (status, headers, body.to_owned())
    }

    fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
        headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    /// The headers that every response carries, besides `content-security-policy`.
    fn assert_guarded(headers: &[(String, String)], https: bool) {
        assert_eq!(header(headers, "x-content-type-options"), Some("nosniff"));
        assert_eq!(header(headers, "x-frame-options"), Some("DENY"));
        assert_eq!(
            header(headers, "referrer-policy"),
            Some("strict-origin-when-cross-origin")
        );
        assert_eq!(
            header(headers, "strict-transport-security"),
            https.then_some("max-age=31536000"),
            "{headers:?}"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn every_response_is_guarded() {
        let (status, headers, body) = send(app(PUBLIC_URL), "GET /", "", "").await;
        assert!(status.starts_with("HTTP/1.1 200 "), "{status}");
        assert_eq!(body, "page");
        assert_guarded(&headers, true);
        assert_eq!(
            header(&headers, "content-security-policy"),
            Some(policy(None).to_str().unwrap())
        );

        // HTTPS alone keeps browsers on HTTPS.
        let (_, headers, _) = send(app("http://localhost:8080"), "GET /", "", "").await;
        assert_guarded(&headers, false);

        // A response's own policy is kept.
        let (_, headers, body) = send(app(PUBLIC_URL), "GET /-/own", "", "").await;
        assert_eq!(body, "own");
        assert_eq!(
            header(&headers, "content-security-policy"),
            Some("default-src 'none'")
        );
        assert_guarded(&headers, true);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn other_origins_cannot_change_state() {
        for from in [
            "Sec-Fetch-Site: cross-site\r\n",
            "Origin: https://evil.example\r\n",
        ] {
            let (status, headers, body) =
                send(app(PUBLIC_URL), "POST /-/auth/sign-out", from, "").await;
            assert!(status.starts_with("HTTP/1.1 403 "), "{from}{status}");
            assert_eq!(header(&headers, "cache-control"), Some("no-store"));
            assert_eq!(body, "");
            assert_guarded(&headers, true);
        }
        for from in [
            "Sec-Fetch-Site: same-origin\r\nOrigin: https://buhtig.example.com\r\n",
            "Origin: https://buhtig.example.com\r\n",
            "",
        ] {
            let (status, _, body) = send(app(PUBLIC_URL), "POST /-/auth/sign-out", from, "").await;
            assert!(status.starts_with("HTTP/1.1 200 "), "{from}{status}");
            assert_eq!(body, "signed out");
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn errors_say_no_more_than_buhtig_wrote() {
        // axum's own answers to what it cannot read lose what they say of it.
        for (headers, body) in [
            ("Content-Type: application/json\r\n", "{\"token\": "),
            ("", "{\"token\": \"x\"}"),
        ] {
            let (status, response, text) =
                send(app(PUBLIC_URL), "PUT /-/api/token", headers, body).await;
            assert!(status.starts_with("HTTP/1.1 4"), "{status}");
            assert_eq!(text, "", "{status}");
            assert_eq!(header(&response, "cache-control"), Some("no-store"));
            assert_eq!(header(&response, "content-type"), None);
            assert_guarded(&response, true);
        }
        let (status, headers, body) = send(app(PUBLIC_URL), "DELETE /", "", "").await;
        assert!(status.starts_with("HTTP/1.1 405 "), "{status}");
        assert_eq!(body, "");
        assert_eq!(header(&headers, "allow"), Some("GET,HEAD"));

        // BuhTig's own are kept as they are.
        let (status, headers, body) = send(app(PUBLIC_URL), "GET /-/health", "", "").await;
        assert!(status.starts_with("HTTP/1.1 503 "), "{status}");
        assert_eq!(body, "unavailable\n");
        assert_eq!(
            header(&headers, "content-type"),
            Some("text/plain; charset=utf-8")
        );
    }
}
