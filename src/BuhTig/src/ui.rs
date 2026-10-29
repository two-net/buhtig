//! The web UI: the Angular app in `src/BuhTig.Angular`, served by BuhTig itself, so that
//! a deployment is one application plus PostgreSQL and nothing else (CON-06).
//!
//! Release builds embed the UI's build output, so the binary is all there is to deploy
//! or replace (FR-OPS-03). Debug builds read it from disk as they serve it, so a rebuilt
//! UI shows up without rebuilding BuhTig.
//!
//! The build compresses each of its files as well, as far as it can, into copies beside
//! them, which BuhTig serves in their place to a browser that accepts them, so that the
//! home page comes in its budget (NFR-PERF-02).

use std::borrow::Cow;

use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

use crate::security;

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

/// What the app's page carries in its `<head>` when `ui.animations` is `false`, so that it
/// keeps still for everyone from its first render, as it does for a browser that asks for
/// reduced motion (FR-ANIM-10).
pub const STILL: &str = "<meta name=\"buhtig-animations\" content=\"off\">\n";

/// The compressed copies of a file that the build may write, by the coding each is in,
/// the one that compresses best first: `main-E5OAMLPD.js.br` and `main-E5OAMLPD.js.gz`
/// beside `main-E5OAMLPD.js` (see `scripts/compress.mjs` in the UI).
const COPIES: [(&str, &str); 2] = [("br", ".br"), ("gzip", ".gz")];

/// A file of the UI, such as `/main-E5OAMLPD.js` or `/favicon.ico`, or `None` if `path`
/// names no file and is therefore a route of the app, such as `/owner/repo`.
///
/// A browser that sent `headers` gets the file's compressed copy that it likes best, if it
/// accepts one, and otherwise the file as it is. Either way, the response has the file's
/// type, and says that it depends on `Accept-Encoding`, for caches between.
///
/// The path is looked up as it is, without percent-decoding: the build names its files in
/// plain ASCII. A path that leads out of the folder names no file.
pub fn asset<A: RustEmbed>(path: &str, headers: &HeaderMap) -> Option<Response> {
    let name = file_name(path)?;
    let file = A::get(name)?;
    let cache = if is_hashed(name) {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    let (encoding, data) = match copy::<A>(name, headers) {
        Some((coding, data)) => (Some(HeaderValue::from_static(coding)), data),
        None => (None, file.data),
    };
    let mut response = (
        [
            (header::CONTENT_TYPE, file.metadata.mimetype().to_owned()),
            (header::CACHE_CONTROL, cache.to_owned()),
        ],
        [(header::VARY, HeaderValue::from_static("accept-encoding"))],
        Body::from(data),
    )
        .into_response();
    if let Some(encoding) = encoding {
        response
            .headers_mut()
            .insert(header::CONTENT_ENCODING, encoding);
    }
    Some(response)
}

/// Which of the compressed copies of the file `name` to send a browser that sent `headers`,
/// and the coding it is in: the one in the coding it likes best of those there are copies
/// in, the first of [`COPIES`] if it likes them as well. `None` if it accepts none of them.
fn copy<A: RustEmbed>(
    name: &str,
    headers: &HeaderMap,
) -> Option<(&'static str, Cow<'static, [u8]>)> {
    let mut best: Option<(u16, &'static str, Cow<'static, [u8]>)> = None;
    for (coding, suffix) in COPIES {
        let quality = quality(headers, coding);
        if quality == 0 || best.as_ref().is_some_and(|(best, ..)| *best >= quality) {
            continue;
        }
        if let Some(file) = A::get(&format!("{name}{suffix}")) {
            best = Some((quality, coding, file.data));
        }
    }
    best.map(|(_, coding, data)| (coding, data))
}

/// How much a browser that sent `headers` likes a response in `coding`, in thousandths
/// (RFC 9110 §12.5.3): as it says of `coding`, or else of `*`, or else 0. A part of the
/// header that BuhTig cannot read counts for nothing.
fn quality(headers: &HeaderMap, coding: &str) -> u16 {
    let mut any = 0;
    let elements = headers
        .get_all(header::ACCEPT_ENCODING)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','));
    for element in elements {
        let mut parts = element.split(';');
        let name = parts.next().unwrap_or_default().trim();
        let Some(quality) = weight(parts) else {
            continue;
        };
        if name.eq_ignore_ascii_case(coding) {
            return quality;
        }
        if name == "*" {
            any = quality;
        }
    }
    any
}

/// The weight among the `parameters` of a coding, in thousandths: 1000 if they give none,
/// and `None` if the one they give is not a weight.
fn weight<'a>(parameters: impl Iterator<Item = &'a str>) -> Option<u16> {
    for parameter in parameters {
        let Some((key, value)) = parameter.split_once('=') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("q") {
            let value = value.trim();
            let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
            if fraction.len() > 3 || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
                return None;
            }
            let fraction: u16 = format!("{fraction:0<3}").parse().ok()?;
            return match whole {
                "0" => Some(fraction),
                "1" if fraction == 0 => Some(1000),
                _ => None,
            };
        }
    }
    Some(1000)
}

/// What a dashboard's page adds to its `<head>`, so that the browser fetches the dashboard's
/// code along with the app's, rather than once the app has started and found that it needs
/// it (NFR-PERF-03): the chunk that the build names `dashboard-Ds_EGg7j.js` or the like, and
/// the chunks that it imports, which browsers would only fetch once they have it. `None` if
/// the build has no such chunk.
pub fn dashboard_preload<A: RustEmbed>() -> Option<String> {
    let name = A::iter()
        .find(|name| name.starts_with("dashboard-") && name.ends_with(".js") && is_hashed(name))?;
    let code = A::get(&name)?.data;
    let mut chunks = vec![name.to_string()];
    for import in imports(&String::from_utf8_lossy(&code)) {
        if !chunks.contains(&import) && A::get(&import).is_some() {
            chunks.push(import);
        }
    }
    Some(
        chunks
            .iter()
            .map(|chunk| format!("<link rel=\"modulepreload\" href=\"/{chunk}\">\n"))
            .collect(),
    )
}

/// The chunks that the build's `code` imports at once, as it writes them:
/// `import{a as b}from"./chunk-Ds_EGg7j.js"`, by their names.
fn imports(code: &str) -> Vec<String> {
    code.match_indices("from\"./")
        .filter_map(|(at, from)| {
            let rest = &code[at + from.len()..];
            let name = &rest[..rest.find('"')?];
            (name.ends_with(".js") && is_hashed(name)).then(|| name.to_owned())
        })
        .collect()
}

/// Whether `path` names a file of the UI, which [`asset`] serves.
pub fn is_asset<A: RustEmbed>(path: &str) -> bool {
    file_name(path).is_some_and(|name| A::get(name).is_some())
}

/// The name of the file that `path` would name, unless it is a route of the app whatever
/// files there are: the app's page is served for every route, never as a file, and a
/// compressed copy only in place of its file.
fn file_name(path: &str) -> Option<&str> {
    let name = path.strip_prefix('/').unwrap_or(path);
    let is_copy = COPIES.iter().any(|(_, suffix)| name.ends_with(suffix));
    (!name.is_empty() && name != INDEX && !is_copy).then_some(name)
}

/// The app's page, whatever the route, with `head`, such as a link preview's tags, at the
/// end of its `<head>`. Browsers check for a new one on every load, so that they pick up
/// the bundles of a new release.
///
/// Each one has a nonce of its own, which Angular gives the styles that it adds, and its
/// Content Security Policy lets in those alone (NFR-SEC-06).
pub fn app<A: RustEmbed>(head: Option<&str>) -> Response {
    let (policy, body) = match A::get(INDEX) {
        Some(file) => {
            // Before `head` is added, which can quote GitHub, so that no nonce goes there.
            let (policy, page) = security::with_nonce(&file.data);
            let page = head.and_then(|head| with_head(&page, head)).unwrap_or(page);
            (policy, Body::from(page))
        }
        None => (security::policy(None), Body::from(NOT_BUILT)),
    };
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        [(header::CONTENT_SECURITY_POLICY, policy)],
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

/// Whether a file's name carries a hash of its contents, as Angular names its bundles:
/// eight characters after a hyphen, as in `main-E5OAMLPD.js`, and in base64url for the
/// chunks that load as they are needed, as in `chunk-Ds_EGg7j.js`, whose hash may hold a
/// hyphen too. Such a file never changes, so browsers may keep it for good. A word, such as
/// in `my-settings.js`, is no hash.
fn is_hashed(name: &str) -> bool {
    let file = name.rsplit('/').next().unwrap_or(name);
    let stem = file.split('.').next().unwrap_or(file).as_bytes();
    let Some(split) = stem.len().checked_sub(9) else {
        return false;
    };
    let hash = &stem[split + 1..];
    stem[split] == b'-'
        && hash
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
        && !hash.iter().all(u8::is_ascii_lowercase)
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
        let none = HeaderMap::new();
        let (status, content_type, cache, body) =
            parts(asset::<Built>("/main-ABCDEFGH.js", &none).unwrap()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type, "text/javascript");
        assert_eq!(cache, "public, max-age=31536000, immutable");
        assert_eq!(body, "console.log(\"fixture\");\n");

        let (_, content_type, cache, _) =
            parts(asset::<Built>("/favicon.ico", &none).unwrap()).await;
        assert_eq!(content_type, "image/x-icon");
        assert_eq!(cache, "no-cache");
    }

    #[tokio::test]
    async fn files_are_served_in_the_encoding_the_browser_prefers() {
        const SCRIPT: &str = "/main-ABCDEFGH.js";
        // It has only a gzip copy.
        const STYLES: &str = "/styles-ABCDEFGH.css";
        let cases: [(&str, &[&str], Option<&str>); 15] = [
            (SCRIPT, &[], None),
            // As browsers ask over HTTPS.
            (SCRIPT, &["gzip, deflate, br, zstd"], Some("br")),
            (SCRIPT, &["br;q=0.5, gzip"], Some("gzip")),
            (SCRIPT, &["gzip;q=0.5", "br;q=0.25"], Some("gzip")),
            (SCRIPT, &["br;q=0.5, gzip;q=0.5"], Some("br")),
            (SCRIPT, &["br;q=0, gzip;q=0"], None),
            (SCRIPT, &["*"], Some("br")),
            (SCRIPT, &["gzip;q=0, *"], Some("br")),
            (SCRIPT, &["br;q=0, *;q=0.1"], Some("gzip")),
            (SCRIPT, &["BR"], Some("br")),
            // A weight that is not one counts for nothing.
            (SCRIPT, &["br;q=1.5, gzip"], Some("gzip")),
            (SCRIPT, &["identity"], None),
            (STYLES, &["br"], None),
            (STYLES, &["br, gzip"], Some("gzip")),
            ("/favicon.ico", &["br, gzip"], None),
        ];
        for (path, accepted, coding) in cases {
            let mut headers = HeaderMap::new();
            for value in accepted {
                headers.append(header::ACCEPT_ENCODING, HeaderValue::from_static(value));
            }
            let response = asset::<Built>(path, &headers).unwrap();
            let case = format!("{path} {accepted:?}");
            assert_eq!(response.status(), StatusCode::OK, "{case}");
            assert_eq!(
                response.headers()[header::VARY],
                "accept-encoding",
                "{case}"
            );
            assert_eq!(
                response
                    .headers()
                    .get(header::CONTENT_ENCODING)
                    .map(|coding| coding.to_str().unwrap()),
                coding,
                "{case}"
            );
            let suffix = match coding {
                Some("br") => ".br",
                Some(_) => ".gz",
                None => "",
            };
            let name = format!("{}{suffix}", path.trim_start_matches('/'));
            let expected = Built::get(&name).unwrap().data;
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            assert_eq!(&body[..], &expected[..], "{case}");
        }
        let response = asset::<Built>(STYLES, &HeaderMap::new()).unwrap();
        assert_eq!(response.headers()[header::CONTENT_TYPE], "text/css");
    }

    #[test]
    fn other_paths_are_routes_of_the_app() {
        for path in ["/main-ABCDEFGH.js", "/favicon.ico"] {
            assert!(is_asset::<Built>(path), "{path}");
        }
        let none = HeaderMap::new();
        for path in [
            "/",
            "/index.html",
            "/owner/repo",
            "/vercel/next.js",
            "/my-org",
            "/-/about",
            "/main-ABCDEFGH.js/x",
            "/%6Dain-ABCDEFGH.js",
            // Compressed copies are served only in place of their files.
            "/main-ABCDEFGH.js.br",
            "/main-ABCDEFGH.js.gz",
            "/index.html.gz",
            // Cargo.toml, outside the folder.
            "/../../../Cargo.toml",
        ] {
            assert!(asset::<Built>(path, &none).is_none(), "{path}");
            assert!(!is_asset::<Built>(path), "{path}");
        }
    }

    /// The nonce of a page, as its policy names it.
    fn nonce(response: &Response) -> String {
        security::nonce(&response.headers()[header::CONTENT_SECURITY_POLICY]).to_owned()
    }

    #[tokio::test]
    async fn every_route_gets_the_index_with_a_nonce_of_its_own() {
        let response = app::<Built>(None);
        let nonce = nonce(&response);
        assert_eq!(
            response.headers()[header::CONTENT_SECURITY_POLICY],
            security::policy(Some(&nonce))
        );
        let (status, content_type, cache, body) = parts(response).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type, "text/html; charset=utf-8");
        assert_eq!(cache, "no-cache");
        assert_eq!(
            body,
            format!(
                "<!doctype html>\n<head><title>Fixture</title></head>\n\
                 <app-root ngCspNonce=\"{nonce}\"></app-root>\n"
            )
        );
        assert_ne!(self::nonce(&app::<Built>(None)), nonce);
    }

    #[tokio::test]
    async fn what_is_added_to_the_head_ends_it_as_it_is() {
        // As a link preview could, quoting GitHub.
        let head = format!("<meta name=\"x\" content=\"{}\">", security::NONCE);
        let response = app::<Built>(Some(&head));
        let nonce = nonce(&response);
        let (status, _, cache, body) = parts(response).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(cache, "no-cache");
        assert_eq!(
            body,
            format!(
                "<!doctype html>\n<head><title>Fixture</title>{head}</head>\n\
                 <app-root ngCspNonce=\"{nonce}\"></app-root>\n"
            )
        );
    }

    #[test]
    fn a_page_without_a_head_gets_nothing_added() {
        assert_eq!(with_head(b"<title>x</title>", "<meta>"), None);
    }

    #[test]
    fn dashboards_preload_their_code_and_what_it_imports() {
        assert_eq!(
            dashboard_preload::<Built>().as_deref(),
            Some(
                "<link rel=\"modulepreload\" href=\"/dashboard-Ds_EGg7j.js\">\n\
                 <link rel=\"modulepreload\" href=\"/chunk-Dkfirl0_.js\">\n\
                 <link rel=\"modulepreload\" href=\"/main-ABCDEFGH.js\">\n"
            )
        );
        assert_eq!(dashboard_preload::<NotBuilt>(), None);
    }

    #[tokio::test]
    async fn a_build_without_the_ui_says_how_to_build_it() {
        assert!(asset::<NotBuilt>("/main-ABCDEFGH.js", &HeaderMap::new()).is_none());
        let response = app::<NotBuilt>(Some("<meta>"));
        assert_eq!(
            response.headers()[header::CONTENT_SECURITY_POLICY],
            security::policy(None)
        );
        let (status, content_type, _, body) = parts(response).await;
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
            // As the chunks that load as they are needed are named.
            "chunk-DsnEGg7j.js",
            "chunk-Ds_EGg7j.js",
            "chunk-Ds-EGg7j.js",
            "chunk--snEGg7j.js",
            "main-e5oamlpd.js",
        ] {
            assert!(is_hashed(name), "{name}");
        }
        for name in [
            "favicon.ico",
            "my-logo.svg",
            "my-settings.js",
            "main-E5OAMLP.js",
            "main.E5OAMLPD.js",
            "mainE5OAMLPD.js",
            "main-E5OAMLP!.js",
        ] {
            assert!(!is_hashed(name), "{name}");
        }
    }
}
