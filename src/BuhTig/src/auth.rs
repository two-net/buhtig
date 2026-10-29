//! Signing in with GitHub, and out (SRS §4.5). BuhTig has no passwords or sign-up form of
//! its own (FR-AUTH-01).
//!
//! Sign-in is OAuth 2.0's web application flow (IF-02). `/-/auth/sign-in` sends the
//! browser to GitHub, which asks the user to let BuhTig identify them, and grants nothing
//! more (FR-AUTH-02). GitHub then sends the browser to `/-/auth/callback` with a code,
//! which BuhTig exchanges for the user's token. Their session then begins.
//!
//! Each sign-in has a random state, which goes to GitHub in the URL, and stays behind in a
//! cookie for 10 minutes. The callback is taken only with the same state, so that no one
//! can bring another person's browser back from GitHub signed in. Either way the cookie is
//! removed, so that a state serves once (FR-AUTH-03).
//!
//! The user then goes back to the page they signed in from (FR-AUTH-05). That must be a
//! path of BuhTig's own, so that sign-in sends no one elsewhere (NFR-SEC-04).
//!
//! Each client may have at most 10 sign-ins checked with GitHub a minute (NFR-SEC-08), so
//! that BuhTig cannot be used to try out codes.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{AppendHeaders, IntoResponse, Redirect, Response};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sea_orm::entity::prelude::ChronoUtc;
use sea_orm::sea_query::prelude::chrono::TimeDelta;
use serde_json::Value;
use tracing::{debug, error, info, warn};
use url::{Position, Url};

use crate::accounts::is_account_name;
use crate::config::Secret;
use crate::crypto;
use crate::github::{self, Credential, Reply};
use crate::session::{Profile, Sessions};
use crate::throttle::Throttle;
use crate::visitors::Visitor;
use crate::{cookies, web};

/// The cookie that keeps a sign-in's state, and the page to return to.
const STATE_COOKIE: &str = "buhtig_sign_in";

/// Only the callback reads the state cookie, so only requests under this path carry it.
const STATE_PATH: &str = "/-/auth/";

/// How long a sign-in may take, from leaving for GitHub to coming back.
const STATE_LIFETIME: Duration = Duration::from_secs(10 * 60);

/// The longest path that sign-in returns to. A browser drops a cookie of more than 4 KB.
const MAX_RETURN_PATH: usize = 2048;

/// The page for a GitHub account that may not sign in (FR-AUTH-08).
const NOT_ALLOWED: &str = "/-/not-allowed";

/// The page for a sign-in that did not succeed, which offers to try again.
const SIGN_IN_FAILED: &str = "/-/sign-in-failed";

/// How many sign-ins each client may have checked with GitHub in [`SIGN_IN_WINDOW`]
/// (NFR-SEC-08).
const SIGN_INS: usize = 10;

const SIGN_IN_WINDOW: TimeDelta = TimeDelta::minutes(1);

pub struct Auth {
    sessions: Arc<Sessions>,
    github: Arc<github::Client>,
    /// `server.public_url`, whose paths are BuhTig's own.
    public_url: Url,
    /// `{server.public_url}/-/auth/callback`, which the OAuth app is registered with
    /// (A-04).
    callback: Url,
    /// The sign-ins that each client has had checked with GitHub.
    sign_ins: Throttle,
}

impl Auth {
    pub fn new(sessions: Arc<Sessions>, github: Arc<github::Client>, public_url: Url) -> Auth {
        let callback = public_url
            .join("/-/auth/callback")
            .expect("a path joins any https URL");
        Auth {
            sessions,
            github,
            public_url,
            callback,
            sign_ins: Throttle::new(SIGN_INS, SIGN_IN_WINDOW),
        }
    }

    /// Where the callback ends for `client`, and the session's cookie when it began one.
    async fn complete(
        &self,
        query: &HashMap<String, String>,
        headers: &HeaderMap,
        client: &Visitor,
    ) -> Completed {
        let Some((state, return_to)) =
            cookies::get(headers, STATE_COOKIE).and_then(|started| started.split_once('.'))
        else {
            info!(
                "sign-in failed: the browser did not bring back its sign-in cookie, as when \
                 sign-in takes over 10 minutes, or BuhTig is not opened at server.public_url"
            );
            return Completed::Failed { to: None };
        };
        // Hashed, so that how long the comparison takes tells nothing of the state.
        let matches = query.get("state").is_some_and(|given| {
            crypto::sha256(given.as_bytes()) == crypto::sha256(state.as_bytes())
        });
        if !matches {
            debug!("sign-in failed: the state is not the one this browser left with");
            return Completed::Failed { to: None };
        }
        let to = URL_SAFE_NO_PAD
            .decode(return_to)
            .ok()
            .and_then(|path| String::from_utf8(path).ok());
        // Checked again, though BuhTig set the cookie: its user may have changed it.
        let to = return_path(&self.public_url, to.as_deref());

        match query.get("error").map(String::as_str) {
            // The user chose not to sign in.
            Some("access_denied") => return Completed::Cancelled { to },
            Some(error) => {
                warn!("sign-in failed: GitHub answered {error:?}");
                return Completed::Failed { to: Some(to) };
            }
            None => {}
        }
        let Some(code) = query.get("code") else {
            warn!("sign-in failed: GitHub gave no code");
            return Completed::Failed { to: Some(to) };
        };
        // Counted only once GitHub is to be asked about it, as tokens are.
        if self.sign_ins.admit(client, ChronoUtc::now()).is_err() {
            info!("turned a sign-in away: too many from one client in a minute");
            return Completed::TooMany { to };
        }
        let token = match self.github.exchange(code, &self.callback).await {
            Ok(token) => token,
            Err(error) => {
                warn!("sign-in failed: cannot exchange GitHub's code for a token: {error}");
                return Completed::Failed { to: Some(to) };
            }
        };
        let profile = match self.profile(&token).await {
            Ok(profile) => profile,
            Err(error) => {
                warn!("sign-in failed: cannot read who signed in: {error}");
                return Completed::Failed { to: Some(to) };
            }
        };
        if !self.sessions.allows(&profile.login) {
            info!("turned a sign-in away: access.allowed_users does not list the GitHub user");
            return Completed::NotAllowed;
        }
        match self.sessions.sign_in(profile, &token, headers).await {
            Ok(session) => Completed::SignedIn { session, to },
            Err(error) => {
                error!("sign-in failed: cannot store the session: {error}");
                Completed::Failed { to: Some(to) }
            }
        }
    }

    /// The GitHub user whose token `token` is.
    async fn profile(&self, token: &Secret<String>) -> Result<Profile, github::Error> {
        let user = github::Path::new(["user"]).expect("user is neither empty nor dots");
        // Not through the cache: what GitHub answers is the token's own.
        let reply = self
            .github
            .get(&Credential::Token(token.clone()), &user, None)
            .await?;
        let Reply::Fresh { data, .. } = reply else {
            return Err(github::Error::Invalid("no user".to_owned()));
        };
        profile(&data).ok_or_else(|| {
            github::Error::Invalid("a user without an ID, a login or an avatar".to_owned())
        })
    }
}

/// Where a callback ended.
enum Completed {
    SignedIn {
        session: HeaderValue,
        to: String,
    },
    /// The user chose not to sign in on GitHub.
    Cancelled {
        to: String,
    },
    NotAllowed,
    /// The client has had too many sign-ins checked in a minute (NFR-SEC-08), and may try
    /// again from `to` later.
    TooMany {
        to: String,
    },
    /// To try again from, and back to `to`, when it is known.
    Failed {
        to: Option<String>,
    },
}

/// `/-/auth/sign-in?return_to=/owner/repo`: sends the browser to sign in with GitHub, and
/// then to come back to `return_to`, or the home page.
pub async fn sign_in(
    State(auth): State<Arc<Auth>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let return_to = return_path(&auth.public_url, query.get("return_to").map(String::as_str));
    let state = crypto::random_id();
    let cookie = cookies::set(
        STATE_COOKIE,
        &format!("{state}.{}", URL_SAFE_NO_PAD.encode(&return_to)),
        STATE_PATH,
        STATE_LIFETIME,
        auth.sessions.secure(),
    );
    redirect(
        auth.github.authorize_url(&auth.callback, &state).as_str(),
        [cookie],
    )
}

/// `/-/auth/callback?code=…&state=…`: where GitHub sends the browser back to. It goes on
/// to the page it signed in from, now signed in. A user who chose not to sign in goes back
/// there too, still a visitor. A GitHub account that `access.allowed_users` does not list
/// gets the "not allowed" page, and no session (FR-AUTH-08). Any other failure gets a page
/// that offers to try again, which also tells a client that has had 10 sign-ins checked in
/// the past minute to wait (NFR-SEC-08).
pub async fn callback(
    State(auth): State<Arc<Auth>>,
    client: Visitor,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Response {
    let mut cookies = vec![cookies::remove(
        STATE_COOKIE,
        STATE_PATH,
        auth.sessions.secure(),
    )];
    let location = match auth.complete(&query, &headers, &client).await {
        Completed::SignedIn { session, to } => {
            cookies.push(session);
            to
        }
        Completed::Cancelled { to } => to,
        Completed::NotAllowed => NOT_ALLOWED.to_owned(),
        Completed::TooMany { to } => failed(Some("too_many"), Some(&to)),
        Completed::Failed { to } => failed(None, to.as_deref()),
    };
    redirect(&location, cookies)
}

/// The page for a sign-in that did not succeed, which says why if `reason` does, and tries
/// again from `to`, unless that is the home page, which it tries again from anyway.
fn failed(reason: Option<&str>, to: Option<&str>) -> String {
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    if let Some(reason) = reason {
        query.append_pair("reason", reason);
    }
    if let Some(to) = to.filter(|to| *to != "/") {
        query.append_pair("return_to", to);
    }
    match query.finish() {
        query if query.is_empty() => SIGN_IN_FAILED.to_owned(),
        query => format!("{SIGN_IN_FAILED}?{query}"),
    }
}

/// `POST /-/auth/sign-out`: ends the browser's session on the server at once
/// (FR-AUTH-07), and takes it to the home page. It changes state, so it is no GET, and
/// other origins' pages cannot send it ([`crate::security`], NFR-SEC-02).
pub async fn sign_out(State(auth): State<Arc<Auth>>, headers: HeaderMap) -> Response {
    match auth.sessions.sign_out(&headers).await {
        Ok(()) => redirect("/", [auth.sessions.removal()]),
        Err(error) => {
            // The session still holds, so the browser keeps its cookie.
            error!("cannot sign out: {error}");
            web::unavailable()
        }
    }
}

/// A redirect to `location`, which the browser follows with a GET and does not keep,
/// that sets `cookies`.
fn redirect(location: &str, cookies: impl IntoIterator<Item = HeaderValue>) -> Response {
    (
        AppendHeaders(
            cookies
                .into_iter()
                .map(|cookie| (header::SET_COOKIE, cookie)),
        ),
        [(header::CACHE_CONTROL, "no-store")],
        Redirect::to(location),
    )
        .into_response()
}

/// Where to go after sign-in (FR-AUTH-05): `path` if it is a page of BuhTig's own, else
/// the home page (NFR-SEC-04). It must be a path alone, rather than a URL, or a path that
/// a browser takes for a URL, such as `//host` or `/\host`. Sign-in's own pages are not
/// returned to.
fn return_path(public_url: &Url, path: Option<&str>) -> String {
    path.filter(|path| {
        path.len() <= MAX_RETURN_PATH
            && path.starts_with('/')
            && !path.starts_with("//")
            && !path.contains('\\')
            && !path.chars().any(char::is_control)
    })
    .and_then(|path| public_url.join(path).ok())
    .filter(|url| url.origin() == public_url.origin() && !url.path().starts_with(STATE_PATH))
    .map(|url| url[Position::BeforePath..].to_owned())
    .unwrap_or_else(|| "/".to_owned())
}

/// The user GitHub describes in `data`, the answer to `GET /user`.
fn profile(data: &Value) -> Option<Profile> {
    let avatar_url = data.get("avatar_url")?.as_str()?;
    // As other avatars, only from https URLs (NFR-SEC-03).
    Url::parse(avatar_url)
        .ok()
        .filter(|url| url.scheme() == "https")?;
    Some(Profile {
        github_id: data.get("id")?.as_i64()?,
        login: data
            .get("login")?
            .as_str()
            .filter(|login| is_account_name(login))?
            .to_owned(),
        name: data
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .map(str::to_owned),
        avatar_url: avatar_url.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use axum::http::header::{AUTHORIZATION, COOKIE, LOCATION, SET_COOKIE};
    use axum::http::{Request, StatusCode};
    use sea_orm::{DatabaseConnection, EntityTrait};

    use super::*;
    use crate::config::DatabaseConfig;
    use crate::crypto::Sealer;
    use crate::db;
    use crate::entity::{session, user};
    use crate::github::stub::{Stub, answer, client};
    use crate::session::Settings;
    use crate::test_cluster::cluster;

    const MONA: &str = r#"{"id": 583231, "login": "Mona", "name": "Mona Lisa", "avatar_url": "https://avatars.githubusercontent.com/u/583231"}"#;

    fn public_url() -> Url {
        Url::parse("https://buhtig.example.com").unwrap()
    }

    #[test]
    fn sign_in_returns_only_to_pages_of_buhtigs_own() {
        let url = public_url();
        for (path, expected) in [
            (Some("/owner/repo"), "/owner/repo"),
            (Some("/org"), "/org"),
            (Some("/-/about"), "/-/about"),
            (Some("/?q=owner%2Frepo"), "/?q=owner%2Frepo"),
            (Some("/owner/../org"), "/org"),
            (
                Some("/owner/repo/%2F%2Fevil.example"),
                "/owner/repo/%2F%2Fevil.example",
            ),
            (None, "/"),
            (Some(""), "/"),
            (Some("owner/repo"), "/"),
            (Some("//evil.example"), "/"),
            (Some("///evil.example"), "/"),
            (Some(r"/\evil.example"), "/"),
            (Some(r"\\evil.example"), "/"),
            (Some("https://evil.example/"), "/"),
            (Some("https://buhtig.example.com/owner/repo"), "/"),
            (Some("javascript:alert(1)"), "/"),
            (Some("/\t/evil.example"), "/"),
            (Some("/owner\n/repo"), "/"),
            (Some("/-/auth/sign-in"), "/"),
            (Some("/-/auth/callback?code=x"), "/"),
        ] {
            assert_eq!(return_path(&url, path), expected, "{path:?}");
        }
        let long = format!("/{}", "a".repeat(MAX_RETURN_PATH));
        assert_eq!(return_path(&url, Some(&long)), "/");
        let longest = format!("/{}", "a".repeat(MAX_RETURN_PATH - 1));
        assert_eq!(return_path(&url, Some(&longest)), longest);
    }

    #[test]
    fn profiles_are_what_github_says_of_the_user() {
        let mona = Profile {
            github_id: 583231,
            login: "Mona".to_owned(),
            name: Some("Mona Lisa".to_owned()),
            avatar_url: "https://avatars.githubusercontent.com/u/583231".to_owned(),
        };
        let data: Value = serde_json::from_str(MONA).unwrap();
        assert_eq!(profile(&data), Some(mona.clone()));

        let mut nameless = data.clone();
        nameless["name"] = Value::Null;
        assert_eq!(profile(&nameless).unwrap().name, None);
        nameless["name"] = "".into();
        assert_eq!(profile(&nameless).unwrap().name, None);

        for (field, value) in [
            ("id", Value::Null),
            ("id", "583231".into()),
            ("login", Value::Null),
            ("login", "-mona".into()),
            ("avatar_url", Value::Null),
            (
                "avatar_url",
                "http://avatars.githubusercontent.com/u/583231".into(),
            ),
        ] {
            let mut odd = data.clone();
            odd[field] = value;
            assert_eq!(profile(&odd), None, "{odd}");
        }
    }

    /// GitHub, as sign-in meets it: it takes the code `good` for Mona's token, and the
    /// code `bobs` for Bob's.
    fn github() -> Arc<Stub> {
        Stub::new(|request: &Request<_>| {
            if request.uri() == "https://github.com/login/oauth/access_token" {
                let form = String::from_utf8(request.body().to_vec()).unwrap();
                return match form.split('&').find(|pair| pair.starts_with("code=")) {
                    Some("code=good") => answer(200, &[], r#"{"access_token":"gho_mona"}"#),
                    Some("code=bobs") => answer(200, &[], r#"{"access_token":"gho_bob"}"#),
                    _ => answer(200, &[], r#"{"error":"bad_verification_code"}"#),
                };
            }
            let token = request.headers()[AUTHORIZATION].to_str().unwrap();
            match (request.uri().path(), token) {
                ("/user", "Bearer gho_mona") => answer(200, &[], MONA),
                ("/user", "Bearer gho_bob") => answer(
                    200,
                    &[],
                    r#"{"id": 2, "login": "bob", "avatar_url": "https://avatars.githubusercontent.com/u/2"}"#,
                ),
                _ => answer(401, &[], r#"{"message":"Bad credentials"}"#),
            }
        })
    }

    /// Sign-in in front of `stub`, on `db`, where only `allowed_users` may sign in.
    fn auth(stub: &Arc<Stub>, db: DatabaseConnection, allowed_users: &[&str]) -> Arc<Auth> {
        let sessions = Sessions::new(
            db,
            Arc::new(Sealer::new(b"a secret of at least thirty-two bytes")),
            Settings {
                idle_timeout: Duration::from_secs(7 * 24 * 60 * 60),
                max_age: Duration::from_secs(30 * 24 * 60 * 60),
                allowed_users: allowed_users
                    .iter()
                    .map(|login| login.to_string())
                    .collect(),
                secure: true,
            },
        );
        Arc::new(Auth::new(
            Arc::new(sessions),
            Arc::new(client(stub)),
            public_url(),
        ))
    }

    /// Sign-in that never reaches the database, which this one does not have.
    fn without_database(stub: &Arc<Stub>, allowed_users: &[&str]) -> Arc<Auth> {
        auth(stub, DatabaseConnection::default(), allowed_users)
    }

    /// The client that most sign-ins here come from.
    fn browser() -> Visitor {
        Visitor::of("203.0.113.1".parse().unwrap(), &HeaderMap::new())
    }

    fn query(pairs: &[(&str, &str)]) -> Query<HashMap<String, String>> {
        Query(
            pairs
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect(),
        )
    }

    fn location(response: &Response) -> &str {
        response.headers()[LOCATION].to_str().unwrap()
    }

    fn set_cookies(response: &Response) -> Vec<&str> {
        response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .map(|cookie| cookie.to_str().unwrap())
            .collect()
    }

    /// The headers of a request that carries the cookies `response` sets.
    fn carrying(response: &Response) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for cookie in set_cookies(response) {
            let pair = cookie.split(';').next().unwrap();
            headers.append(COOKIE, HeaderValue::from_str(pair).unwrap());
        }
        headers
    }

    /// Starts a sign-in from `return_to`: the response, and the state it left with.
    async fn start(auth: &Arc<Auth>, return_to: &str) -> (Response, String) {
        let response = sign_in(State(auth.clone()), query(&[("return_to", return_to)])).await;
        let url = Url::parse(location(&response)).unwrap();
        let state = url
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        (response, state)
    }

    const STATE_REMOVED: &str =
        "buhtig_sign_in=; Path=/-/auth/; Max-Age=0; HttpOnly; SameSite=Lax; Secure";

    #[tokio::test]
    async fn sign_in_leaves_for_github_with_a_state_of_this_browsers_own() {
        let stub = github();
        let auth = without_database(&stub, &[]);
        let (response, state) = start(&auth, "/owner/repo").await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            location(&response),
            format!(
                "https://github.com/login/oauth/authorize?client_id=client-id\
                 &redirect_uri=https%3A%2F%2Fbuhtig.example.com%2F-%2Fauth%2Fcallback\
                 &state={state}"
            )
        );
        assert_eq!(state.len(), 43);
        assert_eq!(
            set_cookies(&response),
            [format!(
                "buhtig_sign_in={state}.{}; Path=/-/auth/; Max-Age=600; HttpOnly; \
                 SameSite=Lax; Secure",
                URL_SAFE_NO_PAD.encode("/owner/repo")
            )]
        );
        assert_ne!(start(&auth, "/owner/repo").await.1, state);
        assert!(stub.requests().is_empty());
    }

    #[tokio::test]
    async fn a_callback_without_this_browsers_state_is_turned_away() {
        let stub = github();
        let auth = without_database(&stub, &[]);
        let (started, state) = start(&auth, "/owner/repo").await;
        let (_, other) = start(&auth, "/owner/repo").await;

        for (headers, state) in [
            // Another browser's state, or none at all.
            (carrying(&started), other.as_str()),
            (carrying(&started), ""),
            // A browser that did not start this sign-in.
            (HeaderMap::new(), state.as_str()),
        ] {
            let response = callback(
                State(auth.clone()),
                browser(),
                query(&[("code", "good"), ("state", state)]),
                headers,
            )
            .await;
            assert_eq!(response.status(), StatusCode::SEE_OTHER);
            assert_eq!(location(&response), "/-/sign-in-failed");
            assert_eq!(set_cookies(&response), [STATE_REMOVED]);
        }
        // So GitHub was not asked to exchange the code.
        assert!(stub.requests().is_empty());
    }

    #[tokio::test]
    async fn a_user_who_does_not_sign_in_goes_back_where_they_were() {
        let stub = github();
        let auth = without_database(&stub, &[]);
        let (started, state) = start(&auth, "/owner/repo").await;
        let response = callback(
            State(auth.clone()),
            browser(),
            query(&[("error", "access_denied"), ("state", &state)]),
            carrying(&started),
        )
        .await;
        assert_eq!(location(&response), "/owner/repo");
        assert_eq!(set_cookies(&response), [STATE_REMOVED]);
        assert!(stub.requests().is_empty());
    }

    #[tokio::test]
    async fn a_sign_in_that_fails_on_github_can_be_tried_again() {
        let stub = github();
        let auth = without_database(&stub, &[]);
        for pairs in [
            vec![("code", "used")],
            vec![],
            vec![("error", "redirect_uri_mismatch")],
        ] {
            let (started, state) = start(&auth, "/owner/repo").await;
            let mut pairs = pairs;
            pairs.push(("state", &state));
            let response = callback(
                State(auth.clone()),
                browser(),
                query(&pairs),
                carrying(&started),
            )
            .await;
            assert_eq!(
                location(&response),
                "/-/sign-in-failed?return_to=%2Fowner%2Frepo",
                "{pairs:?}"
            );
            assert_eq!(set_cookies(&response), [STATE_REMOVED]);
        }
        assert_eq!(stub.urls(), ["https://github.com/login/oauth/access_token"]);

        // From the home page, there is no page to go back to.
        let (started, state) = start(&auth, "/").await;
        let response = callback(
            State(auth.clone()),
            browser(),
            query(&[("code", "used"), ("state", &state)]),
            carrying(&started),
        )
        .await;
        assert_eq!(location(&response), "/-/sign-in-failed");
    }

    #[tokio::test]
    async fn each_client_may_have_10_sign_ins_checked_a_minute() {
        let stub = github();
        let auth = without_database(&stub, &[]);
        let try_sign_in = async |from: Visitor, return_to: &str, pairs: &[(&str, &str)]| {
            let (started, state) = start(&auth, return_to).await;
            let mut pairs = pairs.to_vec();
            pairs.push(("state", &state));
            callback(State(auth.clone()), from, query(&pairs), carrying(&started)).await
        };

        // What GitHub is not asked about does not count.
        for _ in 0..=SIGN_INS {
            try_sign_in(browser(), "/owner/repo", &[("error", "access_denied")]).await;
            try_sign_in(browser(), "/owner/repo", &[]).await;
        }
        assert!(stub.requests().is_empty());

        for _ in 0..SIGN_INS {
            let response = try_sign_in(browser(), "/owner/repo", &[("code", "used")]).await;
            assert_eq!(
                location(&response),
                "/-/sign-in-failed?return_to=%2Fowner%2Frepo"
            );
        }
        assert_eq!(stub.requests().len(), SIGN_INS);
        for (return_to, expected) in [
            (
                "/owner/repo",
                "/-/sign-in-failed?reason=too_many&return_to=%2Fowner%2Frepo",
            ),
            ("/", "/-/sign-in-failed?reason=too_many"),
        ] {
            let response = try_sign_in(browser(), return_to, &[("code", "good")]).await;
            assert_eq!(location(&response), expected);
            assert_eq!(set_cookies(&response), [STATE_REMOVED]);
        }
        // So GitHub was not asked again.
        assert_eq!(stub.requests().len(), SIGN_INS);

        // Another client has a limit of its own.
        let other = Visitor::of("203.0.113.2".parse().unwrap(), &HeaderMap::new());
        let response = try_sign_in(other, "/", &[("code", "used")]).await;
        assert_eq!(location(&response), "/-/sign-in-failed");
        assert_eq!(stub.requests().len(), SIGN_INS + 1);
    }

    #[tokio::test]
    async fn users_not_allowed_get_no_session() {
        let stub = github();
        // Without a database, any attempt to store something would fail the sign-in.
        let auth = without_database(&stub, &["mona"]);
        let (started, state) = start(&auth, "/owner/repo").await;
        let response = callback(
            State(auth.clone()),
            browser(),
            query(&[("code", "bobs"), ("state", &state)]),
            carrying(&started),
        )
        .await;
        assert_eq!(location(&response), "/-/not-allowed");
        assert_eq!(set_cookies(&response), [STATE_REMOVED]);
    }

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

    #[tokio::test]
    async fn signed_in_users_go_back_where_they_were_and_can_sign_out() {
        let stub = github();
        let db = database().await;
        // Logins ignore case.
        let auth = auth(&stub, db.clone(), &["mona"]);
        let (started, state) = start(&auth, "/owner/repo?tab=x").await;
        let response = callback(
            State(auth.clone()),
            browser(),
            query(&[("code", "good"), ("state", &state)]),
            carrying(&started),
        )
        .await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        assert_eq!(location(&response), "/owner/repo?tab=x");
        let cookies = set_cookies(&response);
        assert_eq!(cookies.len(), 2);
        assert_eq!(cookies[0], STATE_REMOVED);
        assert!(cookies[1].starts_with("buhtig_session="), "{}", cookies[1]);
        assert_eq!(
            stub.urls(),
            [
                "https://github.com/login/oauth/access_token",
                "https://api.github.com/user"
            ]
        );

        let users = user::Entity::find().all(&db).await.unwrap();
        assert_eq!(users.len(), 1);
        assert_eq!(users[0].login, "Mona");
        let signed_in = carrying(&response);
        let user = auth.sessions.resolve(&signed_in).await.unwrap().unwrap();
        assert_eq!(user.user, users[0]);
        assert_eq!(user.sign_in.expose(), "gho_mona");

        let response = sign_out(State(auth.clone()), signed_in.clone()).await;
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        assert_eq!(location(&response), "/");
        assert_eq!(
            set_cookies(&response),
            ["buhtig_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"]
        );
        assert!(auth.sessions.resolve(&signed_in).await.unwrap().is_none());
        assert!(session::Entity::find().all(&db).await.unwrap().is_empty());
    }
}
