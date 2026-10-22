//! How GitHub spells a repository's name. A repository's dashboard asks, so as to show
//! the name as GitHub spells it (FR-NAV-04), and the new one if the repository was renamed
//! or transferred (FR-NAV-05).

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use tracing::error;

use crate::accounts::is_account_name;
use crate::cache::{self, Cache, Outcome, Viewer};
use crate::github;
use crate::visitors::Visitor;

/// The longest repository name GitHub allows.
const MAX_LENGTH: usize = 100;

/// `/-/api/repositories/{owner}/{repo}`: `{"name": "owner/repo"}`, the repository's name
/// as GitHub spells it, whatever case it was asked for in (FR-NAV-04), and its new name if
/// it was renamed or transferred, since the client follows GitHub's redirects (FR-NAV-05).
/// 404 if there is no such repository, or if it is private (FR-ACC-05).
///
/// Names that cannot be a repository's are 400, without asking GitHub (FR-SRCH-04). Any
/// other status means that BuhTig cannot tell now. The dashboard then keeps its URL.
pub async fn name(
    State(cache): State<Arc<Cache>>,
    visitor: Visitor,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    if !is_account_name(&owner) || !is_repository_name(&repo) {
        return status(StatusCode::BAD_REQUEST);
    }
    let path = github::Path::new(["repos", owner.as_str(), repo.as_str()])
        .expect("names are neither empty nor dots");
    // Everyone is a visitor until sign-in is built (#22). A token user will then read
    // with their PAT, which may see private repositories (#23). The repository is read
    // for its dashboard, so a visitor's load of that counts once (FR-DATA-10).
    let viewer = Viewer::Visitor(visitor);
    match cache.get(&viewer, &format!("/{owner}/{repo}"), &path).await {
        Ok(Outcome::Data(cached)) => match cached.data.get("full_name").and_then(Value::as_str) {
            Some(name) => (
                [(header::CACHE_CONTROL, "no-store")],
                Json(json!({ "name": name })),
            )
                .into_response(),
            None => status(StatusCode::BAD_GATEWAY),
        },
        Ok(Outcome::Computing) => status(StatusCode::BAD_GATEWAY),
        Err(cache::Error::GitHub(github::Error::NotFound)) => status(StatusCode::NOT_FOUND),
        Err(cache::Error::GitHub(_)) => status(StatusCode::BAD_GATEWAY),
        Err(cache::Error::Held(_)) => status(StatusCode::TOO_MANY_REQUESTS),
        Err(error @ cache::Error::Database(_)) => {
            error!("{error}");
            status(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

/// Whether `name` can be a GitHub repository's (FR-SRCH-04): up to 100 letters, digits,
/// hyphens, underscores and periods, other than `.` and `..`. The search box checks the
/// same rule, in `search/parse.ts`.
pub fn is_repository_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_LENGTH
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn status(status: StatusCode) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::http::HeaderMap;
    use url::Url;

    use super::*;
    use crate::config::{CacheConfig, DatabaseConfig, LimitsConfig, Secret};
    use crate::db;
    use crate::github::stub::{Stub, answer, client};
    use crate::test_cluster::cluster;

    /// A stub GitHub with a repository `Acme/Widget`, one that was renamed to it, and a
    /// few odd answers. Like GitHub, it ignores the case of names.
    fn github() -> Arc<Stub> {
        Stub::new(
            |request| match request.uri().path().to_ascii_lowercase().as_str() {
                "/repos/acme/widget" | "/repositories/42" => answer(
                    200,
                    &[],
                    r#"{"full_name": "Acme/Widget", "private": false}"#,
                ),
                "/repos/acme/gadget" => answer(
                    301,
                    &[("location", "https://api.github.com/repositories/42")],
                    r#"{"message": "Moved Permanently"}"#,
                ),
                "/repos/acme/nameless" => answer(200, &[], r#"{"private": false}"#),
                "/repos/acme/broken" => answer(500, &[], r#"{"message": "Server Error"}"#),
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

    /// The status and body of a visitor's request for `owner/repo`'s name.
    async fn ask(cache: &Arc<Cache>, owner: &str, repo: &str) -> (StatusCode, String) {
        let visitor = Visitor::of("203.0.113.1".parse().unwrap(), &HeaderMap::new());
        let names = Path((owner.to_owned(), repo.to_owned()));
        let response = name(State(cache.clone()), visitor, names).await;
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn names_are_spelled_as_github_spells_them() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        for (owner, repo) in [("Acme", "Widget"), ("acme", "widget"), ("ACME", "WIDGET")] {
            assert_eq!(
                ask(&cache, owner, repo).await,
                (StatusCode::OK, r#"{"name":"Acme/Widget"}"#.to_owned()),
                "{owner}/{repo}"
            );
        }
    }

    #[tokio::test]
    async fn renamed_repositories_have_their_new_name() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, "acme", "gadget").await,
            (StatusCode::OK, r#"{"name":"Acme/Widget"}"#.to_owned())
        );
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/repos/acme/gadget",
                "https://api.github.com/repositories/42"
            ]
        );
    }

    #[tokio::test]
    async fn what_github_cannot_tell_is_not_an_answer() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, "acme", "nothing").await,
            (StatusCode::NOT_FOUND, String::new())
        );
        assert_eq!(
            ask(&cache, "acme", "broken").await.0,
            StatusCode::BAD_GATEWAY
        );
        assert_eq!(
            ask(&cache, "acme", "nameless").await.0,
            StatusCode::BAD_GATEWAY
        );
    }

    #[tokio::test]
    async fn names_that_cannot_be_repositories_are_not_asked_for() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let longest = "a".repeat(101);
        for (owner, repo) in [
            ("-acme", "widget"),
            ("acme.com", "widget"),
            ("acme", ""),
            ("acme", "."),
            ("acme", ".."),
            ("acme", "wid get"),
            ("acme", "widgét"),
            ("acme", "widget/x"),
            ("acme", &longest),
        ] {
            assert_eq!(
                ask(&cache, owner, repo).await.0,
                StatusCode::BAD_REQUEST,
                "{owner}/{repo}"
            );
        }
        assert_eq!(stub.urls(), Vec::<String>::new());
    }

    #[tokio::test]
    async fn dotted_and_longest_names_are_asked_for() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let longest = "a".repeat(100);
        let names = [".github", "next.js", "a_b-c", "...", &longest];
        for repo in names {
            assert_eq!(
                ask(&cache, "acme", repo).await.0,
                StatusCode::NOT_FOUND,
                "{repo}"
            );
        }
        let asked: Vec<String> = names
            .iter()
            .map(|repo| format!("https://api.github.com/repos/acme/{repo}"))
            .collect();
        assert_eq!(stub.urls(), asked);
    }

    #[tokio::test]
    async fn visitors_held_back_are_told_so() {
        let stub = github();
        let cache = cache(&stub, 0).await;
        assert_eq!(
            ask(&cache, "acme", "widget").await.0,
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(stub.urls(), Vec::<String>::new());
    }
}
