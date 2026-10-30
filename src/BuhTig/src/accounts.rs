//! Whether a GitHub account is an organization or a user, and how GitHub spells its name.
//! The search box asks before it opens an organization's dashboard, since BuhTig has none
//! for users (FR-SRCH-06). The dashboard asks so as to show the name as GitHub spells it
//! (FR-NAV-04). For a user, the page that says so suggests some of their repositories
//! instead (FR-SRCH-06).

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use tracing::error;

use crate::cache::{self, Cache, Cached, Outcome, Viewer};
use crate::github;
use crate::repositories::{data, names, visibility};

/// The longest account name GitHub allows.
const MAX_LENGTH: usize = 39;

/// FR-SRCH-06: the repositories suggested in place of a user's dashboard.
const SUGGESTED: usize = 6;

/// `/-/api/accounts/{name}`: `{"type": "organization" | "user", "login": …, "fetched_at": …}`,
/// where `login` is the name as GitHub spells it, whatever case it was asked for in
/// (FR-NAV-04), and `fetched_at` is when GitHub gave it, which an organization's dashboard
/// shows (FR-DATA-06). 404 if there is no such account.
///
/// A name that cannot be an account's is 400, without asking GitHub (FR-SRCH-04). Any
/// other status means that BuhTig cannot tell now. The search box then opens the
/// dashboard anyway, which says why it has no data.
pub async fn kind(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(name): Path<String>,
) -> Response {
    if !is_account_name(&name) {
        return status(StatusCode::BAD_REQUEST);
    }
    let path = github::Path::new(["users", name.as_str()])
        .expect("an account name is neither empty nor dots");
    // An account's public profile, the same for everyone, so it may be shared. It is read
    // for the dashboard it leads to, so a visitor's load of that counts once (FR-DATA-10).
    match cache.get(&viewer, &format!("/{name}"), &path).await {
        Ok(Outcome::Data(cached)) => {
            let login = cached.data.get("login").and_then(Value::as_str);
            match (cached.data.get("type").and_then(Value::as_str), login) {
                (Some("Organization"), Some(login)) => found("organization", login, &cached),
                (Some("User"), Some(login)) => found("user", login, &cached),
                _ => status(StatusCode::BAD_GATEWAY),
            }
        }
        Ok(Outcome::Computing) => status(StatusCode::BAD_GATEWAY),
        Err(cache::Error::GitHub(github::Error::NotFound)) => status(StatusCode::NOT_FOUND),
        // As for a dashboard's data (FR-AUTH-09).
        Err(cache::Error::GitHub(github::Error::BadCredentials)) => {
            status(StatusCode::UNAUTHORIZED)
        }
        Err(cache::Error::GitHub(_)) => status(StatusCode::BAD_GATEWAY),
        Err(cache::Error::Held(_)) => status(StatusCode::TOO_MANY_REQUESTS),
        Err(error @ cache::Error::Database(_)) => {
            error!("{error}");
            status(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

/// `/-/api/users/{login}/repositories`: up to 6 of the repositories that the user `login`
/// owns, those pushed to most recently first, which the page that says `login` is a user's
/// account suggests opening instead (FR-SRCH-06),
///
/// ```json
/// {"login": "octocat", "repositories": [{"name": "octocat/Hello-World"}, …]}
/// ```
///
/// `login` is the user's login as GitHub spells it, from their repositories, or as it was
/// asked for if they have none. Each `name` is a repository's `owner/repo`, as GitHub spells
/// it, for its dashboard (FR-NAV-04). Forks are among them, as GitHub lists them, and
/// private and internal ones are not. GitHub lists only public ones to any credential but a
/// PAT, and the cache answers a list that holds any other as not found, and keeps it out of
/// the shared cache (FR-DATA-04). A PAT's reads are cached for its user alone, yet only the
/// public ones are suggested to anyone. The list is read for the dashboard at `/{login}`, as
/// [`kind`] reads the account, so a visitor's load of both counts once (FR-DATA-10).
///
/// 404 if there is no such account. A name that cannot be an account's is 400, without
/// asking GitHub (FR-SRCH-04). Its other statuses are those of a dashboard's data, as
/// [`data`] tells them.
pub async fn repositories(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(login): Path<String>,
) -> Response {
    if !is_account_name(&login) {
        return status(StatusCode::BAD_REQUEST);
    }
    let path = github::Path::new(["users", login.as_str(), "repos"])
        .expect("an account name is neither empty nor dots")
        .query("type", "owner")
        .query("sort", "pushed");
    let list = cache
        .get_list(&viewer, &format!("/{login}"), &path, SUGGESTED)
        .await;
    let list = match data(list) {
        Ok(list) => list.data,
        Err(code) => return status(code),
    };
    let suggested: Vec<&str> = list
        .items
        .iter()
        .filter(|repository| visibility(repository) == "public")
        .filter_map(|repository| repository.get("full_name")?.as_str())
        .filter(|name| names(name).is_some())
        .collect();
    // As GitHub spells it, in the names of the repositories it lists as theirs.
    let spelled = suggested
        .iter()
        .filter_map(|name| names(name).map(|(owner, _)| owner))
        .find(|owner| owner.eq_ignore_ascii_case(&login))
        .unwrap_or(&login);
    let suggested: Vec<Value> = suggested
        .iter()
        .map(|name| json!({ "name": name }))
        .collect();
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({ "login": spelled, "repositories": suggested })),
    )
        .into_response()
}

/// Whether `name` can be a GitHub account's (FR-SRCH-04): up to 39 letters, digits,
/// hyphens and underscores, not starting with a hyphen.
///
/// GitHub's rule today is stricter, but older accounts have consecutive or trailing
/// hyphens, and Enterprise Managed Users have an underscore. None starts with a hyphen,
/// which keeps `/-/` free for BuhTig's own pages (FR-NAV-03). The search box checks the
/// same rule, in `search/parse.ts`.
pub fn is_account_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_LENGTH
        && !name.starts_with('-')
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn found(kind: &str, login: &str, cached: &Cached<Value>) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({ "type": kind, "login": login, "fetched_at": cached.fetched_at_iso() })),
    )
        .into_response()
}

fn status(status: StatusCode) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::http::HeaderMap;
    use axum::http::header::AUTHORIZATION;
    use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
    use sea_orm::sea_query::prelude::chrono::TimeDelta;
    use url::Url;

    use super::*;
    use crate::config::{CacheConfig, DatabaseConfig, LimitsConfig, Secret};
    use crate::db;
    use crate::github::stub::{Stub, answer, client};
    use crate::test_cluster::cluster;
    use crate::visitors::Visitor;

    /// The repositories of the user `Mona`, pushed to most recently first, as GitHub lists
    /// them to any credential, with some odd ones.
    const MONAS: &str = r#"[
        {"full_name": "Mona/widget", "private": false, "visibility": "public", "fork": false},
        {"full_name": "Mona/fork", "private": false, "visibility": "public", "fork": true},
        {"full_name": "../evil", "private": false},
        {"name": "nameless", "private": false},
        "odd",
        {"full_name": "Mona/gadget", "private": false}
    ]"#;

    /// As GitHub lists them to Mona's PAT: her private and internal ones too.
    const MONAS_TO_HER_PAT: &str = r#"[
        {"full_name": "Mona/widget", "private": false, "visibility": "public", "fork": false},
        {"full_name": "Mona/diary", "private": true, "visibility": "private"},
        {"full_name": "Mona/inner", "private": true, "visibility": "internal"},
        {"full_name": "Mona/gadget", "private": false}
    ]"#;

    /// A stub GitHub with an organization `Acme`, the users `octocat`, who has no
    /// repositories, and `Mona`, and a few odd answers. Like GitHub, it ignores the case of
    /// names.
    fn github() -> Arc<Stub> {
        Stub::new(
            |request| match request.uri().path().to_ascii_lowercase().as_str() {
                "/users/acme" => answer(200, &[], r#"{"login": "Acme", "type": "Organization"}"#),
                "/users/octocat" => answer(200, &[], r#"{"login": "octocat", "type": "User"}"#),
                "/users/mannequin" => answer(200, &[], r#"{"login": "mannequin", "type": "?"}"#),
                "/users/nameless" => answer(200, &[], r#"{"type": "Organization"}"#),
                "/users/broken" | "/users/broken/repos" => {
                    answer(500, &[], r#"{"message": "Server Error"}"#)
                }
                "/users/octocat/repos" => answer(200, &[], "[]"),
                "/users/mona/repos" if request.headers()[AUTHORIZATION] == "Bearer pat" => {
                    answer(200, &[], MONAS_TO_HER_PAT)
                }
                "/users/mona/repos" => answer(200, &[], MONAS),
                // As GitHub would not: a private one, without a PAT.
                "/users/leaky/repos" => answer(200, &[], MONAS_TO_HER_PAT),
                _ => answer(404, &[], r#"{"message": "Not Found"}"#),
            },
        )
    }

    /// A cache on a database of its own, in front of `stub`, that lets each visitor make
    /// `visitor_fetches` dashboard loads an hour.
    async fn cache(stub: &Arc<Stub>, visitor_fetches: u32) -> Arc<Cache> {
        let cluster = cluster();
        let database = cluster.create_database();
        let db = db::connect(&DatabaseConfig {
            url: Secret::new(Url::parse(&cluster.url(&database)).unwrap()),
            max_connections: 5,
        })
        .await
        .unwrap();
        db::migrate(&db).await.unwrap();
        Arc::new(Cache::new(
            db,
            Arc::new(client(stub)),
            &CacheConfig {
                ttl: Duration::from_secs(15 * 60),
                retention: Duration::from_secs(30 * 24 * 60 * 60),
            },
            &LimitsConfig {
                org_repositories: 1000,
                visitor_fetches_per_hour: visitor_fetches,
            },
        ))
    }

    /// The status and body of a visitor's request for `name`'s kind.
    async fn request(cache: &Arc<Cache>, name: &str) -> (StatusCode, String) {
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let response = kind(State(cache.clone()), visitor, Path(name.to_owned())).await;
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    /// As [`request`], but with the time of fetching taken out of the body, since it is
    /// the time the test ran.
    async fn ask(cache: &Arc<Cache>, name: &str) -> (StatusCode, String) {
        let (status, body) = request(cache, name).await;
        if body.is_empty() {
            return (status, body);
        }
        let mut body: Value = serde_json::from_str(&body).unwrap();
        fetched_at(&body);
        body.as_object_mut().unwrap().remove("fetched_at");
        (status, body.to_string())
    }

    /// The time of fetching in `body`, which must be as JavaScript writes it.
    fn fetched_at(body: &Value) -> DateTimeUtc {
        let text = body["fetched_at"].as_str().unwrap();
        assert!(text.ends_with('Z') && text.len() == 24, "{text}");
        text.parse().unwrap()
    }

    #[tokio::test]
    async fn organizations_are_told_from_users() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, "Acme").await,
            (
                StatusCode::OK,
                r#"{"login":"Acme","type":"organization"}"#.to_owned()
            )
        );
        assert_eq!(
            ask(&cache, "octocat").await,
            (
                StatusCode::OK,
                r#"{"login":"octocat","type":"user"}"#.to_owned()
            )
        );
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/users/Acme",
                "https://api.github.com/users/octocat"
            ]
        );
    }

    #[tokio::test]
    async fn the_time_of_fetching_is_the_caches() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let before = ChronoUtc::now() - TimeDelta::milliseconds(1);
        let (_, first) = request(&cache, "acme").await;
        let (_, again) = request(&cache, "acme").await;
        let first = fetched_at(&serde_json::from_str(&first).unwrap());
        assert_eq!(fetched_at(&serde_json::from_str(&again).unwrap()), first);
        assert!(before <= first && first <= ChronoUtc::now(), "{first}");
        assert_eq!(stub.urls(), ["https://api.github.com/users/acme"]);
    }

    #[tokio::test]
    async fn names_are_spelled_as_github_spells_them() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        for name in ["acme", "ACME"] {
            assert_eq!(
                ask(&cache, name).await,
                (
                    StatusCode::OK,
                    r#"{"login":"Acme","type":"organization"}"#.to_owned()
                ),
                "{name}"
            );
        }
    }

    #[tokio::test]
    async fn what_github_cannot_tell_is_not_an_answer() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(ask(&cache, "nobody").await.0, StatusCode::NOT_FOUND);
        assert_eq!(ask(&cache, "broken").await.0, StatusCode::BAD_GATEWAY);
        assert_eq!(ask(&cache, "mannequin").await.0, StatusCode::BAD_GATEWAY);
        assert_eq!(ask(&cache, "nameless").await.0, StatusCode::BAD_GATEWAY);
    }

    #[tokio::test]
    async fn names_that_cannot_be_accounts_are_not_asked_for() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        for name in [
            "",
            "-acme",
            "acme.com",
            "acme/repo",
            "ac me",
            "acmé",
            "..",
            &"a".repeat(40),
        ] {
            assert_eq!(ask(&cache, name).await.0, StatusCode::BAD_REQUEST, "{name}");
        }
        assert_eq!(stub.urls(), Vec::<String>::new());
    }

    #[tokio::test]
    async fn older_names_are_asked_for() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let longest = "a".repeat(39);
        let names = [
            "x",
            "old--name",
            "trailing-",
            "mona_emu",
            "Acme-2",
            &longest,
        ];
        for name in names {
            assert_eq!(ask(&cache, name).await.0, StatusCode::NOT_FOUND, "{name}");
        }
        let asked: Vec<String> = names
            .iter()
            .map(|name| format!("https://api.github.com/users/{name}"))
            .collect();
        assert_eq!(stub.urls(), asked);
    }

    #[tokio::test]
    async fn visitors_held_back_are_told_so() {
        let stub = github();
        let cache = cache(&stub, 0).await;
        assert_eq!(ask(&cache, "acme").await.0, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            suggest(&cache, "mona").await,
            (StatusCode::TOO_MANY_REQUESTS, Value::Null)
        );
        assert_eq!(stub.urls(), Vec::<String>::new());
    }

    /// The status and body of a visitor's request for the repositories that the page about
    /// the user `login` suggests, as JSON, `null` if there is none.
    async fn suggest(cache: &Arc<Cache>, login: &str) -> (StatusCode, Value) {
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let response = repositories(State(cache.clone()), visitor, Path(login.to_owned())).await;
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
    }

    #[tokio::test]
    async fn a_users_own_repositories_pushed_to_last_are_suggested() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            suggest(&cache, "mona").await,
            (
                StatusCode::OK,
                json!({
                    // As GitHub spells it.
                    "login": "Mona",
                    // Forks too, and none that is not a repository's.
                    "repositories": [
                        {"name": "Mona/widget"},
                        {"name": "Mona/fork"},
                        {"name": "Mona/gadget"},
                    ],
                })
            )
        );
        // As it was asked for, without any repositories to tell how GitHub spells it.
        assert_eq!(
            suggest(&cache, "OctoCat").await,
            (
                StatusCode::OK,
                json!({"login": "OctoCat", "repositories": []})
            )
        );
        // Up to 6, those the user owns, pushed to most recently first, and then cached.
        assert_eq!(suggest(&cache, "mona").await.0, StatusCode::OK);
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/users/mona/repos?type=owner&sort=pushed&per_page=6",
                "https://api.github.com/users/OctoCat/repos?type=owner&sort=pushed&per_page=6",
            ]
        );
    }

    #[tokio::test]
    async fn only_public_repositories_are_suggested() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let token_user = Viewer::TokenUser {
            user_id: 1,
            credential_id: 1,
            pat: Secret::new("pat".to_owned()),
            sign_in: Secret::new("sign-in".to_owned()),
        };
        let response =
            repositories(State(cache.clone()), token_user, Path("mona".to_owned())).await;
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap(),
            json!({
                "login": "Mona",
                "repositories": [{"name": "Mona/widget"}, {"name": "Mona/gadget"}],
            })
        );
        // As a safeguard, a list that holds a private one is not found without a PAT, as
        // the cache answers it, and kept out of the shared cache (FR-DATA-04).
        assert_eq!(
            suggest(&cache, "leaky").await,
            (StatusCode::NOT_FOUND, Value::Null)
        );
    }

    #[tokio::test]
    async fn the_account_and_its_suggestions_are_one_load() {
        let stub = github();
        // One load an hour.
        let cache = cache(&stub, 1).await;
        assert_eq!(ask(&cache, "octocat").await.0, StatusCode::OK);
        assert_eq!(suggest(&cache, "OCTOCAT").await.0, StatusCode::OK);
        assert_eq!(
            suggest(&cache, "mona").await,
            (StatusCode::TOO_MANY_REQUESTS, Value::Null)
        );
        assert_eq!(stub.urls().len(), 2);
    }

    #[tokio::test]
    async fn suggestions_github_cannot_tell_are_not_an_answer() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            suggest(&cache, "nobody").await,
            (StatusCode::NOT_FOUND, Value::Null)
        );
        assert_eq!(
            suggest(&cache, "broken").await,
            (StatusCode::BAD_GATEWAY, Value::Null)
        );
        for login in [
            "",
            "-mona",
            "mona.com",
            "mona/repo",
            "mo na",
            &"a".repeat(40),
        ] {
            assert_eq!(
                suggest(&cache, login).await,
                (StatusCode::BAD_REQUEST, Value::Null),
                "{login}"
            );
        }
        assert_eq!(stub.urls().len(), 2);
    }
}
