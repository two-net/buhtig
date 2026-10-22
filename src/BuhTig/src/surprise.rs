//! "Surprise me" on the home page, which opens the dashboard of a random public
//! repository from the shared cache, and is hidden while it holds none (FR-SRCH-10).

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;
use tracing::error;

use crate::cache::Cache;

/// `/-/api/surprise`: `{"name": "owner/repo"}`, a different pick each time, or 404 while
/// the shared cache holds no repository.
pub async fn pick(State(cache): State<Arc<Cache>>) -> Response {
    match cache.random_repository().await {
        Ok(Some(name)) => (
            [(header::CACHE_CONTROL, "no-store")],
            Json(json!({ "name": name })),
        )
            .into_response(),
        Ok(None) => status(StatusCode::NOT_FOUND),
        Err(error) => {
            error!("cannot pick a repository to surprise with: {error}");
            status(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
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
    use crate::cache::{Outcome, Viewer};
    use crate::config::{CacheConfig, DatabaseConfig, LimitsConfig, Secret};
    use crate::db;
    use crate::github::Path;
    use crate::github::stub::{Stub, answer, client};
    use crate::test_cluster::cluster;
    use crate::visitors::Visitor;

    /// A cache on a database of its own, in front of a stub GitHub with one repository.
    async fn cache() -> Arc<Cache> {
        let stub = Stub::new(|request| match request.uri().path() {
            "/repos/owner/repo" => {
                answer(200, &[], r#"{"full_name": "owner/repo", "private": false}"#)
            }
            _ => answer(404, &[], r#"{"message": "Not Found"}"#),
        });
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
            Arc::new(client(&stub)),
            &CacheConfig {
                ttl: Duration::from_secs(15 * 60),
                retention: Duration::from_secs(30 * 24 * 60 * 60),
            },
            &LimitsConfig {
                org_repositories: 1000,
                visitor_fetches_per_hour: 30,
            },
        ))
    }

    /// The status and body of a request for a surprise.
    async fn ask(cache: &Arc<Cache>) -> (StatusCode, String) {
        let response = pick(State(cache.clone())).await;
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn a_repository_someone_viewed_is_a_surprise() {
        let cache = cache().await;
        assert_eq!(ask(&cache).await, (StatusCode::NOT_FOUND, String::new()));

        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let path = Path::new(["repos", "owner", "repo"]).unwrap();
        let read = cache.get(&visitor, "/owner/repo", &path).await;
        assert!(matches!(read, Ok(Outcome::Data(_))), "{read:?}");
        assert_eq!(
            ask(&cache).await,
            (StatusCode::OK, r#"{"name":"owner/repo"}"#.to_owned())
        );
    }
}
