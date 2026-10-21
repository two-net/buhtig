//! Who is viewing, which the UI asks so as to show "Sign in" or the user's avatar menu
//! (UI-02), and the signed-in user's shortcuts on the home page (FR-SRCH-08).
//!
//! Nobody can sign in until sign-in is built (#22), so for now everyone is a visitor, and
//! the shortcuts come with pins and history (#25).

use axum::Json;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// `/-/api/session`: `{"user": null}` for a visitor. For a signed-in user, `{"user":
/// {"login": …, "name": … or null, "avatar_url": …}}`, once there are any (#22).
pub async fn current() -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({ "user": null })),
    )
        .into_response()
}

/// `/-/api/shortcuts`: 401 for a visitor, who has none (FR-ACC-02). For a signed-in user,
/// `{"pins": […], "recent": […]}`, once there are any (#22, #25). Each item is `{"kind":
/// "repository" | "organization", "name": "owner/repo" | "org"}`. Pins are in the user's
/// order, and recent dashboards newest first. The UI picks the shortcuts from them.
pub async fn shortcuts() -> Response {
    status(StatusCode::UNAUTHORIZED)
}

fn status(status: StatusCode) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The status, `Cache-Control` and body of a response.
    async fn parts(response: Response) -> (StatusCode, String, String) {
        let status = response.status();
        let cache = response.headers()[header::CACHE_CONTROL]
            .to_str()
            .unwrap()
            .to_owned();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, cache, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn everyone_is_a_visitor_until_sign_in_is_built() {
        assert_eq!(
            parts(current().await).await,
            (
                StatusCode::OK,
                "no-store".to_owned(),
                r#"{"user":null}"#.to_owned()
            )
        );
    }

    #[tokio::test]
    async fn visitors_have_no_shortcuts() {
        assert_eq!(
            parts(shortcuts().await).await,
            (
                StatusCode::UNAUTHORIZED,
                "no-store".to_owned(),
                String::new()
            )
        );
    }
}
