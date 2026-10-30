//! The whole app, as `main` serves it, in front of a stand-in for GitHub (NFR-MNT-03): who
//! sees what in each access mode (SRS §4.7, Table 4-2), and where what they see is cached
//! (FR-DATA-04). The tests of each part, such as those of `access.rs` and `cache.rs`, tell
//! its rules apart; these check that the parts, put together, keep them.

use std::sync::Arc;
use std::time::Duration;

use axum::http::Request;
use axum::http::header::AUTHORIZATION;
use reqwest::Method;
use serde_json::{Value, json};
use tokio::net::TcpListener;

use crate::config::{Config, Secret};
use crate::crypto::Sealer;
use crate::github::stub::{Stub, answer, client};
use crate::session::{self, Profile, Sessions};
use crate::test_cluster::cluster;
use crate::ui::Ui;
use crate::{db, web};

/// What Mona signed in with, which sees public data only (A-03).
const MONAS_SIGN_IN: &str = "gho_mona";
/// What Hubot signed in with, and the PAT that Hubot then saved, which sees Octo's private
/// and internal repositories.
const HUBOTS_SIGN_IN: &str = "gho_hubot";
const HUBOTS_PAT: &str = "ghp_hubot000000000000000000000000000000pat";
/// The OAuth app's client ID and secret, as [`client`] has them, which visitors' requests
/// carry (FR-DATA-02).
const APP: &str = "Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=";

/// GitHub as these tests meet it: the organization Octo, with a public repository, a
/// private one and an internal one. Only Hubot's PAT finds the last two, or lists them
/// among Octo's repositories. `octo/leaky` is private too, yet GitHub gives it to any
/// credential, as it might to one with more access than BuhTig asks for. Anything else is
/// not found.
fn github() -> Arc<Stub> {
    Stub::new(|request: &Request<_>| {
        let pat = request
            .headers()
            .get(AUTHORIZATION)
            .is_some_and(|value| value == format!("Bearer {HUBOTS_PAT}").as_str());
        let visible: &[&str] = if pat {
            &["public", "secret", "inner"]
        } else {
            &["public"]
        };
        match request.uri().path() {
            "/user" if pat => answer(
                200,
                &[("x-oauth-scopes", "repo, read:org")],
                r#"{"id": 2, "login": "hubot"}"#,
            ),
            "/orgs/octo" => answer(
                200,
                &[],
                r#"{"login": "octo", "name": "Octo", "created_at": "2020-01-01T00:00:00Z"}"#,
            ),
            "/orgs/octo/repos" => {
                let list: Vec<Value> = visible.iter().map(|name| repository(name)).collect();
                answer(200, &[], &Value::from(list).to_string())
            }
            path => match path.strip_prefix("/repos/octo/") {
                Some(name) if visible.contains(&name) || name == "leaky" => {
                    answer(200, &[], &repository(name).to_string())
                }
                _ => answer(404, &[], r#"{"message": "Not Found"}"#),
            },
        }
    })
}

/// Octo's repository `name`, as GitHub gives it: `secret` and `leaky` are private, and
/// `inner` internal, which GitHub marks private too.
fn repository(name: &str) -> Value {
    let visibility = match name {
        "secret" | "leaky" => "private",
        "inner" => "internal",
        _ => "public",
    };
    json!({
        "name": name,
        "full_name": format!("octo/{name}"),
        "owner": {"login": "octo"},
        "private": visibility != "public",
        "visibility": visibility,
        "default_branch": "main",
        "pushed_at": "2026-10-01T00:00:00Z",
    })
}

/// BuhTig in `mode`, served as `main` serves it, over a database of its own and in front
/// of [`github`].
struct Served {
    origin: String,
    database: String,
    stub: Arc<Stub>,
    /// Sessions in the same database, to sign users in as GitHub's callback would.
    sessions: Sessions,
    http: reqwest::Client,
}

/// Someone sending requests: the cookie of their session, unless they are a visitor.
struct Viewer(Option<String>);

const VISITOR: Viewer = Viewer(None);

/// What BuhTig answered.
#[derive(Debug, PartialEq)]
struct Answer {
    status: u16,
    location: Option<String>,
    body: String,
}

impl Answer {
    fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or_else(|_| panic!("not JSON: {self:?}"))
    }
}

async fn serve(mode: &str) -> Served {
    let database = cluster().create_database();
    let config = Config::parse(&format!(
        r#"
        [server]
        public_url = "https://buhtig.example.com"

        [database]
        url = "{}"

        [github]
        client_id = "Iv1.client-id"
        client_secret = "github-client-secret"

        [security]
        encryption_key = "E9kO4wdc96sDx81yxStONaEoRd/p1+5zlz2JSlcH8Xc="

        [access]
        mode = "{mode}"
        "#,
        cluster().url(&database)
    ))
    .expect("the config is valid");
    let db = db::connect(&config.database).await.unwrap();
    db::migrate(&db).await.unwrap();

    let stub = github();
    let app = crate::app(&config, &db, Arc::new(client(&stub)));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(web::serve(
        listener,
        app,
        std::future::pending::<()>(),
        Duration::ZERO,
    ));

    let sessions = Sessions::new(
        db,
        Arc::new(Sealer::new(config.security.encryption_key.expose())),
        session::Settings {
            idle_timeout: config.auth.session_idle_timeout,
            max_age: config.auth.session_max_age,
            allowed_users: config.access.allowed_users.clone(),
            secure: true,
        },
    );
    // TLS is never used, but the client cannot be built without it.
    let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_root_certificates(rustls::RootCertStore::empty())
    .with_no_client_auth();
    let http = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .tls_backend_preconfigured(tls)
        .build()
        .unwrap();
    Served {
        origin,
        database,
        stub,
        sessions,
        http,
    }
}

impl Served {
    /// Signs in the GitHub user `login` with `token`, as GitHub's callback does.
    async fn sign_in(&self, github_id: i64, login: &str, token: &str) -> Viewer {
        let profile = Profile {
            github_id,
            login: login.to_owned(),
            name: None,
            avatar_url: format!("https://avatars.githubusercontent.com/u/{github_id}"),
        };
        let cookie = self
            .sessions
            .sign_in(profile, &Secret::new(token.to_owned()), &Default::default())
            .await
            .unwrap();
        let cookie = cookie.to_str().unwrap().split(';').next().unwrap();
        Viewer(Some(cookie.to_owned()))
    }

    /// Mona, signed in, with no PAT.
    async fn mona(&self) -> Viewer {
        self.sign_in(1, "mona", MONAS_SIGN_IN).await
    }

    /// Hubot, signed in, with a PAT saved in Settings, which checks it with GitHub
    /// (FR-PAT-02).
    async fn hubot(&self) -> Viewer {
        let hubot = self.sign_in(2, "hubot", HUBOTS_SIGN_IN).await;
        let saved = self
            .send(
                &hubot,
                Method::PUT,
                "/-/api/token",
                Some(json!({"token": HUBOTS_PAT})),
            )
            .await;
        assert_eq!(saved.status, 200, "{saved:?}");
        hubot
    }

    async fn get(&self, viewer: &Viewer, path: &str) -> Answer {
        self.send(viewer, Method::GET, path, None).await
    }

    /// Sends `method path`, with `body` as JSON if there is one, as `viewer` from BuhTig's
    /// own page, and returns what BuhTig answered.
    async fn send(
        &self,
        viewer: &Viewer,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Answer {
        let mut request = self
            .http
            .request(method.clone(), format!("{}{path}", self.origin));
        if let Some(cookie) = &viewer.0 {
            request = request.header("cookie", cookie);
        }
        if method != Method::GET {
            request = request.header("sec-fetch-site", "same-origin");
        }
        if let Some(body) = body {
            request = request
                .header("content-type", "application/json")
                .body(body.to_string());
        }
        let response = request.send().await.unwrap();
        let status = response.status().as_u16();
        let location = response
            .headers()
            .get("location")
            .map(|location| location.to_str().unwrap().to_owned());
        Answer {
            status,
            location,
            body: response.text().await.unwrap(),
        }
    }

    /// The names of Octo's repositories that BuhTig lists to `viewer`, with their
    /// visibility.
    async fn octos_repositories(&self, viewer: &Viewer) -> Vec<(String, String)> {
        let listed = self
            .get(viewer, "/-/api/organizations/octo/repositories")
            .await;
        assert_eq!(listed.status, 200, "{listed:?}");
        listed.json()["repositories"]
            .as_array()
            .unwrap()
            .iter()
            .map(|repository| {
                (
                    repository["name"].as_str().unwrap().to_owned(),
                    repository["visibility"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    }

    /// The credentials that the requests to GitHub for `path` carried, in order.
    fn credentials_for(&self, path: &str) -> Vec<String> {
        self.stub
            .requests()
            .into_iter()
            .filter(|(url, _)| {
                url.split('?').next() == Some(&format!("https://api.github.com{path}"))
            })
            .map(|(_, headers)| headers[AUTHORIZATION].to_str().unwrap().to_owned())
            .collect()
    }

    /// The credentials that every request to GitHub so far carried, each once.
    fn credentials(&self) -> Vec<String> {
        let mut credentials: Vec<String> = self
            .stub
            .requests()
            .into_iter()
            .map(|(_, headers)| headers[AUTHORIZATION].to_str().unwrap().to_owned())
            .collect();
        credentials.dedup();
        credentials
    }

    fn psql(&self, sql: &str) -> String {
        cluster().psql(&self.database, sql)
    }
}

/// A body for a request with `method`: JSON, as the UI sends with every request that
/// changes something, so that a handler that reads it gets as far as asking who sent it.
fn body_for(method: &Method) -> Option<Value> {
    (method != Method::GET).then(|| json!({}))
}

/// What only signed-in users may ask for or do (FR-ACC-02), whatever the mode.
const SIGNED_IN_ONLY: [(Method, &str); 8] = [
    (Method::GET, "/-/api/shortcuts"),
    (Method::DELETE, "/-/api/history"),
    (Method::PUT, "/-/api/pins"),
    (Method::PUT, "/-/api/token"),
    (Method::DELETE, "/-/api/user"),
    (Method::POST, "/-/api/repositories/octo/public/refresh"),
    (Method::POST, "/-/api/repositories/octo/public/view"),
    (Method::PUT, "/-/api/organizations/octo/pin"),
];

/// FR-ACC-02, FR-ACC-04 and FR-DATA-02: in public mode, visitors see public dashboards,
/// read with the OAuth app's credential, and nothing private. Shortcuts, settings and
/// refreshing need sign-in.
#[tokio::test(flavor = "multi_thread")]
async fn visitors_in_public_mode_see_public_data_only() {
    let served = serve("public").await;

    for page in ["/", "/octo/public", "/octo", "/-/settings"] {
        let answer = served.get(&VISITOR, page).await;
        assert_eq!(answer.status, 200, "{page}: {answer:?}");
    }
    let public = served
        .get(&VISITOR, "/-/api/repositories/octo/public")
        .await;
    assert_eq!(public.status, 200, "{public:?}");
    assert_eq!(public.json()["visibility"], "public");
    let octo = served.get(&VISITOR, "/-/api/organizations/octo").await;
    assert_eq!(octo.status, 200, "{octo:?}");
    assert_eq!(
        served.octos_repositories(&VISITOR).await,
        [("public".to_owned(), "public".to_owned())]
    );
    for repo in ["secret", "inner"] {
        let path = format!("/-/api/repositories/octo/{repo}");
        assert_eq!(served.get(&VISITOR, &path).await.status, 404, "{path}");
    }
    for (method, path) in SIGNED_IN_ONLY {
        let answer = served
            .send(&VISITOR, method.clone(), path, body_for(&method))
            .await;
        assert_eq!(answer.status, 401, "{method} {path}: {answer:?}");
    }
    assert_eq!(served.credentials(), [APP]);
}

/// FR-ACC-03: in private mode, a visitor may only sign in, and read the About and Privacy
/// pages and what they load. Any other page sends them to sign in and back, and any request
/// for data is refused, before GitHub is asked anything.
#[tokio::test(flavor = "multi_thread")]
async fn visitors_in_private_mode_see_only_what_signing_in_needs() {
    let served = serve("private").await;

    for (page, location) in [
        ("/", "/-/sign-in"),
        ("/octo/public", "/-/sign-in?return_to=%2Focto%2Fpublic"),
        ("/octo", "/-/sign-in?return_to=%2Focto"),
        ("/-/settings", "/-/sign-in?return_to=%2F-%2Fsettings"),
    ] {
        let answer = served.get(&VISITOR, page).await;
        assert_eq!(
            (answer.status, answer.location.as_deref()),
            (303, Some(location)),
            "{page}: {answer:?}"
        );
    }
    for path in [
        "/-/api/repositories/octo/public",
        "/-/api/repositories/octo/public/stats",
        "/-/api/organizations/octo",
        "/-/api/organizations/octo/repositories",
        "/-/api/accounts/octo",
        "/-/api/surprise",
    ] {
        let answer = served.get(&VISITOR, path).await;
        assert_eq!(answer.status, 401, "{path}: {answer:?}");
    }
    for (method, path) in SIGNED_IN_ONLY {
        let answer = served
            .send(&VISITOR, method.clone(), path, body_for(&method))
            .await;
        assert_eq!(answer.status, 401, "{method} {path}: {answer:?}");
    }
    for page in [
        "/-/sign-in",
        "/-/about",
        "/-/privacy",
        "/-/health",
        "/-/api/session",
    ] {
        let answer = served.get(&VISITOR, page).await;
        assert_eq!(answer.status, 200, "{page}: {answer:?}");
    }
    let sign_in = served.get(&VISITOR, "/-/auth/sign-in").await;
    assert!(
        sign_in.location.as_deref().is_some_and(
            |location| location.starts_with("https://github.com/login/oauth/authorize?")
        ),
        "{sign_in:?}"
    );
    // The files of the UI, when it is built: debug builds read them from disk.
    if Ui::get("favicon.ico").is_some() {
        assert_eq!(served.get(&VISITOR, "/favicon.ico").await.status, 200);
    }
    assert_eq!(served.stub.urls(), Vec::<String>::new());
}

/// Table 4-2, second row: in either mode, signed-in users see public dashboards, read with
/// their sign-in credential, and nothing private, and keep their history and pins and may
/// refresh.
#[tokio::test(flavor = "multi_thread")]
async fn signed_in_users_see_public_data_and_keep_shortcuts_in_either_mode() {
    for mode in ["public", "private"] {
        let served = serve(mode).await;
        let mona = served.mona().await;

        for page in ["/", "/octo/public", "/-/settings"] {
            let answer = served.get(&mona, page).await;
            assert_eq!(answer.status, 200, "{mode} {page}: {answer:?}");
        }
        let public = served.get(&mona, "/-/api/repositories/octo/public").await;
        assert_eq!(public.status, 200, "{mode}: {public:?}");
        assert_eq!(
            served.octos_repositories(&mona).await,
            [("public".to_owned(), "public".to_owned())],
            "{mode}"
        );
        for repo in ["secret", "inner"] {
            let path = format!("/-/api/repositories/octo/{repo}");
            assert_eq!(served.get(&mona, &path).await.status, 404, "{mode} {path}");
        }
        for (method, path) in [
            (Method::POST, "/-/api/repositories/octo/public/view"),
            (Method::PUT, "/-/api/organizations/octo/pin"),
            (Method::GET, "/-/api/shortcuts"),
            (Method::POST, "/-/api/repositories/octo/public/refresh"),
            (Method::DELETE, "/-/api/history"),
        ] {
            let answer = served.send(&mona, method.clone(), path, None).await;
            assert!(
                (200..300).contains(&answer.status),
                "{mode} {method} {path}: {answer:?}"
            );
        }
        let shortcuts = served.get(&mona, "/-/api/shortcuts").await;
        assert!(
            shortcuts.body.contains(r#""octo""#),
            "{mode}: {shortcuts:?}"
        );
        assert_eq!(
            served.credentials(),
            [format!("Bearer {MONAS_SIGN_IN}")],
            "{mode}"
        );
    }
}

/// Table 4-2, third row, FR-ACC-04, FR-ORG-09 and FR-PAT-06: in either mode, a token user
/// sees the private and internal repositories that their PAT reaches, as such, and every
/// request for them carries the PAT.
#[tokio::test(flavor = "multi_thread")]
async fn token_users_see_what_their_pat_reaches_in_either_mode() {
    for mode in ["public", "private"] {
        let served = serve(mode).await;
        let hubot = served.hubot().await;

        for (repo, visibility) in [
            ("public", "public"),
            ("secret", "private"),
            ("inner", "internal"),
        ] {
            let path = format!("/-/api/repositories/octo/{repo}");
            let answer = served.get(&hubot, &path).await;
            assert_eq!(answer.status, 200, "{mode} {path}: {answer:?}");
            assert_eq!(answer.json()["visibility"], visibility, "{mode} {path}");
        }
        assert_eq!(
            served.octos_repositories(&hubot).await,
            [
                ("public".to_owned(), "public".to_owned()),
                ("secret".to_owned(), "private".to_owned()),
                ("inner".to_owned(), "internal".to_owned()),
            ],
            "{mode}"
        );
        let missing = served.get(&hubot, "/-/api/repositories/octo/missing").await;
        assert_eq!(missing.status, 404, "{mode}");
        assert_eq!(
            served.credentials(),
            [format!("Bearer {HUBOTS_PAT}")],
            "{mode}"
        );
    }
}

/// FR-ACC-05: to each viewer, a private repository they cannot see is answered as one
/// that does not exist, so that nothing about it shows.
#[tokio::test(flavor = "multi_thread")]
async fn a_private_repository_is_answered_as_a_missing_one() {
    let served = serve("public").await;
    let mona = served.mona().await;
    let hubot = served.hubot().await;

    for (viewer, hidden) in [(&VISITOR, "secret"), (&mona, "inner"), (&hubot, "hidden")] {
        let hidden = served
            .get(viewer, &format!("/-/api/repositories/octo/{hidden}"))
            .await;
        let missing = served.get(viewer, "/-/api/repositories/octo/missing").await;
        assert_eq!(hidden.status, 404, "{hidden:?}");
        assert_eq!(hidden, missing);
    }
}

/// FR-ACC-06: what one user's PAT fetched is never served to another. After Hubot has seen
/// the private repository, Mona and visitors are told it is not found, each by GitHub, for
/// their own credential.
#[tokio::test(flavor = "multi_thread")]
async fn one_users_pat_never_serves_another() {
    let served = serve("public").await;
    let mona = served.mona().await;
    let hubot = served.hubot().await;

    let secret = "/-/api/repositories/octo/secret";
    assert_eq!(served.get(&hubot, secret).await.status, 200);
    assert_eq!(served.octos_repositories(&hubot).await.len(), 3);
    for viewer in [&mona, &VISITOR] {
        assert_eq!(served.get(viewer, secret).await.status, 404);
        assert_eq!(
            served.octos_repositories(viewer).await,
            [("public".to_owned(), "public".to_owned())]
        );
    }
    let pat = format!("Bearer {HUBOTS_PAT}");
    let mona = format!("Bearer {MONAS_SIGN_IN}");
    assert_eq!(
        served.credentials_for("/repos/octo/secret"),
        [pat.as_str(), &mona, APP]
    );
    // Mona's list went to the shared cache, from which the visitor's came.
    assert_eq!(served.credentials_for("/orgs/octo/repos"), [pat, mona]);
}

/// FR-DATA-04: once visitors, signed-in users and a token user have all looked at
/// everything, the shared cache holds nothing that GitHub marks private or internal, and
/// everything read with the PAT is in its user's private cache, under that PAT. As a
/// safeguard, a private repository that GitHub gives without a PAT is answered as not
/// found, and kept out of the shared cache.
#[tokio::test(flavor = "multi_thread")]
async fn the_shared_cache_holds_nothing_private_once_everyone_has_looked() {
    let served = serve("public").await;
    let mona = served.mona().await;
    let hubot = served.hubot().await;

    for viewer in [&VISITOR, &mona, &hubot] {
        for path in [
            "/-/api/organizations/octo",
            "/-/api/organizations/octo/stats",
            "/-/api/organizations/octo/repositories",
            "/-/api/repositories/octo/public",
            "/-/api/repositories/octo/secret",
            "/-/api/repositories/octo/inner",
            "/-/api/repositories/octo/missing",
        ] {
            served.get(viewer, path).await;
        }
        let leaky = served.get(viewer, "/-/api/repositories/octo/leaky").await;
        let expected = if viewer.0 == hubot.0 { 200 } else { 404 };
        assert_eq!(leaky.status, expected, "{leaky:?}");
    }

    const PRIVATE: &str = r#"jsonb_path_exists(data, 'lax $.** ? (@.private == true || @.visibility == "private" || @.visibility == "internal")')"#;
    assert_eq!(
        served.psql(&format!(
            "SELECT count(*) FILTER (WHERE {PRIVATE}), \
                count(*) FILTER (WHERE user_id IS NOT NULL OR credential_id IS NOT NULL), \
                count(*) > 0 \
             FROM cache_entries WHERE scope = 'shared'"
        )),
        "0|0|t",
        "the shared cache is empty, holds something private, or belongs to someone"
    );
    let hubot = served.psql("SELECT id FROM users WHERE login = 'hubot'");
    let pat = served.psql(&format!(
        "SELECT id FROM credentials WHERE user_id = {hubot} AND kind = 'pat'"
    ));
    assert_eq!(
        served.psql(&format!(
            "SELECT scope, user_id, credential_id, bool_or({PRIVATE}) FROM cache_entries \
             WHERE scope <> 'shared' GROUP BY scope, user_id, credential_id"
        )),
        format!("user:{hubot}|{hubot}|{pat}|t")
    );
}
