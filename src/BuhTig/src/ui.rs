//! The web UI: the Angular app in `src/BuhTig.Angular`, served by BuhTig itself, so that
//! a deployment is one application plus PostgreSQL and nothing else (CON-06).
//!
//! Release builds embed the UI's build output, so the binary is all there is to deploy
//! or replace (FR-OPS-03). Debug builds read it from disk as they serve it, so a rebuilt
//! UI shows up without rebuilding BuhTig.

use axum::body::Body;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

#[derive(rust_embed::Embed)]
#[folder = "../BuhTig.Angular/dist/BuhTig/browser"]
// The build output is not committed. Without it, BuhTig serves `NOT_BUILT` instead.
#[allow_missing = true]
pub struct Ui;

/// The app's one page, which takes every route that is not a file.
const INDEX: &str = "index.html";

/// What a build without the UI serves in place of [`INDEX`].
const NOT_BUILT: &str = "<!doctype html>
<html lang=\"en\">
<meta charset=\"utf-8\">
<title>BuhTig</title>
<h1>BuhTig</h1>
<p>This build of BuhTig does not include its web UI. Build the UI with
<code>npm ci &amp;&amp; npm run build</code> in <code>src/BuhTig.Angular</code>, then build
BuhTig.</p>
";

/// A file of the UI, such as `/main-E5OAMLPD.js` or `/favicon.ico`, or `None` if `path`
/// names no file and is therefore a route of the app, such as `/owner/repo`.
///
/// The path is looked up as it is, without percent-decoding: the build names its files in
/// plain ASCII. A path that leads out of the folder names no file.
pub fn asset<A: RustEmbed>(path: &str) -> Option<Response> {
    let name = file_name(path)?;
    let file = A::get(name)?;
    let cache = if is_hashed(name) {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Some(
        (
            [
                (header::CONTENT_TYPE, file.metadata.mimetype().to_owned()),
                (header::CACHE_CONTROL, cache.to_owned()),
            ],
            Body::from(file.data),
        )
            .into_response(),
    )
}

/// Whether `path` names a file of the UI, which [`asset`] serves.
pub fn is_asset<A: RustEmbed>(path: &str) -> bool {
    file_name(path).is_some_and(|name| A::get(name).is_some())
}

/// The name of the file that `path` would name, unless it is a route of the app whatever
/// files there are: the app's page is served for every route, never as a file.
fn file_name(path: &str) -> Option<&str> {
    let name = path.strip_prefix('/').unwrap_or(path);
    (!name.is_empty() && name != INDEX).then_some(name)
}

/// The app's page, whatever the route, with `head`, such as a link preview's tags, at the
/// end of its `<head>`. Browsers check for a new one on every load, so that they pick up
/// the bundles of a new release.
pub fn app<A: RustEmbed>(head: Option<&str>) -> Response {
    let body = match A::get(INDEX) {
        Some(file) => match head.and_then(|head| with_head(&file.data, head)) {
            Some(page) => Body::from(page),
            None => Body::from(file.data),
        },
        None => Body::from(NOT_BUILT),
    };
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        body,
    )
        .into_response()
}

/// `page` with `head` added just before its `</head>`, or `None` if it has none.
fn with_head(page: &[u8], head: &str) -> Option<Vec<u8>> {
    const END: &[u8] = b"</head>";
    let at = page.windows(END.len()).position(|window| window == END)?;
    Some([&page[..at], head.as_bytes(), &page[at..]].concat())
}

/// Whether a file's name carries a hash of its contents, as Angular names its bundles
/// (`main-E5OAMLPD.js`). Such a file never changes, so browsers may keep it for good.
fn is_hashed(name: &str) -> bool {
    let file = name.rsplit('/').next().unwrap_or(name);
    let stem = file.split('.').next().unwrap_or(file);
    stem.rsplit_once('-').is_some_and(|(_, hash)| {
        hash.len() == 8
            && hash
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    #[derive(rust_embed::Embed)]
    #[folder = "tests/fixtures/ui"]
    struct Built;

    #[derive(rust_embed::Embed)]
    #[folder = "tests/fixtures/missing"]
    #[allow_missing = true]
    struct NotBuilt;

    /// The status, `Content-Type`, `Cache-Control` and body of a response.
    async fn parts(response: Response) -> (StatusCode, String, String, String) {
        let header = |name| {
            response
                .headers()
                .get(name)
                .map(|value: &header::HeaderValue| value.to_str().unwrap().to_owned())
                .unwrap_or_default()
        };
        let (status, content_type, cache) = (
            response.status(),
            header(header::CONTENT_TYPE),
            header(header::CACHE_CONTROL),
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            content_type,
            cache,
            String::from_utf8_lossy(&body).into_owned(),
        )
    }

    #[tokio::test]
    async fn files_are_served_with_their_type() {
        let (status, content_type, cache, body) =
            parts(asset::<Built>("/main-ABCDEFGH.js").unwrap()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type, "text/javascript");
        assert_eq!(cache, "public, max-age=31536000, immutable");
        assert_eq!(body, "console.log(\"fixture\");\n");

        let (_, content_type, cache, _) = parts(asset::<Built>("/favicon.ico").unwrap()).await;
        assert_eq!(content_type, "image/x-icon");
        assert_eq!(cache, "no-cache");
    }

    #[test]
    fn other_paths_are_routes_of_the_app() {
        for path in ["/main-ABCDEFGH.js", "/favicon.ico"] {
            assert!(is_asset::<Built>(path), "{path}");
        }
        for path in [
            "/",
            "/index.html",
            "/owner/repo",
            "/vercel/next.js",
            "/my-org",
            "/-/about",
            "/main-ABCDEFGH.js/x",
            "/%6Dain-ABCDEFGH.js",
            // Cargo.toml, outside the folder.
            "/../../../Cargo.toml",
        ] {
            assert!(asset::<Built>(path).is_none(), "{path}");
            assert!(!is_asset::<Built>(path), "{path}");
        }
    }

    #[tokio::test]
    async fn every_route_gets_the_index() {
        let (status, content_type, cache, body) = parts(app::<Built>(None)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type, "text/html; charset=utf-8");
        assert_eq!(cache, "no-cache");
        assert_eq!(
            body,
            "<!doctype html>\n<head><title>Fixture</title></head>\n"
        );
    }

    #[tokio::test]
    async fn what_is_added_to_the_head_ends_it() {
        let (status, _, cache, body) = parts(app::<Built>(Some("<meta name=\"x\">"))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(cache, "no-cache");
        assert_eq!(
            body,
            "<!doctype html>\n<head><title>Fixture</title><meta name=\"x\"></head>\n"
        );
    }

    #[test]
    fn a_page_without_a_head_gets_nothing_added() {
        assert_eq!(with_head(b"<title>x</title>", "<meta>"), None);
    }

    #[tokio::test]
    async fn a_build_without_the_ui_says_how_to_build_it() {
        assert!(asset::<NotBuilt>("/main-ABCDEFGH.js").is_none());
        let (status, content_type, _, body) = parts(app::<NotBuilt>(Some("<meta>"))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type, "text/html; charset=utf-8");
        assert!(body.contains("npm ci &amp;&amp; npm run build"), "{body}");
        assert!(!body.contains("<meta>"), "{body}");
    }

    #[test]
    fn hashed_names_are_recognized() {
        for name in [
            "main-E5OAMLPD.js",
            "styles-5INURTSO.css",
            "chunk-ABCDEFGH.js",
            "media/logo-ABCD1234.svg",
        ] {
            assert!(is_hashed(name), "{name}");
        }
        for name in [
            "favicon.ico",
            "my-logo.svg",
            "main-e5oamlpd.js",
            "main-E5OAMLP.js",
            "main.E5OAMLPD.js",
        ] {
            assert!(!is_hashed(name), "{name}");
        }
    }
}
