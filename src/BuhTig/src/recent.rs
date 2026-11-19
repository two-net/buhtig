//! The repositories viewed last on BuhTig, which the home page offers below the search box
//! to anyone, and the Browse page lists at more length: those whose dashboards the shared
//! cache holds, which are only public ones (FR-DATA-04), as GitHub last gave them. Nothing
//! about who viewed them is told, or kept: only that GitHub was asked for them lately.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use sea_orm::DbErr;
use serde_json::{Value, json};
use tracing::error;

use crate::cache::{Cache, Cached};
use crate::repositories::{link, text, topics};

/// The repositories the home page offers.
const RECENT: usize = 8;

/// The most repositories the Browse page lists (FR-SRCH-14).
pub const BROWSED: usize = 200;

/// `/-/api/recent`: up to 8 of the public repositories that GitHub gave or confirmed last
/// for their dashboards, latest first, each once,
///
/// ```json
/// {"repositories": [{"name": "owner/repo", "owner_avatar_url": …, "description": …,
///   "language": "Rust" | null, "stars": …, "forks": …, "pushed_at": …,
///   "fetched_at": …}, …]}
/// ```
///
/// They are read from the shared cache alone, as [`Cache::recent_repositories`] has them,
/// and GitHub is never asked. `name` is `owner/repo` as GitHub spells it (FR-NAV-04), and
/// `fetched_at` when GitHub gave or confirmed what is told of it (FR-DATA-06), as the UI is
/// told times. What GitHub does not say, or says in a form BuhTig does not show, is `null`,
/// or 0 for a figure: avatars only from `https` URLs (NFR-SEC-03). Without any, there are
/// none. 503 if the database cannot be read.
pub async fn list(State(cache): State<Arc<Cache>>) -> Response {
    answer(
        cache.recent_repositories(RECENT).await,
        |recent| json!({ "repositories": recent.iter().map(repository).collect::<Vec<_>>() }),
    )
}

/// `/-/api/browse`: up to 200 of the public repositories that GitHub gave or confirmed last
/// for their dashboards, for the Browse page (FR-SRCH-14), as [`list`] tells them, each with
/// its topics, and how many it may list at most,
///
/// ```json
/// {"cap": 200, "repositories": [{"name": "owner/repo", …, "topics": ["cli", "rust"]}, …]}
/// ```
///
/// The page filters them by language and by topic, and pages through them, itself. They are
/// read as [`list`] reads them: from the shared cache alone, which holds nothing fetched with
/// a PAT (FR-DATA-04), and GitHub is never asked, so no visitor's load counts (FR-DATA-10).
/// A repository without topics has none. 503 if the database cannot be read.
pub async fn browse(State(cache): State<Arc<Cache>>) -> Response {
    answer(cache.recent_repositories(BROWSED).await, |recent| {
        let repositories: Vec<Value> = recent
            .iter()
            .map(|cached| {
                let mut listed = repository(cached);
                listed["topics"] = topics(&cached.data).into();
                listed
            })
            .collect();
        json!({ "cap": BROWSED, "repositories": repositories })
    })
}

/// The answer of `body` about the repositories `read`, or 503 if they could not be.
fn answer(
    read: Result<Vec<Cached<Value>>, DbErr>,
    body: impl FnOnce(&[Cached<Value>]) -> Value,
) -> Response {
    match read {
        Ok(recent) => ([(header::CACHE_CONTROL, "no-store")], Json(body(&recent))).into_response(),
        Err(error) => {
            error!("cannot read the repositories viewed last: {error}");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                [(header::CACHE_CONTROL, "no-store")],
            )
                .into_response()
        }
    }
}

/// A repository as the home page offers it.
fn repository(cached: &Cached<Value>) -> Value {
    let data = &cached.data;
    let figure = |key| data.get(key).and_then(Value::as_u64).unwrap_or(0);
    json!({
        "name": text(data, "full_name"),
        "owner_avatar_url": link(data.pointer("/owner/avatar_url"), &["https"]),
        "description": text(data, "description"),
        "language": text(data, "language"),
        "stars": figure("stargazers_count"),
        "forks": figure("forks_count"),
        "pushed_at": text(data, "pushed_at"),
        "fetched_at": cached.fetched_at_iso(),
    })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::http::HeaderMap;
    use sea_orm::entity::prelude::DateTimeUtc;
    use sea_orm::sea_query::Expr;
    use sea_orm::sea_query::prelude::chrono::TimeDelta;
    use sea_orm::{
        ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait,
        QueryFilter, Set,
    };
    use url::Url;

    use super::*;
    use crate::cache::{Outcome, Viewer};
    use crate::config::{CacheConfig, DatabaseConfig, LimitsConfig, Secret};
    use crate::db;
    use crate::entity::cache_entry::{self, Scope};
    use crate::entity::{credential, user};
    use crate::github::Path;
    use crate::github::stub::{Stub, answer, client};
    use crate::test_cluster::cluster;
    use crate::visitors::Visitor;

    /// The first time of these tests.
    fn at(minutes: i64) -> DateTimeUtc {
        "2026-10-20T12:00:00Z".parse::<DateTimeUtc>().unwrap() + TimeDelta::minutes(minutes)
    }

    /// The repository `owner/name`, as GitHub gives it.
    fn repository(owner: &str, name: &str) -> Value {
        json!({
            "full_name": format!("{owner}/{name}"),
            "private": false,
            "visibility": "public",
            "owner": {"login": owner, "avatar_url": format!("https://avatars.example/{owner}")},
            "description": format!("The {name}"),
            "language": "Rust",
            "stargazers_count": 12,
            "forks_count": 3,
            "pushed_at": "2026-10-20T08:00:00Z",
            "topics": ["widgets", name],
        })
    }

    /// A cache on a database of its own, in front of a stub GitHub with the repositories
    /// `acme/r0` to `acme/r11`, `Acme/Widget`, which `acme/gadget` was renamed to, two that
    /// GitHub marks private or internal, and some odd ones. Like GitHub, it ignores the case
    /// of names.
    async fn cache() -> (Arc<Cache>, Arc<Stub>, DatabaseConnection) {
        let stub = Stub::new(|request| {
            let path = request.uri().path().to_ascii_lowercase();
            let mut data = match path.strip_prefix("/repos/acme/").unwrap_or_default() {
                "widget" | "gadget" => repository("Acme", "Widget"),
                "widget/languages" => json!({"Rust": 100}),
                "secret" => json!({"full_name": "acme/secret", "private": true}),
                "inner" => json!({"full_name": "acme/inner", "visibility": "internal"}),
                "bare" => json!({
                    "full_name": "acme/bare",
                    "owner": {"avatar_url": "http://avatars.example/acme"},
                    "description": "",
                    "stargazers_count": "many",
                }),
                "nameless" => json!({"private": false}),
                "odd" => json!({"full_name": "../evil", "private": false}),
                name if name.starts_with('r') => repository("acme", name),
                _ => return answer(404, &[], r#"{"message": "Not Found"}"#),
            };
            if path.ends_with("/r1") {
                data["description"] = json!("The first");
            }
            answer(200, &[], &data.to_string())
        });
        let cluster = cluster();
        let database = cluster.create_database();
        let db = db::connect(&DatabaseConfig {
            url: Secret::new(Url::parse(&cluster.url(&database)).unwrap()),
            max_connections: 5,
        })
        .await
        .unwrap();
        db::migrate(&db, crate::config::GITHUB_COM).await.unwrap();
        let cache = Arc::new(Cache::new(
            db.clone(),
            Arc::new(client(&stub)),
            &CacheConfig {
                ttl: Duration::from_secs(15 * 60),
                retention: Duration::from_secs(30 * 24 * 60 * 60),
            },
            &LimitsConfig {
                org_repositories: 1000,
                visitor_fetches_per_hour: 1000,
            },
        ));
        (cache, stub, db)
    }

    fn visitor() -> Viewer {
        Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ))
    }

    /// Reads what `viewer`'s dashboard of the repository at `segments`, such as
    /// `["repos", "acme", "widget"]`, reads of it there, into their cache.
    async fn view(cache: &Cache, viewer: &Viewer, segments: &[&str]) {
        let path = Path::new(segments.iter().copied()).unwrap();
        let dashboard = format!("/{}/{}", segments[1], segments[2]);
        let read = cache.get(viewer, &dashboard, &path).await;
        assert!(
            matches!(read, Ok(Outcome::Data(_)))
                || segments[2] == "secret"
                || segments[2] == "inner",
            "{segments:?}: {read:?}"
        );
    }

    /// Says that GitHub gave the shared cache's entry for `key` at `at`, so that the tests
    /// tell the order.
    async fn fetched(db: &DatabaseConnection, key: &str, at: DateTimeUtc) {
        cache_entry::Entity::update_many()
            .col_expr(cache_entry::Column::FetchedAt, Expr::value(at))
            .filter(cache_entry::Column::Scope.eq(Scope::Shared.key()))
            .filter(cache_entry::Column::ResourceKey.eq(key))
            .exec(db)
            .await
            .unwrap();
    }

    /// The status and body of a request for the repositories viewed last.
    async fn ask(cache: &Arc<Cache>) -> (StatusCode, Value) {
        answered(list(State(cache.clone())).await).await
    }

    /// The status and body of a request for the repositories the Browse page lists.
    async fn browsed(cache: &Arc<Cache>) -> (StatusCode, Value) {
        answered(browse(State(cache.clone())).await).await
    }

    async fn answered(response: Response) -> (StatusCode, Value) {
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
    }

    /// The names that `body` offers.
    fn named(body: &Value) -> Vec<&str> {
        body["repositories"]
            .as_array()
            .unwrap()
            .iter()
            .map(|repository| repository["name"].as_str().unwrap())
            .collect()
    }

    #[tokio::test]
    async fn without_any_there_are_none() {
        let (cache, _, _) = cache().await;
        assert_eq!(
            ask(&cache).await,
            (StatusCode::OK, json!({"repositories": []}))
        );
    }

    #[tokio::test]
    async fn browse_lists_none_without_any_and_says_how_many_it_may() {
        let (cache, _, _) = cache().await;
        assert_eq!(
            browsed(&cache).await,
            (StatusCode::OK, json!({"cap": 200, "repositories": []}))
        );
    }

    #[tokio::test]
    async fn browse_lists_more_with_their_language_and_topics_and_asks_github_nothing() {
        let (cache, stub, db) = cache().await;
        for n in 0..12 {
            let name = format!("r{n}");
            view(&cache, &visitor(), &["repos", "acme", &name]).await;
            fetched(&db, &format!("/repos/acme/{name}"), at(n)).await;
        }
        // What is beneath a repository is no repository, and one without topics has none.
        view(
            &cache,
            &visitor(),
            &["repos", "acme", "widget", "languages"],
        )
        .await;
        view(&cache, &visitor(), &["repos", "acme", "bare"]).await;
        let read = stub.urls();
        let (status, body) = browsed(&cache).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["cap"], 200);
        let names = named(&body);
        assert_eq!(names.len(), 13);
        assert_eq!(names[..3], ["acme/bare", "acme/r11", "acme/r10"]);
        assert_eq!(body["repositories"][1]["language"], "Rust");
        assert_eq!(body["repositories"][1]["topics"], json!(["widgets", "r11"]));
        assert_eq!(body["repositories"][0]["topics"], json!([]));
        assert_eq!(stub.urls(), read);
    }

    #[tokio::test]
    async fn the_latest_8_are_offered_latest_first_as_github_gave_them() {
        let (cache, stub, db) = cache().await;
        for n in 0..12 {
            let name = format!("r{n}");
            view(&cache, &visitor(), &["repos", "acme", &name]).await;
            // In another order than they were read.
            fetched(&db, &format!("/repos/acme/{name}"), at((n * 5) % 12)).await;
        }
        let read = stub.urls();
        let (status, body) = ask(&cache).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            named(&body),
            [
                "acme/r7", "acme/r2", "acme/r9", "acme/r4", "acme/r11", "acme/r6", "acme/r1",
                "acme/r8"
            ]
        );
        assert_eq!(
            body["repositories"][6],
            json!({
                "name": "acme/r1",
                "owner_avatar_url": "https://avatars.example/acme",
                "description": "The first",
                "language": "Rust",
                "stars": 12,
                "forks": 3,
                "pushed_at": "2026-10-20T08:00:00Z",
                // As the UI is told times.
                "fetched_at": "2026-10-20T12:05:00.000Z",
            })
        );
        // GitHub is never asked.
        assert_eq!(stub.urls(), read);
    }

    #[tokio::test]
    async fn each_repository_is_offered_once_whatever_it_was_asked_for_by() {
        let (cache, _, db) = cache().await;
        for (minutes, name) in [(0, "widget"), (1, "Widget"), (2, "gadget"), (3, "r1")] {
            view(&cache, &visitor(), &["repos", "acme", name]).await;
            fetched(&db, &format!("/repos/acme/{name}"), at(minutes)).await;
        }
        // Nor is what is beneath a repository offered.
        view(
            &cache,
            &visitor(),
            &["repos", "acme", "widget", "languages"],
        )
        .await;
        assert_eq!(named(&ask(&cache).await.1), ["acme/r1", "Acme/Widget"]);
    }

    #[tokio::test]
    async fn only_public_repositories_in_the_shared_cache_are_offered() {
        let (cache, _, db) = cache().await;
        // What a token user reads with their PAT is theirs alone, even what is public.
        let hubot = user::ActiveModel {
            github_id: Set(2),
            login: Set("hubot".to_owned()),
            name: Set(None),
            avatar_url: Set("https://avatars.githubusercontent.com/u/2".to_owned()),
            created_at: Set(at(0)),
            last_sign_in_at: Set(at(0)),
            ..Default::default()
        }
        .insert(&db)
        .await
        .unwrap();
        let pat = credential::ActiveModel {
            user_id: Set(hubot.id),
            kind: Set(credential::Kind::Pat),
            encrypted_value: Set(vec![1, 2, 3]),
            status: Set(Some(credential::PatStatus::Valid)),
            ..Default::default()
        }
        .insert(&db)
        .await
        .unwrap();
        let token_user = Viewer::TokenUser {
            user_id: hubot.id,
            github_id: hubot.github_id,
            credential_id: pat.id,
            pat: Secret::new("ghp_hubot".to_owned()),
            sign_in: Secret::new("gho_hubot".to_owned()),
        };
        for name in ["secret", "inner", "r1"] {
            view(&cache, &token_user, &["repos", "acme", name]).await;
        }
        let private = cache_entry::Entity::find()
            .filter(cache_entry::Column::Scope.eq(Scope::User(hubot.id).key()))
            .count(&db)
            .await
            .unwrap();
        assert_eq!(private, 3);
        assert_eq!(named(&ask(&cache).await.1), Vec::<&str>::new());
        // Nor does Browse list them (FR-SRCH-14).
        assert_eq!(named(&browsed(&cache).await.1), Vec::<&str>::new());

        // Without a PAT, what GitHub marks private or internal is not cached at all, and
        // what is not a repository's is not offered.
        for name in ["secret", "inner", "nameless", "odd", "bare"] {
            view(&cache, &visitor(), &["repos", "acme", name]).await;
        }
        let (status, mut body) = ask(&cache).await;
        let fetched_at = body["repositories"][0]
            .as_object_mut()
            .unwrap()
            .remove("fetched_at")
            .unwrap();
        assert!(fetched_at.as_str().unwrap().ends_with('Z'), "{fetched_at}");
        assert_eq!(
            (status, body),
            (
                StatusCode::OK,
                json!({"repositories": [{
                    "name": "acme/bare",
                    // Only from https URLs.
                    "owner_avatar_url": null,
                    "description": null,
                    "language": null,
                    "stars": 0,
                    "forks": 0,
                    "pushed_at": null,
                }]})
            )
        );
    }

    #[tokio::test]
    async fn what_the_shared_cache_holds_marked_private_is_never_offered() {
        let (cache, _, db) = cache().await;
        view(&cache, &visitor(), &["repos", "acme", "r1"]).await;
        // As a safeguard: such data is never stored there in the first place.
        for (key, data) in [
            (
                "/repos/acme/leak",
                json!({"full_name": "acme/leak", "private": true}),
            ),
            (
                "/repos/acme/inside",
                json!({"full_name": "acme/inside", "visibility": "Internal"}),
            ),
            (
                "/repos/acme/odd",
                json!({"full_name": "acme/odd", "visibility": "secret"}),
            ),
            (
                "/repos/acme/deep",
                json!({"full_name": "acme/deep", "parent": {"private": true}}),
            ),
        ] {
            cache_entry::ActiveModel {
                scope: Set(Scope::Shared.key()),
                resource_key: Set(key.to_owned()),
                data: Set(data),
                fetched_at: Set(at(100_000)),
                expires_at: Set(at(100_000)),
                ..Default::default()
            }
            .insert(&db)
            .await
            .unwrap();
        }
        assert_eq!(named(&ask(&cache).await.1), ["acme/r1"]);
    }
}
