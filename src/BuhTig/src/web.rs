//! BuhTig's HTTP side: its routes, the line it logs for each request (FR-OPS-04), the
//! page it shows while its database is unreachable (FR-DB-09), and how it stops
//! (FR-OPS-05). What guards every request and response is [`crate::security`]'s.
//!
//! Every path of BuhTig's own is under `/-/` (FR-NAV-03), and every other path is a
//! dashboard's (SRS §4.2). What is under `/-/api/` serves BuhTig's UI alone. It is not a
//! public API, and may change in any release (IF-06).
//!
//! TLS is terminated in front of BuhTig (A-06), so it serves plain HTTP.

use std::future::{Future, IntoFuture};
use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Router};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower_http::compression::predicate::{And, NotForContentType, Predicate, SizeAbove};
use tower_http::compression::{CompressionLayer, CompressionLevel};
use tracing::{error, info, warn};
use url::Url;

use crate::access;
use crate::accounts;
use crate::auth::{self, Auth};
use crate::cache::Cache;
use crate::config::AccessMode;
use crate::health::{self, Health};
use crate::navigation;
use crate::organizations;
use crate::preview::Previews;
use crate::repositories;
use crate::security::{self, Security};
use crate::session::{self, Sessions};
use crate::shortcuts::{self, Shortcuts};
use crate::surprise;
use crate::tokens::{self, Tokens};
use crate::ui::{self, Ui};

/// The page shown in place of BuhTig's own while its database is unreachable. It says
/// what happened and what to do (NFR-UX-06), and nothing about why (NFR-SEC-09).
const UNAVAILABLE: &str = include_str!("unavailable.html");

/// What serving the app's page takes.
#[derive(Clone)]
struct Pages {
    health: Arc<Health>,
    /// Link previews of dashboards (FR-NAV-06), unless there are none to give.
    previews: Option<Arc<Previews>>,
    /// `ui.animations`: whether the UI may move (FR-ANIM-10).
    animations: bool,
}

/// Every request may carry a session, so each has the [`Sessions`] at hand, to tell who
/// it comes from. In private mode, a gate in front of every route lets visitors through
/// only to what signing in needs ([`access`]). In front of that is what [`guard`] puts
/// around every route.
#[expect(
    clippy::too_many_arguments,
    reason = "each is a part of BuhTig that its routes serve"
)]
pub fn router(
    mode: AccessMode,
    public_url: &Url,
    health: Arc<Health>,
    cache: Arc<Cache>,
    previews: Option<Previews>,
    sessions: Arc<Sessions>,
    auth: Arc<Auth>,
    tokens: Arc<Tokens>,
    shortcuts: Arc<Shortcuts>,
    animations: bool,
) -> Router {
    let pages = Pages {
        health: health.clone(),
        previews: previews.map(Arc::new),
        animations,
    };
    let router = Router::new()
        .route("/-/health", get(health::check))
        .route(
            "/-/auth/sign-in",
            get(auth::sign_in).with_state(auth.clone()),
        )
        .route(
            "/-/auth/callback",
            get(auth::callback).with_state(auth.clone()),
        )
        .route("/-/auth/sign-out", post(auth::sign_out).with_state(auth))
        .route(
            "/-/api/accounts/{name}",
            get(accounts::kind).with_state(cache.clone()),
        )
        .route(
            "/-/api/organizations/{org}",
            get(organizations::summary).with_state(cache.clone()),
        )
        .route(
            "/-/api/organizations/{org}/stats",
            get(organizations::stats).with_state(cache.clone()),
        )
        .route(
            "/-/api/organizations/{org}/repositories",
            get(organizations::repositories).with_state(cache.clone()),
        )
        .route(
            "/-/api/organizations/{org}/languages",
            get(organizations::languages).with_state(cache.clone()),
        )
        .route(
            "/-/api/organizations/{org}/top-repositories",
            get(organizations::top_repositories).with_state(cache.clone()),
        )
        .route(
            "/-/api/organizations/{org}/last-push",
            get(organizations::last_push).with_state(cache.clone()),
        )
        .route(
            "/-/api/organizations/{org}/created-per-year",
            get(organizations::created_per_year).with_state(cache.clone()),
        )
        .route(
            "/-/api/organizations/{org}/members",
            get(organizations::members).with_state(cache.clone()),
        )
        .route(
            "/-/api/organizations/{org}/refresh",
            post(organizations::refresh).with_state(cache.clone()),
        )
        .route(
            "/-/api/organizations/{org}/view",
            post(shortcuts::view).with_state(shortcuts.clone()),
        )
        .route(
            "/-/api/organizations/{org}/pin",
            put(shortcuts::pin)
                .delete(shortcuts::unpin)
                .with_state(shortcuts.clone()),
        )
        .route(
            "/-/api/repositories/{owner}/{repo}",
            get(repositories::summary).with_state(cache.clone()),
        )
        .route(
            "/-/api/repositories/{owner}/{repo}/stats",
            get(repositories::stats).with_state(cache.clone()),
        )
        .route(
            "/-/api/repositories/{owner}/{repo}/commit-activity",
            get(repositories::commit_activity).with_state(cache.clone()),
        )
        .route(
            "/-/api/repositories/{owner}/{repo}/languages",
            get(repositories::languages).with_state(cache.clone()),
        )
        .route(
            "/-/api/repositories/{owner}/{repo}/contributors",
            get(repositories::contributors).with_state(cache.clone()),
        )
        .route(
            "/-/api/repositories/{owner}/{repo}/issues",
            get(repositories::issues).with_state(cache.clone()),
        )
        .route(
            "/-/api/repositories/{owner}/{repo}/commits",
            get(repositories::commits).with_state(cache.clone()),
        )
        .route(
            "/-/api/repositories/{owner}/{repo}/releases",
            get(repositories::releases).with_state(cache.clone()),
        )
        .route(
            "/-/api/repositories/{owner}/{repo}/refresh",
            post(repositories::refresh).with_state(cache.clone()),
        )
        .route(
            "/-/api/repositories/{owner}/{repo}/view",
            post(shortcuts::view).with_state(shortcuts.clone()),
        )
        .route(
            "/-/api/repositories/{owner}/{repo}/pin",
            put(shortcuts::pin)
                .delete(shortcuts::unpin)
                .with_state(shortcuts.clone()),
        )
        .route("/-/api/session", get(session::current))
        .route("/-/api/user", delete(session::delete))
        .route(
            "/-/api/shortcuts",
            get(shortcuts::list).with_state(shortcuts.clone()),
        )
        .route(
            "/-/api/history",
            delete(shortcuts::clear_history).with_state(shortcuts.clone()),
        )
        .route("/-/api/pins", put(shortcuts::reorder).with_state(shortcuts))
        .route(
            "/-/api/token",
            put(tokens::save).delete(tokens::remove).with_state(tokens),
        )
        .route("/-/api/surprise", get(surprise::pick).with_state(cache))
        .fallback(get(page).with_state(pages))
        .with_state(health);
    let router = match mode {
        AccessMode::Public => router,
        AccessMode::Private => router.layer(middleware::from_fn(access::gate::<Ui>)),
    };
    // Outside the gate, which needs them to tell who a request is from.
    guard(router.layer(Extension(sessions)), public_url)
}

/// `router`, with what every request and response of BuhTig's goes through: requests from
/// other origins' pages are refused, every response is guarded, as `public_url` calls for
/// ([`security`]), larger ones are compressed, and each is logged.
fn guard(router: Router, public_url: &Url) -> Router {
    let security = Arc::new(Security::new(public_url));
    router
        // Before anything reads a session, so that a forged request changes nothing.
        .layer(middleware::from_fn_with_state(
            security.clone(),
            security::same_origin,
        ))
        // Every response, whichever part answered, a refused request's too.
        .layer(middleware::from_fn_with_state(security, security::headers))
        // Outside the guard, which may take an error's body, so that what it sends is what
        // was compressed.
        .layer(compression())
        // Outermost, so that every response is logged, whichever part answered.
        .layer(middleware::from_fn(log_request))
}

/// Gzips each response of 1 KB or more but an image's, for a browser that accepts it, as
/// fast as gzip goes, which costs little CPU (NFR-CAP-01) for much less to send: an
/// organization's repository table shrinks to about a tenth (NFR-PERF-03). The files of
/// the UI come compressed already, at their best ([`ui::asset`]), and a response that is
/// compressed already is sent as it is. Smaller responses would gain too little.
///
/// No response carries a secret beside what an attacker could choose, which is what would
/// let them read it from how well it compresses (BREACH): there are no CSRF tokens, and a
/// page's nonce is new in each response.
fn compression() -> CompressionLayer<And<SizeAbove, NotForContentType>> {
    CompressionLayer::new()
        .quality(CompressionLevel::Fastest)
        .compress_when(SizeAbove::new(1024).and(NotForContentType::IMAGES))
}

/// Every other path: a file of the UI, a redirect from a page beneath a dashboard to the
/// dashboard, or else the app, which takes the path as its route (`/owner/repo`,
/// `/-/about`, …). A dashboard's page carries its link preview, if it has one, and every
/// page says when the UI is to keep still.
async fn page(State(pages): State<Pages>, uri: Uri, headers: HeaderMap) -> Response {
    if let Some(asset) = ui::asset::<Ui>(uri.path(), &headers) {
        return asset;
    }
    // A GitHub link with BuhTig's host opens the dashboard (FR-NAV-02). That needs no
    // database either.
    if let Some(dashboard) = navigation::redirect(uri.path()) {
        return moved(&dashboard);
    }
    // The files need no database, but the app does for nearly everything it shows.
    if !pages.health.database_reachable().await {
        return unavailable();
    }
    let preview = match &pages.previews {
        Some(previews) => previews.of(uri.path()).await,
        None => None,
    };
    let preload = navigation::dashboard_at(uri.path())
        .is_some()
        .then(ui::dashboard_preload::<Ui>)
        .flatten();
    let tags = preview.map(|preview| preview.tags());
    ui::app::<Ui>(head(preload, tags, pages.animations).as_deref())
}

/// What the app's page adds to its `<head>`: a dashboard's `preload` of its code and its
/// link preview `tags`, and [`ui::STILL`] unless `animations` are on. `None` if that is
/// nothing.
fn head(preload: Option<String>, tags: Option<String>, animations: bool) -> Option<String> {
    let mut head = preload.unwrap_or_default();
    head.push_str(&tags.unwrap_or_default());
    if !animations {
        head.push_str(ui::STILL);
    }
    (!head.is_empty()).then_some(head)
}

/// The response to a request for a page beneath `dashboard`, or another path to it.
///
/// The redirect is permanent, so that links and previews take the dashboard's URL. Yet
/// browsers check it again each time, so that a later release can give such pages their
/// own place.
fn moved(dashboard: &str) -> Response {
    (
        [(header::CACHE_CONTROL, "no-cache")],
        Redirect::permanent(dashboard),
    )
        .into_response()
}

/// The response to a request that needs the database while it is unreachable. Its style
/// has a nonce, as the app's page does (NFR-SEC-06).
pub(crate) fn unavailable() -> Response {
    let (policy, page) = security::with_nonce(UNAVAILABLE.as_bytes());
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            (header::RETRY_AFTER, HeaderValue::from_static("30")),
            (header::CONTENT_SECURITY_POLICY, policy),
        ],
        Html(page),
    )
        .into_response()
}

/// Logs one line per request: its method, path, status and how long it took to answer.
///
/// Only the path, never the query string, which can carry an OAuth code, or the headers,
/// which can carry a session cookie.
async fn log_request(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let start = Instant::now();
    let response = next.run(request).await;
    info!(
        %method,
        %path,
        status = response.status().as_u16(),
        duration = ?start.elapsed(),
        "handled request"
    );
    response
}

/// Serves `app` until `shutdown` resolves. It then stops accepting connections, closes
/// idle ones, and lets the requests in flight finish, for at most `grace`.
///
/// Each request carries the address it comes from, which tells visitors apart
/// (FR-DATA-10).
pub async fn serve(
    listener: TcpListener,
    app: Router,
    shutdown: impl Future<Output = ()> + Send + 'static,
    grace: Duration,
) -> io::Result<()> {
    let (stopping, stopped) = oneshot::channel();
    let app = app.into_make_service_with_connect_info::<SocketAddr>();
    let server = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown.await;
            let _ = stopping.send(());
        })
        .into_future();
    tokio::pin!(server);
    tokio::select! {
        result = &mut server => result,
        Ok(()) = stopped => match tokio::time::timeout(grace, server).await {
            Ok(result) => result,
            Err(_) => {
                warn!("requests still in flight after {grace:?}; stopping anyway");
                Ok(())
            }
        },
    }
}

/// Resolves when BuhTig is asked to stop: by Ctrl-C (SIGINT), or by SIGTERM, which
/// service managers and container runtimes send.
pub async fn shutdown_signal(grace: Duration) {
    let interrupt = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            error!("cannot listen for Ctrl-C: {error}");
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{SignalKind, signal};

        match signal(SignalKind::terminate()) {
            Ok(mut terminate) => {
                terminate.recv().await;
            }
            Err(error) => {
                error!("cannot listen for SIGTERM: {error}");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = interrupt => {}
        () = terminate => {}
    }
    info!("shutting down; waiting up to {grace:?} for requests in flight");
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    use tokio::task::JoinHandle;

    use super::*;
    use crate::visitors::Visitor;

    /// Serves an app whose one route takes `delay` to answer, until the returned sender
    /// is used or dropped.
    async fn serve_slowly(
        delay: Duration,
        grace: Duration,
    ) -> (SocketAddr, oneshot::Sender<()>, JoinHandle<io::Result<()>>) {
        let app = Router::new().route(
            "/",
            get(move || async move {
                tokio::time::sleep(delay).await;
                "done"
            }),
        );
        spawn(app, grace).await
    }

    /// Serves `app` on a port of its own, until the returned sender is used or dropped.
    async fn spawn(
        app: Router,
        grace: Duration,
    ) -> (SocketAddr, oneshot::Sender<()>, JoinHandle<io::Result<()>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (stop, stopped) = oneshot::channel::<()>();
        let shutdown = async {
            let _ = stopped.await;
        };
        let server = tokio::spawn(serve(listener, app, shutdown, grace));
        (address, stop, server)
    }

    /// Sends `GET /` from a blocking thread, and returns the whole response.
    fn request(address: SocketAddr) -> JoinHandle<io::Result<String>> {
        tokio::task::spawn_blocking(move || {
            let mut stream = TcpStream::connect(address)?;
            stream.set_read_timeout(Some(Duration::from_secs(30)))?;
            stream.write_all(b"GET / HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n")?;
            let mut response = String::new();
            stream.read_to_string(&mut response)?;
            Ok(response)
        })
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn shutdown_lets_requests_in_flight_finish_and_refuses_new_ones() {
        let (address, stop, server) =
            serve_slowly(Duration::from_millis(800), Duration::from_secs(10)).await;
        let in_flight = request(address);
        tokio::time::sleep(Duration::from_millis(200)).await;
        stop.send(()).unwrap();

        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!in_flight.is_finished());
        assert!(TcpStream::connect(address).is_err(), "still accepting");

        let response = in_flight.await.unwrap().unwrap();
        assert!(response.starts_with("HTTP/1.1 200 "), "{response}");
        assert!(response.ends_with("\r\n\r\ndone"), "{response}");
        server.await.unwrap().unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn requests_say_where_they_come_from() {
        let app = Router::new().route(
            "/",
            get(|visitor: Visitor| async move { format!("{visitor:?}") }),
        );
        let (address, stop, server) = spawn(app, Duration::from_secs(10)).await;
        let response = request(address).await.unwrap().unwrap();
        assert!(response.starts_with("HTTP/1.1 200 "), "{response}");
        assert!(
            response.ends_with("\r\n\r\nVisitor(127.0.0.1)"),
            "{response}"
        );
        stop.send(()).unwrap();
        server.await.unwrap().unwrap();
    }

    #[test]
    fn pages_say_to_keep_still_only_when_animations_are_off() {
        assert_eq!(head(None, None, true), None);
        assert_eq!(head(None, None, false).as_deref(), Some(ui::STILL));

        let tags = "<meta name=\"description\" content=\"x\">\n";
        assert_eq!(head(None, Some(tags.into()), true).as_deref(), Some(tags));
        assert_eq!(
            head(None, Some(tags.into()), false),
            Some(format!("{tags}{}", ui::STILL))
        );
    }

    #[test]
    fn dashboards_preload_their_code_before_all_else() {
        let preload = "<link rel=\"modulepreload\" href=\"/dashboard-ABCDEFGH.js\">\n";
        let tags = "<meta name=\"description\" content=\"x\">\n";
        assert_eq!(
            head(Some(preload.into()), Some(tags.into()), false),
            Some(format!("{preload}{tags}{}", ui::STILL))
        );
    }

    #[tokio::test]
    async fn the_unavailable_page_has_a_style_of_its_own() {
        let response = unavailable();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let nonce =
            security::nonce(&response.headers()[header::CONTENT_SECURITY_POLICY]).to_owned();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();
        assert!(
            body.contains(&format!("<style nonce=\"{nonce}\">")),
            "{body}"
        );
        assert!(!body.contains(security::NONCE), "{body}");
    }

    /// A JSON body of about `size` bytes.
    fn json_of(size: usize) -> String {
        format!("{{\"padding\": \"{}\"}}", "widget ".repeat(size / 7))
    }

    /// Routes that answer as BuhTig's do, behind what guards BuhTig's, each with a response
    /// that compression must tell apart from the others.
    fn guarded() -> Router {
        let json = |size| {
            (
                [
                    (header::CACHE_CONTROL, "no-cache"),
                    (header::CONTENT_TYPE, "application/json"),
                ],
                json_of(size),
            )
        };
        let routes = Router::new()
            .route("/large", get(move || async move { json(4096) }))
            .route("/small", get(move || async move { json(100) }))
            .route(
                "/image",
                get(|| async {
                    (
                        [
                            (header::CACHE_CONTROL, "no-cache"),
                            (header::CONTENT_TYPE, "image/png"),
                        ],
                        vec![7u8; 4096],
                    )
                }),
            )
            // As a file of the UI comes, compressed already.
            .route(
                "/encoded",
                get(|| async {
                    (
                        [
                            (header::CACHE_CONTROL, "no-cache"),
                            (header::CONTENT_TYPE, "text/javascript"),
                            (header::CONTENT_ENCODING, "br"),
                        ],
                        vec![7u8; 4096],
                    )
                }),
            )
            // An error that BuhTig did not write, whose body the guard takes.
            .route(
                "/failed",
                get(|| async { (StatusCode::BAD_REQUEST, json_of(4096)) }),
            );
        guard(routes, &Url::parse("https://buhtig.example.com").unwrap())
    }

    /// Sends `GET path` with `headers` to `app`, served as BuhTig is. The status line, the
    /// headers by their lowercase names, and the body as it came, but for its chunks.
    async fn get_from(
        app: Router,
        path: &str,
        headers: &str,
    ) -> (String, Vec<(String, String)>, Vec<u8>) {
        let (address, stop, server) = spawn(app, Duration::from_secs(5)).await;
        let raw =
            format!("GET {path} HTTP/1.1\r\nHost: test\r\nConnection: close\r\n{headers}\r\n");
        let response = tokio::task::spawn_blocking(move || {
            let mut stream = TcpStream::connect(address).unwrap();
            stream.write_all(raw.as_bytes()).unwrap();
            let mut response = Vec::new();
            stream.read_to_end(&mut response).unwrap();
            response
        })
        .await
        .unwrap();
        stop.send(()).unwrap();
        server.await.unwrap().unwrap();

        let end = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .unwrap();
        let head = String::from_utf8(response[..end].to_vec()).unwrap();
        let mut lines = head.lines();
        let status = lines.next().unwrap().to_owned();
        let headers: Vec<(String, String)> = lines
            .filter_map(|line| line.split_once(": "))
            .map(|(name, value)| (name.to_owned(), value.to_owned()))
            .collect();
        let mut body = &response[end + 4..];
        if !headers
            .iter()
            .any(|(name, value)| name == "transfer-encoding" && value == "chunked")
        {
            return (status, headers, body.to_vec());
        }
        let mut chunks = Vec::new();
        loop {
            let line = body
                .windows(2)
                .position(|window| window == b"\r\n")
                .unwrap();
            let size =
                usize::from_str_radix(std::str::from_utf8(&body[..line]).unwrap(), 16).unwrap();
            if size == 0 {
                return (status, headers, chunks);
            }
            chunks.extend_from_slice(&body[line + 2..line + 2 + size]);
            body = &body[line + 2 + size + 2..];
        }
    }

    fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
        headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn large_responses_are_gzipped_for_browsers_that_accept_it() {
        let accepts = "Accept-Encoding: gzip, deflate, br, zstd\r\n";
        let (status, headers, body) = get_from(guarded(), "/large", accepts).await;
        assert!(status.starts_with("HTTP/1.1 200 "), "{status}");
        assert_eq!(header(&headers, "content-encoding"), Some("gzip"));
        assert_eq!(header(&headers, "vary"), Some("accept-encoding"));
        let mut plain = String::new();
        flate2::read::GzDecoder::new(&body[..])
            .read_to_string(&mut plain)
            .unwrap();
        assert_eq!(plain, json_of(4096));
        assert!(body.len() < plain.len() / 10, "{} bytes", body.len());
        // Still guarded.
        assert_eq!(header(&headers, "x-content-type-options"), Some("nosniff"));

        for refuses in [
            "",
            "Accept-Encoding: gzip;q=0\r\n",
            "Accept-Encoding: identity\r\n",
        ] {
            let (_, headers, body) = get_from(guarded(), "/large", refuses).await;
            assert_eq!(header(&headers, "content-encoding"), None, "{refuses}");
            assert_eq!(body, json_of(4096).as_bytes(), "{refuses}");
            let length = json_of(4096).len().to_string();
            assert_eq!(header(&headers, "content-length"), Some(length.as_str()));
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn small_images_and_encoded_responses_are_sent_as_they_are() {
        let accepts = "Accept-Encoding: gzip\r\n";
        let (_, headers, body) = get_from(guarded(), "/small", accepts).await;
        assert_eq!(header(&headers, "content-encoding"), None);
        assert_eq!(body, json_of(100).as_bytes());

        let (_, headers, body) = get_from(guarded(), "/image", accepts).await;
        assert_eq!(header(&headers, "content-encoding"), None);
        assert_eq!(body, vec![7u8; 4096]);

        let (_, headers, body) = get_from(guarded(), "/encoded", accepts).await;
        assert_eq!(header(&headers, "content-encoding"), Some("br"));
        assert_eq!(body, vec![7u8; 4096]);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn errors_stripped_of_their_body_stay_uncompressed() {
        let (status, headers, body) =
            get_from(guarded(), "/failed", "Accept-Encoding: gzip\r\n").await;
        assert!(status.starts_with("HTTP/1.1 400 "), "{status}");
        assert_eq!(header(&headers, "content-encoding"), None);
        assert_eq!(header(&headers, "cache-control"), Some("no-store"));
        assert!(body.is_empty(), "{body:?}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn shutdown_waits_no_longer_than_the_grace_period() {
        let (address, stop, server) =
            serve_slowly(Duration::from_secs(60), Duration::from_millis(300)).await;
        let _in_flight = request(address);
        tokio::time::sleep(Duration::from_millis(200)).await;

        let start = Instant::now();
        stop.send(()).unwrap();
        server.await.unwrap().unwrap();
        let waited = start.elapsed();
        assert!(
            waited >= Duration::from_millis(300) && waited < Duration::from_secs(5),
            "{waited:?}"
        );
    }
}
