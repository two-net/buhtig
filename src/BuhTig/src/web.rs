//! BuhTig's HTTP side: its routes, the line it logs for each request (FR-OPS-04), the
//! page it shows while its database is unreachable (FR-DB-09), and how it stops
//! (FR-OPS-05).
//!
//! TLS is terminated in front of BuhTig (A-06), so it serves plain HTTP.

use std::future::{Future, IntoFuture};
use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::Router;
use axum::extract::{Request, State};
use axum::http::{StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tracing::{error, info, warn};

use crate::accounts;
use crate::cache::Cache;
use crate::health::{self, Health};
use crate::session;
use crate::surprise;
use crate::ui::{self, Ui};

/// The page shown in place of BuhTig's own while its database is unreachable. It says
/// what happened and what to do (NFR-UX-06), and nothing about why (NFR-SEC-09).
const UNAVAILABLE: &str = include_str!("unavailable.html");

pub fn router(health: Arc<Health>, cache: Arc<Cache>) -> Router {
    Router::new()
        .route("/-/health", get(health::check))
        .route(
            "/-/api/accounts/{name}",
            get(accounts::kind).with_state(cache.clone()),
        )
        .route("/-/api/session", get(session::current))
        .route("/-/api/shortcuts", get(session::shortcuts))
        .route("/-/api/surprise", get(surprise::pick).with_state(cache))
        .fallback(get(page))
        .with_state(health)
        // Outermost, so that every response is logged, whichever part answered.
        .layer(middleware::from_fn(log_request))
}

/// Every other path: a file of the UI, or else the app, which takes the path as its
/// route (`/owner/repo`, `/-/about`, …).
async fn page(State(health): State<Arc<Health>>, uri: Uri) -> Response {
    if let Some(asset) = ui::asset::<Ui>(uri.path()) {
        return asset;
    }
    // The files need no database, but the app does for nearly everything it shows.
    if !health.database_reachable().await {
        return unavailable();
    }
    ui::app::<Ui>()
}

/// The response to a request that needs the database while it is unreachable.
fn unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::RETRY_AFTER, "30"),
        ],
        Html(UNAVAILABLE),
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
