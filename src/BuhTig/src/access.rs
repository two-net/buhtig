//! Public and private access (SRS §4.7), as `access.mode` in the config file sets it, and
//! nothing else (FR-ACC-01, FR-ACC-08).
//!
//! In public mode, the default, visitors may use the home page and the dashboards of public
//! repositories and organizations, with public data only. Settings, shortcuts and refreshing
//! are for signed-in users, as their own handlers tell (FR-ACC-02).
//!
//! In private mode, every page and every request for data needs sign-in, but for what
//! signing in needs: the sign-in page, sign-in itself and GitHub's callback, the "not
//! allowed" and "sign-in failed" pages it ends on, the About and Privacy pages, the health
//! check, the session (which says only that a visitor is one), and the files of the UI that
//! these pages load (FR-ACC-03). A visitor who opens any other page is sent to the sign-in
//! page, which sends them back to it once they have signed in. Anything else that a visitor
//! asks for is 401. The gate lets through what it knows to be open, and nothing else, so
//! that a page or request added later needs sign-in until it is listed here.
//!
//! In either mode, what each viewer may see of GitHub rests on their own credential alone,
//! as [`crate::cache`] tells (FR-ACC-04, FR-ACC-06).

use axum::extract::{FromRequestParts, Request};
use axum::http::uri::PathAndQuery;
use axum::http::{Method, StatusCode, Uri, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Redirect, Response};
use rust_embed::RustEmbed;
use url::form_urlencoded;

use crate::cache::Viewer;
use crate::{ui, web};

/// The page that asks a visitor to sign in, and then returns them to `return_to`.
const SIGN_IN: &str = "/-/sign-in";

/// What private mode leaves open to visitors, besides the files of the UI. Only these
/// paths, exactly, so that no path that leads elsewhere passes for one of them.
const OPEN: [&str; 10] = [
    "/-/health",
    SIGN_IN,
    "/-/auth/sign-in",
    "/-/auth/callback",
    "/-/auth/sign-out",
    "/-/not-allowed",
    "/-/sign-in-failed",
    "/-/about",
    "/-/privacy",
    "/-/api/session",
];

/// What is under this path serves the UI with data, rather than being a page.
const API: &str = "/-/api/";

/// Private mode's gate, in front of every route, given the [`Sessions`] as an extension of
/// the request, as [`crate::web::router`] adds it. `A` is the UI's files.
///
/// A signed-in user's request goes on, with who they are, so that their session is not read
/// again. A visitor's request for a page is sent to sign in, and any other of theirs is 401.
/// While the database is unreachable, no one can be told apart, so pages say to try again
/// (FR-DB-09), and anything else is 503.
///
/// [`Sessions`]: crate::session::Sessions
pub async fn gate<A: RustEmbed>(request: Request, next: Next) -> Response {
    let path = request.uri().path();
    if is_open::<A>(path) {
        return next.run(request).await;
    }
    let page = !path.starts_with(API) && matches!(*request.method(), Method::GET | Method::HEAD);
    let (mut parts, body) = request.into_parts();
    match Viewer::from_request_parts(&mut parts, &()).await {
        Ok(Viewer::Visitor(_)) if page => sign_in_first(&parts.uri),
        Ok(Viewer::Visitor(_)) => status(StatusCode::UNAUTHORIZED),
        Ok(viewer) => {
            parts.extensions.insert(viewer);
            next.run(Request::from_parts(parts, body)).await
        }
        Err(response) if page && response.status() == StatusCode::SERVICE_UNAVAILABLE => {
            web::unavailable()
        }
        Err(response) => response,
    }
}

/// Whether private mode leaves `path` open to visitors.
fn is_open<A: RustEmbed>(path: &str) -> bool {
    OPEN.contains(&path) || ui::is_asset::<A>(path)
}

/// The redirect that sends a visitor to the sign-in page, and from there back to `uri`,
/// which sign-in checks is BuhTig's own (NFR-SEC-04). It is not kept, since the same page
/// is served once they have signed in.
fn sign_in_first(uri: &Uri) -> Response {
    let location = match uri.path_and_query().map(PathAndQuery::as_str) {
        None | Some("/") => SIGN_IN.to_owned(),
        Some(page) => {
            let query = form_urlencoded::Serializer::new(String::new())
                .append_pair("return_to", page)
                .finish();
            format!("{SIGN_IN}?{query}")
        }
    };
    (
        [(header::CACHE_CONTROL, "no-store")],
        Redirect::to(&location),
    )
        .into_response()
}

fn status(status: StatusCode) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::Arc;
    use std::time::Duration;

    use axum::http::HeaderMap;
    use axum::routing::{get, put};
    use axum::{Extension, Router, middleware};
    use sea_orm::sqlx::postgres::PgPoolOptions;
    use sea_orm::{DatabaseConnection, SqlxPostgresConnector};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;
    use url::Url;

    use super::*;
    use crate::config::{DatabaseConfig, Secret};
    use crate::crypto::Sealer;
    use crate::db;
    use crate::session::{Profile, Sessions, Settings};
    use crate::test_cluster::cluster;

    #[derive(rust_embed::Embed)]
    #[folder = "tests/fixtures/ui"]
    struct Built;

    const KEY: &[u8] = b"a secret of at least thirty-two bytes";

    #[test]
    fn only_what_signing_in_needs_is_open() {
        for path in OPEN
            .into_iter()
            .chain(["/main-ABCDEFGH.js", "/favicon.ico"])
        {
            assert!(is_open::<Built>(path), "{path}");
        }
        for path in [
            "/",
            "/index.html",
            "/owner/repo",
            "/org",
            "/-/settings",
            "/-/x",
            "/-/about/",
            "/-/sign-in/x",
            "/-/auth/",
            "/-/auth/../owner/repo",
            "/-/health/../owner/repo",
            "/-/api/surprise",
            "/-/api/shortcuts",
            "/-/api/token",
            "/-/api/repositories/owner/repo",
            "/-/api/session/../repositories/owner/repo",
        ] {
            assert!(!is_open::<Built>(path), "{path}");
        }
    }

    /// A database of its own.
    async fn database() -> DatabaseConnection {
        let cluster = cluster();
        let database = cluster.create_database();
        let db = db::connect(&DatabaseConfig {
            url: Secret::new(Url::parse(&cluster.url(&database)).unwrap()),
            max_connections: 5,
        })
        .await
        .unwrap();
        db::migrate(&db).await.unwrap();
        db
    }

    /// A database that cannot be reached, which every query fails on at once. Requests
    /// without a session cookie never query it.
    fn unreachable_database() -> DatabaseConnection {
        let pool = PgPoolOptions::new()
            .acquire_timeout(Duration::from_secs(1))
            .connect_lazy("postgres://buhtig@127.0.0.1:1/buhtig")
            .unwrap();
        SqlxPostgresConnector::from_sqlx_postgres_pool(pool)
    }

    /// Sessions kept in `db`.
    fn sessions(db: DatabaseConnection) -> Arc<Sessions> {
        Arc::new(Sessions::new(
            db,
            Arc::new(Sealer::new(KEY)),
            Settings {
                idle_timeout: Duration::from_secs(7 * 24 * 60 * 60),
                max_age: Duration::from_secs(30 * 24 * 60 * 60),
                allowed_users: Default::default(),
                secure: true,
            },
        ))
    }

    /// The `Cookie` of Mona's session, once she has signed in.
    async fn mona(sessions: &Sessions) -> String {
        let mona = Profile {
            github_id: 583231,
            login: "Mona".to_owned(),
            name: None,
            avatar_url: "https://avatars.githubusercontent.com/u/583231".to_owned(),
        };
        let cookie = sessions
            .sign_in(mona, &Secret::new("gho_mona".to_owned()), &HeaderMap::new())
            .await
            .unwrap();
        cookie
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned()
    }

    /// An app in private mode, with a page for every path, and requests for data that say
    /// who the gate let through.
    fn app(sessions: Arc<Sessions>) -> Router {
        // The viewer as the gate told it, rather than as the session tells it again.
        async fn told(Extension(viewer): Extension<Viewer>) -> String {
            match viewer {
                Viewer::Visitor(_) => "visitor".to_owned(),
                Viewer::SignedIn { user_id, .. } => format!("signed in {user_id}"),
                Viewer::TokenUser { user_id, .. } => format!("token user {user_id}"),
            }
        }
        Router::new()
            .route("/-/api/viewer", get(told))
            .route("/-/api/session", get(|| async { "session" }))
            .route("/-/api/token", put(|| async { "saved" }))
            .route("/-/auth/sign-out", axum::routing::post(|| async { "out" }))
            .fallback(get(|| async { "page" }))
            .layer(middleware::from_fn(gate::<Built>))
            .layer(Extension(sessions))
    }

    /// Serves `app` as BuhTig does, sends it `request` with `headers`, and returns the
    /// status line, the `Location` and `Cache-Control` headers, and the body.
    async fn send(
        app: Router,
        request: &str,
        headers: &str,
    ) -> (String, Option<String>, Option<String>, String) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (stop, stopped) = oneshot::channel::<()>();
        let shutdown = async {
            let _ = stopped.await;
        };
        let server = tokio::spawn(web::serve(listener, app, shutdown, Duration::from_secs(5)));
        let raw = format!(
            "{request} HTTP/1.1\r\nHost: test\r\nConnection: close\r\nContent-Length: 0\r\n\
             {headers}\r\n"
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
        let header = |name: &str| {
            head.lines()
                .find_map(|line| line.strip_prefix(name)?.strip_prefix(": "))
                .map(str::to_owned)
        };
        (
            status,
            header("location"),
            header("cache-control"),
            body.to_owned(),
        )
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn visitors_are_sent_to_sign_in_and_back() {
        let sessions = sessions(unreachable_database());
        for (page, location) in [
            ("/", "/-/sign-in"),
            ("/owner/repo", "/-/sign-in?return_to=%2Fowner%2Frepo"),
            (
                "/owner/repo?tab=x&y=1",
                "/-/sign-in?return_to=%2Fowner%2Frepo%3Ftab%3Dx%26y%3D1",
            ),
            ("/-/settings", "/-/sign-in?return_to=%2F-%2Fsettings"),
            ("/index.html", "/-/sign-in?return_to=%2Findex.html"),
        ] {
            for method in ["GET", "HEAD"] {
                let (status, to, cache, _) =
                    send(app(sessions.clone()), &format!("{method} {page}"), "").await;
                assert_eq!(status, "HTTP/1.1 303 See Other", "{method} {page}");
                assert_eq!(to.as_deref(), Some(location), "{method} {page}");
                assert_eq!(cache.as_deref(), Some("no-store"), "{method} {page}");
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn visitors_get_no_data() {
        let sessions = sessions(unreachable_database());
        for request in [
            "GET /-/api/viewer",
            "GET /-/api/repositories/owner/repo",
            "PUT /-/api/token",
            "POST /owner/repo",
        ] {
            let (status, to, cache, body) = send(app(sessions.clone()), request, "").await;
            assert_eq!(status, "HTTP/1.1 401 Unauthorized", "{request}");
            assert_eq!(to, None, "{request}");
            assert_eq!(cache.as_deref(), Some("no-store"), "{request}");
            assert_eq!(body, "", "{request}");
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn what_signing_in_needs_stays_open() {
        let sessions = sessions(unreachable_database());
        for (request, expected) in [
            ("GET /-/sign-in?return_to=%2Fowner%2Frepo", "page"),
            ("GET /-/about", "page"),
            ("GET /-/privacy", "page"),
            ("GET /-/not-allowed", "page"),
            ("GET /-/sign-in-failed?return_to=%2Fx", "page"),
            ("GET /-/api/session", "session"),
            ("POST /-/auth/sign-out", "out"),
            ("GET /main-ABCDEFGH.js", "page"),
        ] {
            let (status, _, _, body) = send(app(sessions.clone()), request, "").await;
            assert_eq!(status, "HTTP/1.1 200 OK", "{request}");
            assert_eq!(body, expected, "{request}");
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn signed_in_users_go_on_as_who_they_are() {
        let sessions = sessions(database().await);
        let cookie = format!("Cookie: {}\r\n", mona(&sessions).await);
        for (request, expected) in [
            ("GET /owner/repo", "page"),
            ("GET /", "page"),
            ("GET /-/api/viewer", "signed in 1"),
            ("PUT /-/api/token", "saved"),
        ] {
            let (status, to, _, body) = send(app(sessions.clone()), request, &cookie).await;
            assert_eq!(status, "HTTP/1.1 200 OK", "{request}");
            assert_eq!(to, None, "{request}");
            assert_eq!(body, expected, "{request}");
        }

        // Once signed out, a visitor again.
        let (status, ..) = send(
            app(sessions.clone()),
            "GET /owner/repo",
            "Cookie: buhtig_session=gone\r\n",
        )
        .await;
        assert_eq!(status, "HTTP/1.1 303 See Other");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn no_one_is_let_through_while_the_database_is_unreachable() {
        let sessions = sessions(unreachable_database());
        let cookie = "Cookie: buhtig_session=whatever\r\n";
        let (status, _, _, body) = send(app(sessions.clone()), "GET /owner/repo", cookie).await;
        assert_eq!(status, "HTTP/1.1 503 Service Unavailable");
        assert!(body.contains("<html"), "{body}");
        let (status, _, _, body) = send(app(sessions.clone()), "GET /-/api/viewer", cookie).await;
        assert_eq!(status, "HTTP/1.1 503 Service Unavailable");
        assert_eq!(body, "");
        // What is open needs no session.
        let (status, ..) = send(app(sessions), "GET /-/about", cookie).await;
        assert_eq!(status, "HTTP/1.1 200 OK");
    }
}
