//! The whole app, as `main` serves it, in front of a stand-in for GitHub (NFR-MNT-03): who
//! sees what in each access mode (SRS §4.7, Table 4-2), and where what they see is cached
//! (FR-DATA-04). The tests of each part, such as those of `access.rs` and `cache.rs`, tell
//! its rules apart; these check that the parts, put together, keep them.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
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
/// credential, as it might to one with more access than BuhTig asks for.
///
/// The users Mona and Hubot each have a public repository, and Hubot a private one too,
/// which GitHub lists to Hubot's PAT alone, at `/user/repos`. There, any other credential
/// gets a list of public repositories, as GitHub lists the sign-in credential's user's, so
/// that one read without the PAT would be seen in the shared cache. Once `revoked`, GitHub
/// rejects Hubot's PAT. Octo's repositories have pull requests, 2 of them open, open issues,
/// releases and workflow runs, to whoever GitHub finds the repository for, as [`under`] tells
/// them, each with an ETag, as GitHub gives them. GitHub fails to give `octo/flaky`'s latest
/// release, and `octo/down` at all, to anyone. Anything else is not found.
fn github(revoked: Arc<AtomicBool>) -> Arc<Stub> {
    Stub::new(move |request: &Request<_>| {
        let pat = request
            .headers()
            .get(AUTHORIZATION)
            .is_some_and(|value| value == format!("Bearer {HUBOTS_PAT}").as_str());
        if pat && revoked.load(Ordering::Relaxed) {
            return answer(401, &[], r#"{"message": "Bad credentials"}"#);
        }
        let visible: &[&str] = if pat {
            &["public", "secret", "inner"]
        } else {
            &["public"]
        };
        match request.uri().path() {
            "/users/mona" => answer(200, &[], r#"{"login": "mona", "id": 1, "type": "User"}"#),
            "/users/hubot" => answer(200, &[], r#"{"login": "hubot", "id": 2, "type": "User"}"#),
            "/users/mona/repos" => answer(200, &[], &json!([owned("mona", "widget")]).to_string()),
            "/users/hubot/repos" => answer(200, &[], &json!([owned("hubot", "tools")]).to_string()),
            "/user/repos" if pat => answer(200, &[], &json!([owned("hubot", "diary")]).to_string()),
            "/user/repos" => answer(200, &[], &json!([owned("mona", "widget")]).to_string()),
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
            "/search/issues" => {
                let query = request.uri().query().unwrap_or_default();
                let searched = url::form_urlencoded::parse(query.as_bytes())
                    .find(|(key, _)| key == "q")
                    .and_then(|(_, q)| {
                        let (name, qualifiers) = q.strip_prefix("repo:octo/")?.split_once(' ')?;
                        visible
                            .contains(&name)
                            .then(|| (name.to_owned(), qualifiers.to_owned()))
                    });
                match searched {
                    Some((name, qualifiers)) if qualifiers == "is:pr" => {
                        answer(200, &[], &under(&name, "pulls").to_string())
                    }
                    Some((_, qualifiers)) if qualifiers == "is:pr is:open" => answer(
                        200,
                        &[],
                        r#"{"total_count": 2, "incomplete_results": false, "items": [{}]}"#,
                    ),
                    _ => answer(422, &[], r#"{"message": "Validation Failed"}"#),
                }
            }
            "/repos/octo/flaky/releases/latest" | "/repos/octo/down" => {
                answer(500, &[], r#"{"message": "Server Error"}"#)
            }
            path => match path.strip_prefix("/repos/octo/") {
                Some(name) if visible.contains(&name) || ["leaky", "flaky"].contains(&name) => {
                    answer(200, ETAG, &repository(name).to_string())
                }
                Some(rest) => match rest.split_once('/') {
                    Some((name, what)) if visible.contains(&name) || name == "flaky" => {
                        answer(200, ETAG, &under(name, what).to_string())
                    }
                    _ => answer(404, &[], r#"{"message": "Not Found"}"#),
                },
                _ => answer(404, &[], r#"{"message": "Not Found"}"#),
            },
        }
    })
}

/// The ETag that GitHub gives with what is under Octo, unchanging.
const ETAG: &[(&str, &str)] = &[("etag", "\"octo\"")];

/// Octo's repository `name`, as GitHub gives it: `secret` and `leaky` are private, and
/// `inner` internal, which GitHub marks private too.
fn repository(name: &str) -> Value {
    let (visibility, id) = match name {
        "secret" => ("private", 1002),
        "leaky" => ("private", 1004),
        "inner" => ("internal", 1003),
        "flaky" => ("public", 1005),
        _ => ("public", 1001),
    };
    json!({
        "id": id,
        "name": name,
        "full_name": format!("octo/{name}"),
        "owner": {"login": "octo"},
        "private": visibility != "public",
        "visibility": visibility,
        "default_branch": "main",
        "pushed_at": "2026-10-01T00:00:00Z",
        "stargazers_count": 50,
        "forks_count": 5,
        "subscribers_count": 3,
        "open_issues_count": 7,
    })
}

/// What GitHub gives under Octo's repository `name` at `what` (FR-REPO-13, FR-REPO-14,
/// FR-REPO-16): its pull requests as searched for, its open issues, its releases, the latest
/// of them, and its workflow runs, which GitHub gives with the repository, marked private as it is.
fn under(name: &str, what: &str) -> Value {
    let at = "2026-10-01T00:00:00Z";
    match what {
        "pulls" => json!({"total_count": 1, "incomplete_results": false, "items": [
            {"created_at": at, "closed_at": at, "pull_request": {"merged_at": at}}
        ]}),
        "issues" => json!([{"created_at": at}]),
        "releases" => json!([{"tag_name": "v1", "draft": false, "prerelease": false,
                              "published_at": at, "assets": []}]),
        "releases/latest" => json!({"tag_name": "v1", "published_at": at,
            "html_url": format!("https://github.com/octo/{name}/releases/tag/v1")}),
        "actions/runs" => json!({"total_count": 1, "workflow_runs": [{
            "name": "CI", "status": "completed", "conclusion": "success",
            "run_started_at": at, "created_at": at, "updated_at": at,
            "html_url": format!("https://github.com/octo/{name}/actions/runs/1"),
            "repository": repository(name),
        }]}),
        _ => json!({"message": "Not Found"}),
    }
}

/// The user `login`'s repository `name`, as GitHub gives it: `diary` is private, and pushed
/// to more recently than the others.
fn owned(login: &str, name: &str) -> Value {
    let private = name == "diary";
    json!({
        "name": name,
        "full_name": format!("{login}/{name}"),
        "owner": {"login": login},
        "private": private,
        "visibility": if private { "private" } else { "public" },
        "pushed_at": if private { "2026-10-05T00:00:00Z" } else { "2026-10-01T00:00:00Z" },
    })
}

/// BuhTig in `mode`, served as `main` serves it, over a database of its own and in front
/// of [`github`].
struct Served {
    origin: String,
    database: String,
    stub: Arc<Stub>,
    /// Whether GitHub rejects Hubot's PAT, as once it is revoked.
    revoked: Arc<AtomicBool>,
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
    content_type: Option<String>,
    cache_control: Option<String>,
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
    db::migrate(&db, &config.github.host).await.unwrap();

    let revoked = Arc::new(AtomicBool::new(false));
    let stub = github(revoked.clone());
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
        revoked,
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
        let header = |name| {
            response
                .headers()
                .get(name)
                .map(|value: &axum::http::HeaderValue| value.to_str().unwrap().to_owned())
        };
        let (location, content_type, cache_control) = (
            header("location"),
            header("content-type"),
            header("cache-control"),
        );
        Answer {
            status,
            location,
            content_type,
            cache_control,
            // Lossily, as a PNG is not text.
            body: String::from_utf8_lossy(&response.bytes().await.unwrap()).into_owned(),
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

    /// The names of the user `login`'s repositories that BuhTig lists to `viewer`, with
    /// their visibility.
    async fn users_repositories(&self, viewer: &Viewer, login: &str) -> Vec<(String, String)> {
        let listed = self
            .get(viewer, &format!("/-/api/users/{login}/repositories"))
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

    /// Makes GitHub reject Hubot's PAT from now on, as once Hubot revokes it.
    fn revoke(&self) {
        self.revoked.store(true, Ordering::Relaxed);
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
const SIGNED_IN_ONLY: [(Method, &str); 19] = [
    (Method::GET, "/-/api/shortcuts"),
    (Method::DELETE, "/-/api/history"),
    (Method::PUT, "/-/api/pins"),
    (Method::PUT, "/-/api/token"),
    (Method::DELETE, "/-/api/user"),
    (Method::POST, "/-/api/repositories/octo/public/refresh"),
    (Method::POST, "/-/api/repositories/octo/public/view"),
    (Method::PUT, "/-/api/organizations/octo/pin"),
    (Method::POST, "/-/api/users/hubot/refresh"),
    (Method::POST, "/-/api/users/hubot/view"),
    (Method::PUT, "/-/api/users/hubot/pin"),
    (Method::GET, "/-/api/watchlists"),
    (Method::POST, "/-/api/watchlists"),
    (Method::PUT, "/-/api/watchlists/1"),
    (Method::DELETE, "/-/api/watchlists/1"),
    (Method::POST, "/-/api/watchlists/1/repositories"),
    (Method::PUT, "/-/api/watchlists/1/repositories"),
    (
        Method::DELETE,
        "/-/api/watchlists/1/repositories/octo/public",
    ),
    (Method::GET, "/-/api/repositories/octo/public/glance"),
];

/// FR-ACC-02, FR-ACC-04 and FR-DATA-02: in public mode, visitors see public dashboards,
/// read with the OAuth app's credential, and nothing private. Shortcuts, settings and
/// refreshing need sign-in.
#[tokio::test(flavor = "multi_thread")]
async fn visitors_in_public_mode_see_public_data_only() {
    let served = serve("public").await;

    for page in [
        "/",
        "/octo/public",
        "/octo/public/issues",
        "/octo",
        "/orgs/octo/people",
        "/hubot",
        "/-/settings",
    ] {
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
    assert_eq!(
        served.users_repositories(&VISITOR, "hubot").await,
        [("tools".to_owned(), "public".to_owned())]
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
        (
            "/octo/public/issues",
            "/-/sign-in?return_to=%2Focto%2Fpublic%2Fissues",
        ),
        // Back to where it leads, once signed in.
        (
            "/octo/public/pull/1",
            "/-/sign-in?return_to=%2Focto%2Fpublic%2Fpull%2F1",
        ),
        ("/octo", "/-/sign-in?return_to=%2Focto"),
        (
            "/hubot?tab=repositories",
            "/-/sign-in?return_to=%2Fhubot%3Ftab%3Drepositories",
        ),
        (
            "/orgs/octo/people",
            "/-/sign-in?return_to=%2Forgs%2Focto%2Fpeople",
        ),
        ("/-/settings", "/-/sign-in?return_to=%2F-%2Fsettings"),
        // A comparison needs signing in as each of its resources' dashboards does (FR-CMP-05).
        (
            "/-/compare/octo/public...octo/inner",
            "/-/sign-in?return_to=%2F-%2Fcompare%2Focto%2Fpublic...octo%2Finner",
        ),
        (
            "/-/compare/octo...hubot",
            "/-/sign-in?return_to=%2F-%2Fcompare%2Focto...hubot",
        ),
        // Nor are there cards (FR-NAV-07).
        (
            "/-/preview/octo/public.svg",
            "/-/sign-in?return_to=%2F-%2Fpreview%2Focto%2Fpublic.svg",
        ),
        (
            "/-/preview/octo.png",
            "/-/sign-in?return_to=%2F-%2Fpreview%2Focto.png",
        ),
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
        "/-/api/repositories/octo/public/merge-velocity",
        "/-/api/organizations/octo",
        "/-/api/organizations/octo/repositories",
        "/-/api/organizations/octo/repositories/public/commit-activity",
        "/-/api/accounts/octo",
        "/-/api/users/hubot",
        "/-/api/users/hubot/stats",
        "/-/api/users/hubot/repositories",
        "/-/api/users/hubot/repositories/tools/commit-activity",
        "/-/api/surprise",
        "/-/api/recent",
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

/// FR-NAV-07, AC-14: a card shows what the shared cache holds while it is fresh, and nothing
/// else: not what Hubot's PAT read, even of a public repository, and nothing that GitHub
/// would have to be asked for. Without it, a card has the name it was asked for alone. The
/// page of a dashboard whose card shows its data names the card as its image (FR-NAV-06).
#[tokio::test(flavor = "multi_thread")]
async fn cards_show_what_visitors_dashboards_read_alone() {
    let served = serve("public").await;
    let hubot = served.hubot().await;
    for path in [
        "/-/api/repositories/octo/secret",
        "/-/api/repositories/octo/public",
        "/-/api/organizations/octo/repositories",
    ] {
        let answer = served.get(&hubot, path).await;
        assert_eq!(answer.status, 200, "{path}: {answer:?}");
    }
    let read = served.stub.urls();
    let mona = served.mona().await;
    for viewer in [&VISITOR, &mona, &hubot] {
        for (path, name) in [
            ("/-/preview/octo/secret.svg", "octo/secret"),
            ("/-/preview/octo/inner.svg", "octo/inner"),
            ("/-/preview/octo/public.svg", "octo/public"),
            ("/-/preview/octo.svg", "octo"),
        ] {
            let card = served.get(viewer, path).await;
            assert_eq!(
                (
                    card.status,
                    card.content_type.as_deref(),
                    card.cache_control.as_deref()
                ),
                (200, Some("image/svg+xml; charset=utf-8"), Some("no-cache")),
                "{path}: {card:?}"
            );
            let label = format!("aria-label=\"{name} on BuhTig\"");
            assert!(card.body.contains(&label), "{path}: {card:?}");
            assert!(card.body.contains(crate::card::SEE_DASHBOARD), "{path}");
        }
    }
    let page = served.get(&VISITOR, "/octo/public").await;
    assert!(!page.body.contains("og:image"), "{page:?}");
    assert_eq!(served.stub.urls(), read);

    // A visitor's dashboard reads it into the shared cache.
    let public = served
        .get(&VISITOR, "/-/api/repositories/octo/public")
        .await;
    assert_eq!(public.status, 200, "{public:?}");
    let read = served.stub.urls();
    let card = served.get(&VISITOR, "/-/preview/octo/public.svg").await;
    assert!(
        card.body.contains(
            "aria-label=\"octo/public on BuhTig: A dashboard of the GitHub repository \
             octo/public. 50 stars, 5 forks.\""
        ),
        "{card:?}"
    );
    let png = served.get(&VISITOR, "/-/preview/octo/public.png").await;
    assert_eq!(
        (png.status, png.content_type.as_deref()),
        (200, Some("image/png"))
    );
    assert!(png.body.starts_with("\u{fffd}PNG"), "{:?}", &png.body[..8]);
    let page = served.get(&VISITOR, "/octo/public").await;
    // The tags go in the UI's page, when it is built: a build without it has no `<head>`
    // to put them in.
    if Ui::get("index.html").is_some() {
        assert!(
            page.body.contains(
                "<meta property=\"og:image\" \
                 content=\"https://buhtig.example.com/-/preview/octo/public.png\">"
            ),
            "{page:?}"
        );
    }
    assert_eq!(served.stub.urls(), read);

    for path in [
        "/-/preview/octo/public.gif",
        "/-/preview/octo/public",
        "/-/preview/-octo.svg",
        "/-/preview/octo/..svg",
        "/-/preview/octo.svg.png",
    ] {
        let answer = served.get(&VISITOR, path).await;
        assert_eq!(answer.status, 404, "{path}: {answer:?}");
    }
}

/// FR-NAV-07: in private mode, there are no cards, even for those who may sign in. A
/// visitor is sent to sign in, as for any page.
#[tokio::test(flavor = "multi_thread")]
async fn private_mode_has_no_cards() {
    let served = serve("private").await;
    let mona = served.mona().await;
    let public = served.get(&mona, "/-/api/repositories/octo/public").await;
    assert_eq!(public.status, 200, "{public:?}");
    for path in ["/-/preview/octo/public.svg", "/-/preview/octo/public.png"] {
        let answer = served.get(&mona, path).await;
        assert_eq!(answer.status, 404, "{path}: {answer:?}");
    }
    assert_eq!(
        served.get(&mona, "/-/api/session").await.json()["access"],
        "private"
    );
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
            (Method::PUT, "/-/api/users/hubot/pin"),
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
        assert!(
            shortcuts.body.contains(r#"{"kind":"user","name":"hubot"}"#),
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

/// FR-DATA-04, FR-ACC-06: the repositories that the home page offers anyone as viewed
/// last are only those in the shared cache. What a token user's PAT fetched is never among
/// them, even a public repository, until someone reads it without a PAT, and then it is
/// what that read fetched.
#[tokio::test(flavor = "multi_thread")]
async fn what_a_pat_fetched_is_never_offered_as_viewed_last() {
    let served = serve("public").await;
    let mona = served.mona().await;
    let hubot = served.hubot().await;
    let offered = async |viewer: &Viewer| {
        let recent = served.get(viewer, "/-/api/recent").await;
        assert_eq!(recent.status, 200, "{recent:?}");
        let names: Vec<String> = recent.json()["repositories"]
            .as_array()
            .unwrap()
            .iter()
            .map(|repository| repository["name"].as_str().unwrap().to_owned())
            .collect();
        names
    };

    for repo in ["public", "secret", "inner"] {
        let path = format!("/-/api/repositories/octo/{repo}");
        assert_eq!(served.get(&hubot, &path).await.status, 200, "{path}");
    }
    assert_eq!(
        served
            .get(&hubot, "/-/api/organizations/octo/repositories")
            .await
            .status,
        200
    );
    for viewer in [&VISITOR, &mona, &hubot] {
        assert_eq!(offered(viewer).await, Vec::<String>::new());
    }

    // Others read without a PAT, which GitHub answers as not found for the private ones.
    for viewer in [&VISITOR, &mona] {
        for repo in ["public", "secret", "inner", "leaky"] {
            served
                .get(viewer, &format!("/-/api/repositories/octo/{repo}"))
                .await;
        }
    }
    for viewer in [&VISITOR, &mona, &hubot] {
        assert_eq!(offered(viewer).await, ["octo/public"]);
    }
    // Hubot's PAT read the public one first, and visitors' requests were the next to.
    assert_eq!(
        served.credentials_for("/repos/octo/public"),
        [format!("Bearer {HUBOTS_PAT}").as_str(), APP]
    );
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
            // As a comparison of two of them reads them (FR-CMP-05, FR-CMP-06).
            "/-/api/repositories/octo/public/merge-velocity",
            "/-/api/repositories/octo/public/issue-age",
            "/-/api/repositories/octo/public/workflow-runs",
            "/-/api/repositories/octo/public/release-cadence",
            "/-/api/repositories/octo/secret/merge-velocity",
            "/-/api/repositories/octo/secret/issue-age",
            "/-/api/repositories/octo/secret/workflow-runs",
            "/-/api/repositories/octo/secret/release-cadence",
            "/-/api/repositories/octo/inner/merge-velocity",
            "/-/api/repositories/octo/inner/workflow-runs",
            // What is observed of them (FR-DATA-13).
            "/-/api/repositories/octo/public/trends",
            "/-/api/repositories/octo/secret/trends",
            "/-/api/repositories/octo/inner/trends",
            "/-/api/repositories/octo/leaky/trends",
            "/-/api/accounts/hubot",
            "/-/api/users/hubot",
            "/-/api/users/hubot/stats",
            "/-/api/users/hubot/repositories",
            "/-/api/users/mona/repositories",
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
    // Nor anything about one viewer alone, which GitHub gives at paths that name no one.
    assert_eq!(
        served.psql(
            "SELECT count(*) FROM cache_entries \
             WHERE scope = 'shared' AND resource_key LIKE '/user/%'"
        ),
        "0"
    );
    // Nor anything under Octo's private and internal repositories, which a comparison of
    // them reads with Hubot's PAT alone (FR-CMP-05, FR-CMP-06): what it read of them, its
    // figures among them, is in Hubot's private cache.
    assert_eq!(
        served.psql(
            "SELECT count(*) FROM cache_entries WHERE scope = 'shared' \
             AND (resource_key LIKE '%secret%' OR resource_key LIKE '%inner%')"
        ),
        "0"
    );
    // The repository, and its runs, open issues, releases, pull requests searched for, and
    // the count of those open, which its trends observe.
    assert_eq!(
        served.psql(
            "SELECT count(*) FROM cache_entries \
             WHERE scope <> 'shared' AND resource_key LIKE '%secret%'"
        ),
        "6"
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
    // What was observed in the shared scope is of the public repository alone, and no one's;
    // what Hubot's PAT observed is Hubot's, with the PAT. `octo/leaky` was not: GitHub would
    // not count its pull requests.
    assert_eq!(
        served.psql(
            "SELECT string_agg(scope || ' ' || repository_id || ' ' || \
                coalesce(user_id::text, '-') || ' ' || coalesce(credential_id::text, '-'), \
                ', ' ORDER BY scope, repository_id) \
             FROM repository_observations"
        ),
        format!(
            "shared 1001 - -, user:{hubot} 1001 {hubot} {pat}, user:{hubot} 1002 {hubot} {pat}, \
             user:{hubot} 1003 {hubot} {pat}"
        )
    );
}

/// What a viewer is told of how a repository's figures changed (FR-REPO-17), as the stat
/// cards observed them, from `viewer`'s point of view: the scope, and the stars of each
/// observation.
async fn trends(served: &Served, viewer: &Viewer, repo: &str) -> (u16, Value) {
    let answer = served
        .get(viewer, &format!("/-/api/repositories/octo/{repo}/trends"))
        .await;
    assert_eq!(
        answer.cache_control.as_deref(),
        Some("no-store"),
        "{answer:?}"
    );
    let body = if answer.status == 200 {
        answer.json()
    } else {
        assert_eq!(answer.body, "", "{answer:?}");
        Value::Null
    };
    (answer.status, body)
}

/// AC-17, FR-DATA-13, FR-DATA-14: opening a dashboard observes its stat cards in the
/// viewer's scope. A newly tracked repository says that no earlier baseline exists, and no
/// one is told what another user's PAT observed.
#[tokio::test(flavor = "multi_thread")]
async fn trends_are_observed_as_dashboards_open_and_told_within_their_scope() {
    let served = serve("public").await;
    let mona = served.mona().await;
    let hubot = served.hubot().await;

    // Hubot opens Octo's private repository, and its public one.
    for repo in ["secret", "public"] {
        let stats = served
            .get(&hubot, &format!("/-/api/repositories/octo/{repo}/stats"))
            .await;
        assert_eq!(stats.status, 200, "{stats:?}");
        assert_eq!(stats.json()["stars"], 50);
    }
    let (status, secret) = trends(&served, &hubot, "secret").await;
    assert_eq!((status, &secret["scope"]), (200, &json!("private")));
    let observed = &secret["observations"][0];
    assert_eq!(
        (
            &observed["stars"],
            &observed["forks"],
            &observed["open_issues"],
            &observed["open_pull_requests"]
        ),
        (&json!(50), &json!(5), &json!(5), &json!(2))
    );
    assert_eq!(secret["tracking_since"], observed["observed_at"]);
    for period in secret["periods"].as_array().unwrap() {
        assert_eq!(period["reason"], "first_observation", "{period}");
    }

    // Neither Mona nor a visitor is told anything of it, not even that it was observed.
    for viewer in [&mona, &VISITOR] {
        assert_eq!(trends(&served, viewer, "secret").await, (404, Value::Null));
    }
    // Of the public one, they are told what the shared scope observed, as it opened for
    // them, and not what Hubot's PAT did.
    let (_, hubots) = trends(&served, &hubot, "public").await;
    let (status, monas) = trends(&served, &mona, "public").await;
    let (_, visitors) = trends(&served, &VISITOR, "public").await;
    assert_eq!((status, &monas["scope"]), (200, &json!("shared")));
    assert_eq!(monas["observations"].as_array().unwrap().len(), 1);
    assert_ne!(
        monas["observations"][0]["observed_at"],
        hubots["observations"][0]["observed_at"]
    );
    assert_eq!(visitors["observations"], monas["observations"]);

    // A day later, the next observation gives the change since, between the two.
    let hubot_id = served.psql("SELECT id FROM users WHERE login = 'hubot'");
    served.psql(&format!(
        "UPDATE repository_observations
            SET observed_at = observed_at - interval '7 days',
                pull_requests_observed_at = pull_requests_observed_at - interval '7 days',
                day = (observed_at - interval '7 days')::date, stars = 41
          WHERE scope = 'user:{hubot_id}' AND repository_id = 1002"
    ));
    let before = served.psql(&format!(
        "SELECT to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') \
         FROM repository_observations WHERE scope = 'user:{hubot_id}' AND repository_id = 1002"
    ));
    served
        .send(
            &hubot,
            Method::POST,
            "/-/api/repositories/octo/secret/refresh",
            Some(json!({})),
        )
        .await;
    let (_, secret) = trends(&served, &hubot, "secret").await;
    let week = &secret["periods"][0];
    assert_eq!(week["supported"], true, "{secret}");
    assert_eq!(week["from"]["observed_at"], before.as_str());
    assert_eq!(week["from"]["stars"], 41);
    assert_eq!(week["to"]["stars"], 50);
    assert_eq!(week["changes"]["stars"], 9);
    // The days between are a gap, not observations.
    assert_eq!(secret["observations"].as_array().unwrap().len(), 2);
    assert_eq!(secret["gaps"].as_array().unwrap().len(), 1, "{secret}");
    assert_eq!(secret["periods"][1]["reason"], "tracked_later");
}

/// FR-DATA-14, FR-PAT-05, DR-04: what a PAT observed goes when it is replaced, removed or
/// rejected, and with its user.
#[tokio::test(flavor = "multi_thread")]
async fn observations_go_with_their_pat_and_their_user() {
    let served = serve("public").await;
    let hubot = served.hubot().await;
    let observed = || served.psql("SELECT count(*) FROM repository_observations");
    let observe = async || {
        let (status, _) = trends(&served, &hubot, "secret").await;
        assert_eq!(status, 200);
        assert_eq!(observed(), "1");
    };

    observe().await;
    // Replaced, even by the same token.
    let saved = served
        .send(
            &hubot,
            Method::PUT,
            "/-/api/token",
            Some(json!({"token": HUBOTS_PAT})),
        )
        .await;
    assert_eq!(saved.status, 200, "{saved:?}");
    assert_eq!(observed(), "0");

    observe().await;
    let removed = served
        .send(&hubot, Method::DELETE, "/-/api/token", Some(json!({})))
        .await;
    assert!(removed.status < 300, "{removed:?}");
    assert_eq!(observed(), "0");

    // Rejected by GitHub, once BuhTig next asks with it.
    let saved = served
        .send(
            &hubot,
            Method::PUT,
            "/-/api/token",
            Some(json!({"token": HUBOTS_PAT})),
        )
        .await;
    assert_eq!(saved.status, 200, "{saved:?}");
    observe().await;
    served.revoke();
    served
        .send(
            &hubot,
            Method::POST,
            "/-/api/repositories/octo/secret/refresh",
            Some(json!({})),
        )
        .await;
    assert_eq!(trends(&served, &hubot, "secret").await, (404, Value::Null));
    assert_eq!(observed(), "0");
    // Hubot is now told what the shared scope observed of the public repository.
    let (_, public) = trends(&served, &hubot, "public").await;
    assert_eq!(public["scope"], "shared");

    // With the account: the shared scope's observation is no one's, and stays.
    let deleted = served
        .send(&hubot, Method::DELETE, "/-/api/user", Some(json!({})))
        .await;
    assert!(deleted.status < 300, "{deleted:?}");
    assert_eq!(
        served.psql("SELECT string_agg(scope, ' ') FROM repository_observations"),
        "shared"
    );
}

/// DR-04: deleting an account deletes what its PAT observed.
#[tokio::test(flavor = "multi_thread")]
async fn deleting_an_account_deletes_what_its_pat_observed() {
    let served = serve("public").await;
    let hubot = served.hubot().await;
    assert_eq!(trends(&served, &hubot, "secret").await.0, 200);
    assert_eq!(
        served.psql("SELECT count(*) FROM repository_observations"),
        "1"
    );
    let deleted = served
        .send(&hubot, Method::DELETE, "/-/api/user", Some(json!({})))
        .await;
    assert!(deleted.status < 300, "{deleted:?}");
    assert_eq!(
        served.psql("SELECT count(*) FROM repository_observations"),
        "0"
    );
}

/// FR-USER-06, FR-ACC-06: a token user's own dashboard lists their private repositories
/// too, which GitHub lists to their PAT alone. No one else's does, not even theirs to
/// someone else, and what they read about themselves is in their private cache alone.
#[tokio::test(flavor = "multi_thread")]
async fn a_users_private_repositories_are_listed_to_them_alone() {
    let served = serve("public").await;
    let mona = served.mona().await;
    let hubot = served.hubot().await;
    let pair = |name: &str, visibility: &str| (name.to_owned(), visibility.to_owned());

    assert_eq!(
        served.users_repositories(&hubot, "hubot").await,
        [pair("diary", "private"), pair("tools", "public")]
    );
    let stats = served.get(&hubot, "/-/api/users/hubot/stats").await;
    assert_eq!(stats.json()["private"], 1, "{stats:?}");
    for viewer in [&VISITOR, &mona] {
        assert_eq!(
            served.users_repositories(viewer, "hubot").await,
            [pair("tools", "public")]
        );
    }
    // Hubot's PAT lists Hubot's own private repositories, and no one else's.
    assert_eq!(
        served.users_repositories(&hubot, "mona").await,
        [pair("widget", "public")]
    );
    assert_eq!(
        served.credentials_for("/user/repos"),
        [format!("Bearer {HUBOTS_PAT}")]
    );
    let hubot = served.psql("SELECT id FROM users WHERE login = 'hubot'");
    assert_eq!(
        served.psql("SELECT scope FROM cache_entries WHERE resource_key LIKE '/user/%'"),
        format!("user:{hubot}")
    );
}

/// FR-PAT-07, FR-DATA-04: once GitHub rejects a token user's PAT, their own dashboard
/// lists what anyone's does. What GitHub lists about them alone is never read with their
/// sign-in credential instead, which would put it in the shared cache, for anyone.
#[tokio::test(flavor = "multi_thread")]
async fn a_rejected_pat_never_lists_its_users_repositories_to_anyone() {
    let served = serve("public").await;
    let hubot = served.hubot().await;
    served.revoke();

    assert_eq!(
        served.users_repositories(&hubot, "hubot").await,
        [("tools".to_owned(), "public".to_owned())]
    );
    assert_eq!(
        served.credentials_for("/user/repos"),
        [format!("Bearer {HUBOTS_PAT}")]
    );
    assert_eq!(
        served.psql("SELECT count(*) FROM cache_entries WHERE resource_key LIKE '/user/%'"),
        "0"
    );
    // The PAT is marked invalid, for Hubot to replace.
    assert_eq!(
        served.psql("SELECT status FROM credentials WHERE kind = 'pat'"),
        "invalid"
    );
}

/// What `viewer` is told of Octo's repository `repo` at a glance, as a watchlist shows it
/// (FR-PERS-08): the status, and the body, `null` if there is none.
async fn glance(served: &Served, viewer: &Viewer, repo: &str) -> (u16, Value) {
    let answer = served
        .get(viewer, &format!("/-/api/repositories/octo/{repo}/glance"))
        .await;
    assert_eq!(
        answer.cache_control.as_deref(),
        Some("no-store"),
        "{answer:?}"
    );
    let body = if answer.body.is_empty() {
        Value::Null
    } else {
        answer.json()
    };
    (answer.status, body)
}

/// The paths of the requests to GitHub from the `from`th on, without their queries, in order.
fn asked_since(served: &Served, from: usize) -> Vec<String> {
    served.stub.urls()[from..]
        .iter()
        .map(|url| {
            let url = url.strip_prefix("https://api.github.com").unwrap();
            url.split('?').next().unwrap().to_owned()
        })
        .collect()
}

/// FR-PERS-08, FR-PERS-09: a watchlist shows a repository's latest release, last push and
/// workflow runs, read as its dashboard reads them, under the same keys of the cache: three
/// requests to GitHub per `cache.ttl` at most, none a search or a statistic, conditional once
/// the cache has the data, and none at all for what the dashboard read lately.
#[tokio::test(flavor = "multi_thread")]
async fn a_watchlist_reads_each_repository_as_its_dashboard_does() {
    let served = serve("public").await;
    let mona = served.mona().await;
    let made = served
        .send(
            &mona,
            Method::POST,
            "/-/api/watchlists",
            Some(json!({"name": "Dependencies", "repositories": ["octo/public"]})),
        )
        .await;
    assert_eq!(made.status, 201, "{made:?}");
    // Making a watchlist asks GitHub nothing.
    assert_eq!(served.stub.urls(), Vec::<String>::new());

    let (status, public) = glance(&served, &mona, "public").await;
    assert_eq!(status, 200, "{public}");
    assert_eq!(public["name"], "octo/public");
    assert_eq!(public["visibility"], "public");
    assert_eq!(public["archived"], false);
    assert_eq!(public["pushed_at"], "2026-10-01T00:00:00Z");
    assert_eq!(public["stale"], Value::Null);
    assert_eq!(
        public["latest_release"]["release"],
        json!({
            "tag": "v1",
            "published_at": "2026-10-01T00:00:00Z",
            "url": "https://github.com/octo/public/releases/tag/v1",
        })
    );
    assert_eq!(public["latest_release"]["stale"], Value::Null);
    assert!(
        public["latest_release"]["fetched_at"].is_string(),
        "{public}"
    );
    let runs = &public["workflow_runs"];
    assert_eq!(runs["branch"], "main");
    assert_eq!(runs["hidden"], false);
    assert_eq!(runs["latest"]["conclusion"], "success");
    assert_eq!(
        runs["latest"]["url"],
        "https://github.com/octo/public/actions/runs/1"
    );
    let mut asked = asked_since(&served, 0);
    asked.sort();
    assert_eq!(
        asked,
        [
            "/repos/octo/public",
            "/repos/octo/public/actions/runs",
            "/repos/octo/public/releases/latest",
        ]
    );

    // Within cache.ttl, GitHub is not asked again.
    let read = served.stub.urls().len();
    assert_eq!(glance(&served, &mona, "public").await.0, 200);
    assert_eq!(asked_since(&served, read), Vec::<String>::new());
    // The dashboard reads the same: its stat cards ask only for the count of open pull
    // requests, which a watchlist never searches for, and its workflow runs nothing.
    let stats = served
        .get(&mona, "/-/api/repositories/octo/public/stats")
        .await;
    assert_eq!(stats.json()["latest_release"]["tag"], "v1", "{stats:?}");
    let runs = served
        .get(&mona, "/-/api/repositories/octo/public/workflow-runs")
        .await;
    assert_eq!(runs.status, 200, "{runs:?}");
    assert_eq!(asked_since(&served, read), ["/search/issues"]);

    // Once cache.ttl has passed, GitHub is asked again, whether what it gave has changed.
    served.psql("UPDATE cache_entries SET expires_at = now() - interval '1 minute'");
    let read = served.stub.urls().len();
    assert_eq!(glance(&served, &mona, "public").await.0, 200);
    let requests = &served.stub.requests()[read..];
    assert_eq!(requests.len(), 3, "{requests:?}");
    for (url, headers) in requests {
        assert_eq!(headers["if-none-match"], "\"octo\"", "{url}");
    }
}

/// FR-PERS-08, FR-REPO-09, AC-18: what GitHub fails to give of one repository, or of part of
/// it, keeps nothing of the others from a watchlist.
#[tokio::test(flavor = "multi_thread")]
async fn one_repository_failing_keeps_nothing_of_the_others() {
    let served = serve("public").await;
    let mona = served.mona().await;

    let (status, flaky) = glance(&served, &mona, "flaky").await;
    assert_eq!(status, 200, "{flaky}");
    assert_eq!(flaky["latest_release"], json!({"failure": "github"}));
    assert_eq!(flaky["workflow_runs"]["latest"]["conclusion"], "success");
    assert_eq!(glance(&served, &mona, "down").await, (502, Value::Null));
    assert_eq!(glance(&served, &mona, "missing").await, (404, Value::Null));
    let (status, public) = glance(&served, &mona, "public").await;
    assert_eq!(status, 200, "{public}");
    assert_eq!(public["latest_release"]["release"]["tag"], "v1");
    // A name that cannot be a repository's is refused before GitHub is asked.
    let read = served.stub.urls().len();
    assert_eq!(glance(&served, &mona, "a~b").await, (400, Value::Null));
    assert_eq!(asked_since(&served, read), Vec::<String>::new());
}

/// FR-PERS-06 to FR-PERS-09, FR-ACC-06, AC-03, AC-11, DR-04: a watchlist is its user's
/// alone, and what it shows of each repository is what that user may see now, whatever
/// another's credentials saw. A PAT removed takes with it what the watchlist showed through
/// it, and an account its watchlists.
#[tokio::test(flavor = "multi_thread")]
async fn watchlists_are_their_users_alone() {
    let served = serve("public").await;
    let hubot = served.hubot().await;
    let mona = served.mona().await;
    let made = served
        .send(
            &hubot,
            Method::POST,
            "/-/api/watchlists",
            Some(json!({"name": "Team", "repositories": ["octo/secret", "octo/public"]})),
        )
        .await;
    assert_eq!(made.status, 201, "{made:?}");
    let id = made.json()["id"].as_i64().unwrap();
    let (status, secret) = glance(&served, &hubot, "secret").await;
    assert_eq!(status, 200, "{secret}");
    assert_eq!(secret["visibility"], "private");
    assert_eq!(secret["latest_release"]["release"]["tag"], "v1");
    assert_eq!(secret["workflow_runs"]["latest"]["conclusion"], "success");

    // Mona, whom GitHub does not let see it, is told nothing of it, from her own credential,
    // and nothing of it reaches the shared cache.
    assert_eq!(glance(&served, &mona, "secret").await, (404, Value::Null));
    assert_eq!(
        served.credentials_for("/repos/octo/secret").last().unwrap(),
        &format!("Bearer {MONAS_SIGN_IN}")
    );
    assert_eq!(
        served.psql(
            "SELECT count(*) FROM cache_entries WHERE scope = 'shared' \
             AND resource_key LIKE '%secret%'"
        ),
        "0"
    );

    // Nor does she see or change Hubot's watchlist.
    let listed = served.get(&mona, "/-/api/watchlists").await;
    assert_eq!(listed.json(), json!({"watchlists": []}));
    let repositories = json!({"repositories": ["octo/public"]});
    for (method, path, body) in [
        (
            Method::PUT,
            format!("/-/api/watchlists/{id}"),
            json!({"name": "Mine"}),
        ),
        (Method::DELETE, format!("/-/api/watchlists/{id}"), json!({})),
        (
            Method::POST,
            format!("/-/api/watchlists/{id}/repositories"),
            repositories.clone(),
        ),
        (
            Method::PUT,
            format!("/-/api/watchlists/{id}/repositories"),
            repositories,
        ),
        (
            Method::DELETE,
            format!("/-/api/watchlists/{id}/repositories/octo/secret"),
            json!({}),
        ),
    ] {
        let answer = served.send(&mona, method.clone(), &path, Some(body)).await;
        assert_eq!(
            (answer.status, answer.body.as_str()),
            (404, ""),
            "{method} {path}"
        );
    }
    let listed = served.get(&hubot, "/-/api/watchlists").await;
    assert_eq!(
        listed.json(),
        json!({"watchlists": [
            {"id": id, "name": "Team", "repositories": ["octo/secret", "octo/public"]}
        ]})
    );

    // Once Hubot removes his PAT, his watchlist tells him nothing more of the repository
    // that only it could see, though the repository stays in it.
    let removed = served
        .send(&hubot, Method::DELETE, "/-/api/token", Some(json!({})))
        .await;
    assert!(removed.status < 300, "{removed:?}");
    assert_eq!(glance(&served, &hubot, "secret").await, (404, Value::Null));
    assert_eq!(glance(&served, &hubot, "public").await.0, 200);

    // With his account go his watchlists, and Mona's stay.
    let mine = served
        .send(
            &mona,
            Method::POST,
            "/-/api/watchlists",
            Some(json!({"name": "Mine", "repositories": ["octo/public"]})),
        )
        .await;
    assert_eq!(mine.status, 201, "{mine:?}");
    let deleted = served
        .send(&hubot, Method::DELETE, "/-/api/user", Some(json!({})))
        .await;
    assert!(deleted.status < 300, "{deleted:?}");
    assert_eq!(
        served.psql(
            "SELECT (SELECT count(*) FROM watchlists) || ' ' || \
             (SELECT count(*) FROM watchlist_entries)"
        ),
        "1 1"
    );
}
