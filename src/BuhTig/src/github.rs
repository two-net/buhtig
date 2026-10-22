//! BuhTig's client for GitHub's REST API (IF-01, SRS §4.9).
//!
//! Only the server calls GitHub, so credentials never reach a browser (FR-DATA-01). The
//! client sends nothing but GET requests, so BuhTig cannot change anything on GitHub
//! (CON-08), and it sends them only to `https://api.github.com` (CON-09, IF-05): callers
//! name a [`Path`] rather than a URL, and the client follows a redirect or a next-page
//! link only if it stays there. So a credential never goes anywhere else.
//!
//! It uses REST rather than GraphQL because visitors' requests carry BuhTig's OAuth app
//! credentials (FR-DATA-02), which GitHub accepts for public data on REST only.
//!
//! Requests go out through a [`Transport`]. BuhTig's own is [`https::Https`]; tests put
//! [`stub::Stub`] in its place, so that they never depend on GitHub (NFR-MNT-03) while
//! every rule here still applies.
//!
//! GitHub failing never fails BuhTig (NFR-REL-01): every answer, however odd, becomes a
//! [`Reply`] or an [`Error`] for the caller to degrade with (FR-DATA-05).

mod https;

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::hash::{BuildHasher, RandomState};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Instant;

use axum::body::Bytes;
use axum::http::header::{
    ACCEPT, AUTHORIZATION, ETAG, IF_NONE_MATCH, LINK, LOCATION, RETRY_AFTER, USER_AGENT,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, Response, StatusCode};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
use sea_orm::sea_query::prelude::chrono::{DateTime, TimeDelta};
use serde_json::Value;
use tracing::{debug, error, warn};
use url::Url;

use crate::config::{GithubConfig, Secret};

const API: &str = "https://api.github.com";
const API_HOST: &str = "api.github.com";

/// The REST API version BuhTig is written against.
const API_VERSION: &str = "2022-11-28";

const AGENT: &str = concat!("BuhTig/", env!("CARGO_PKG_VERSION"));

/// The most items GitHub returns per page.
const PER_PAGE: usize = 100;

/// How many redirects one request may follow, as for a repository that was renamed and
/// then transferred.
const MAX_REDIRECTS: usize = 5;

/// How long to wait after a secondary rate limit that does not say, as GitHub asks.
const SECONDARY_WAIT: TimeDelta = TimeDelta::seconds(60);

/// A path on api.github.com, such as `/repos/{owner}/{repo}`, with its query.
///
/// Each segment is percent-encoded on its own, so a name from a visitor stays one
/// segment, whatever it contains.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Path(Url);

impl Path {
    /// The path of these segments. An empty, `.` or `..` segment is [`Error::NotFound`],
    /// since no GitHub resource is named so.
    pub fn new<'a>(segments: impl IntoIterator<Item = &'a str>) -> Result<Path, Error> {
        let mut url = Url::parse(API).expect("API is a URL");
        {
            let mut path = url.path_segments_mut().expect("an https URL has a path");
            path.clear();
            for segment in segments {
                if matches!(segment, "" | "." | "..") {
                    return Err(Error::NotFound);
                }
                path.push(segment);
            }
        }
        Ok(Path(url))
    }

    /// Adds `key=value` to the query.
    pub fn query(mut self, key: &str, value: &str) -> Path {
        self.0.query_pairs_mut().append_pair(key, value);
        self
    }
}

impl fmt::Display for Path {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0[url::Position::BeforePath..])
    }
}

/// Whose access a request uses (FR-DATA-02).
#[derive(Clone, Debug)]
pub enum Credential {
    /// A visitor's, who has none: the request carries BuhTig's OAuth app credentials,
    /// which GitHub accepts for public data at a higher rate limit than none.
    Visitor,
    /// A signed-in user's: their PAT while they have a valid one, and their sign-in
    /// credential otherwise (FR-PAT-06). The caller picks which.
    Token(Secret<String>),
}

/// What GitHub had for a request.
#[derive(Debug, PartialEq)]
pub enum Reply<T> {
    Fresh {
        data: T,
        /// GitHub's validator, for a conditional request next time (FR-DATA-09).
        etag: Option<String>,
        /// Whether GitHub redirected the request, as it does for a repository that was
        /// renamed or transferred. The canonical name is then in `data` (FR-NAV-05).
        redirected: bool,
    },
    /// Unchanged since the validator the request carried (FR-DATA-09).
    NotModified,
    /// GitHub is still computing this statistic; ask again later (FR-REPO-10).
    Computing,
}

impl<T> Reply<T> {
    /// The same reply, with `f` applied to its data.
    pub fn map<U>(self, f: impl FnOnce(T) -> U) -> Reply<U> {
        match self {
            Reply::Fresh {
                data,
                etag,
                redirected,
            } => Reply::Fresh {
                data: f(data),
                etag,
                redirected,
            },
            Reply::NotModified => Reply::NotModified,
            Reply::Computing => Reply::Computing,
        }
    }
}

/// The items of a paginated list.
#[derive(Debug, PartialEq)]
pub struct List {
    pub items: Vec<Value>,
    /// Whether the list goes on past the limit, so that the dashboard can say that its
    /// figures cover only part of it (FR-ORG-08).
    pub truncated: bool,
}

/// One reading of a rate limit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RateLimit {
    pub limit: u32,
    pub remaining: u32,
    pub reset: DateTimeUtc,
}

/// Why GitHub had no data for a request. No message contains a credential, and
/// `message` is GitHub's own text, which is untrusted and therefore quoted.
#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    /// 404, 410 or 451. GitHub gives the same answer for what does not exist and for
    /// what is private to others (FR-ACC-05).
    NotFound,
    /// An organization requires the token to be authorized for its single sign-on
    /// (FR-PAT-08). `url` is where, for an hour after GitHub gave it.
    SsoRequired { url: Option<String> },
    /// 401: GitHub rejected the token, for example because it was revoked or has
    /// expired (FR-PAT-07, FR-AUTH-09).
    BadCredentials,
    /// A 403 that is not a rate limit, such as an organization that has not approved a
    /// fine-grained token (FR-PAT-08).
    Forbidden { message: Option<String> },
    /// GitHub takes no more requests with this credential until `until` (FR-DATA-05).
    RateLimited { until: DateTimeUtc },
    /// Any other status, such as 409 for the commits of an empty repository
    /// (FR-REPO-11), or a server error.
    Status {
        status: u16,
        message: Option<String>,
    },
    /// GitHub, or the proxy to it, could not be reached or did not answer in time.
    Unreachable(String),
    /// An answer BuhTig cannot use, such as one that is not JSON or that redirects away
    /// from api.github.com.
    Invalid(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::NotFound => f.write_str("not found on GitHub, or private"),
            Error::SsoRequired { .. } => f.write_str(
                "an organization requires the token to be authorized for its single sign-on",
            ),
            Error::BadCredentials => f.write_str("GitHub rejected the token"),
            Error::Forbidden { message } => {
                f.write_str("GitHub refused access")?;
                quote(f, message)
            }
            Error::RateLimited { until } => write!(f, "GitHub's rate limit holds until {until}"),
            Error::Status { status, message } => {
                write!(f, "GitHub answered {status}")?;
                quote(f, message)
            }
            Error::Unreachable(error) => write!(f, "cannot reach GitHub: {error}"),
            Error::Invalid(problem) => write!(f, "unusable answer from GitHub: {problem}"),
        }
    }
}

fn quote(f: &mut fmt::Formatter<'_>, message: &Option<String>) -> fmt::Result {
    match message {
        Some(message) => write!(f, ": {message:?}"),
        None => Ok(()),
    }
}

impl std::error::Error for Error {}

/// What a [`Transport`] returns while it sends a request.
pub type Sending<'a> = Pin<Box<dyn Future<Output = Result<Response<Bytes>, Error>> + Send + 'a>>;

/// Sends one request to GitHub and returns the answer as it is: it neither follows
/// redirects nor makes anything of the status. Its errors are [`Error::Unreachable`] or
/// [`Error::Invalid`].
pub trait Transport: Send + Sync {
    fn send(&self, request: Request<()>) -> Sending<'_>;
}

pub struct Client {
    transport: Arc<dyn Transport>,
    /// `Basic` with the OAuth app's client ID and secret, for visitors' requests.
    app: HeaderValue,
    /// Set once GitHub rejects the app credentials. Visitors' requests then go without
    /// them until BuhTig restarts, which a fix to the config file needs anyway.
    app_rejected: AtomicBool,
    /// Rate limits are held in memory alone (NFR-REL-02).
    limits: Mutex<HashMap<Key, Account>>,
    /// Hashes tokens into [`Key`]s, so that the rate limits keep no token.
    hasher: RandomState,
}

/// Whose rate limit: visitors', which they all share, or one token's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Key {
    Visitor,
    Token(u64),
}

/// What is known about one credential's rate limits.
#[derive(Debug, Default)]
struct Account {
    /// The latest reading of each bucket that GitHub counts separately, such as `core`
    /// and `search`.
    buckets: HashMap<String, RateLimit>,
    /// Until when no request may be made with the credential at all, after a secondary
    /// rate limit, which spans every bucket.
    paused_until: Option<DateTimeUtc>,
}

impl Account {
    /// Whether anything recorded still holds.
    fn holds(&self, now: DateTimeUtc) -> bool {
        self.paused_until.is_some_and(|until| until > now)
            || self.buckets.values().any(|limit| limit.reset > now)
    }
}

/// An answer that the caller gets data, or its absence, from: 200, 202, 204 or 304.
struct Answer {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
    redirected: bool,
}

impl Answer {
    fn etag(&self) -> Option<String> {
        header(&self.headers, ETAG).map(str::to_owned)
    }

    /// The body as JSON. No content, as for the statistics of an empty repository, is
    /// `null`.
    fn json(&self) -> Result<Value, Error> {
        if self.status == StatusCode::NO_CONTENT || self.body.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&self.body)
            .map_err(|_| Error::Invalid("the body is not JSON".to_owned()))
    }

    fn items(&self) -> Result<Vec<Value>, Error> {
        match self.json()? {
            Value::Null => Ok(Vec::new()),
            Value::Array(items) => Ok(items),
            _ => Err(Error::Invalid("the body is not a list".to_owned())),
        }
    }
}

impl Client {
    /// The client BuhTig uses: HTTPS to GitHub, through `github.proxy_url` if it is set.
    pub fn new(config: &GithubConfig) -> Result<Client, String> {
        let transport = https::Https::new(config.proxy_url.as_ref())?;
        Ok(Client::with_transport(
            Arc::new(transport),
            &config.client_id,
            &config.client_secret,
        ))
    }

    pub fn with_transport(
        transport: Arc<dyn Transport>,
        client_id: &str,
        client_secret: &Secret<String>,
    ) -> Client {
        let credentials = BASE64.encode(format!("{client_id}:{}", client_secret.expose()));
        let mut app = HeaderValue::try_from(format!("Basic {credentials}"))
            .expect("base64 is a valid header value");
        app.set_sensitive(true);
        Client {
            transport,
            app,
            app_rejected: AtomicBool::new(false),
            limits: Mutex::new(HashMap::new()),
            hasher: RandomState::new(),
        }
    }

    /// Reads one resource, conditionally on `etag` if there is one.
    pub async fn get(
        &self,
        credential: &Credential,
        path: &Path,
        etag: Option<&str>,
    ) -> Result<Reply<Value>, Error> {
        let answer = self.fetch(credential, path.0.clone(), etag).await?;
        Ok(match answer.status {
            StatusCode::NOT_MODIFIED => Reply::NotModified,
            StatusCode::ACCEPTED => Reply::Computing,
            _ => Reply::Fresh {
                data: answer.json()?,
                etag: answer.etag(),
                redirected: answer.redirected,
            },
        })
    }

    /// Reads up to `limit` items of a list that GitHub answers in pages of JSON arrays,
    /// following each page's `next` link.
    ///
    /// GitHub's validators cover one page, so only the first page is asked for
    /// conditionally on `etag`. The reply has a validator only when the first page alone
    /// decided it: `limit` was reached on it, or it was the whole list. A list longer
    /// than one page, such as a large organization's repositories, is read in full each
    /// time.
    pub async fn get_list(
        &self,
        credential: &Credential,
        path: &Path,
        limit: usize,
        etag: Option<&str>,
    ) -> Result<Reply<List>, Error> {
        let per_page = limit.clamp(1, PER_PAGE);
        let mut url = path.0.clone();
        let query: Vec<(String, String)> = url
            .query_pairs()
            .filter(|(key, _)| key != "per_page")
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        url.query_pairs_mut()
            .clear()
            .extend_pairs(query)
            .append_pair("per_page", &per_page.to_string());

        let first = self.fetch(credential, url, etag).await?;
        match first.status {
            StatusCode::NOT_MODIFIED => return Ok(Reply::NotModified),
            StatusCode::ACCEPTED => return Ok(Reply::Computing),
            _ => {}
        }
        let mut items = first.items()?;
        let mut next = next_link(&first.headers);
        let mut redirected = first.redirected;
        let decided = items.len() >= limit || (next.is_none() && items.len() < per_page);
        let etag = first.etag().filter(|_| decided);

        while items.len() < limit {
            let Some(link) = next.take() else { break };
            let page = self.fetch(credential, on_api(&link)?, None).await?;
            if page.status == StatusCode::ACCEPTED {
                return Ok(Reply::Computing);
            }
            let page_items = page.items()?;
            next = next_link(&page.headers);
            redirected |= page.redirected;
            // A page with nothing on it would let a `next` link lead on forever.
            if page_items.is_empty() {
                break;
            }
            items.extend(page_items);
        }

        let truncated = items.len() > limit || next.is_some();
        items.truncate(limit);
        Ok(Reply::Fresh {
            data: List { items, truncated },
            etag,
            redirected,
        })
    }

    /// The latest reading of the rate limit that visitors' requests share, which GitHub
    /// counts per OAuth app (FR-DATA-11). `None` until a request has been made, and once
    /// that reading has reset: the full limit is then available.
    pub fn visitor_rate_limit(&self) -> Option<RateLimit> {
        let now = ChronoUtc::now();
        self.limits()
            .get(&Key::Visitor)?
            .buckets
            .get("core")
            .copied()
            .filter(|limit| limit.reset > now)
    }

    /// Sends a GET to `url` and follows its redirects. Every answer that carries no data
    /// is an error.
    async fn fetch(
        &self,
        credential: &Credential,
        mut url: Url,
        etag: Option<&str>,
    ) -> Result<Answer, Error> {
        let key = self.key(credential);
        self.check(key, bucket(&url))?;
        let mut redirected = false;
        for _ in 0..=MAX_REDIRECTS {
            let (parts, body) = self.send(credential, &url, etag).await?.into_parts();
            let now = ChronoUtc::now();
            self.record(key, &url, &parts.headers, now);
            match parts.status {
                StatusCode::OK
                | StatusCode::ACCEPTED
                | StatusCode::NO_CONTENT
                | StatusCode::NOT_MODIFIED => {
                    return Ok(Answer {
                        status: parts.status,
                        headers: parts.headers,
                        body,
                        redirected,
                    });
                }
                StatusCode::MOVED_PERMANENTLY
                | StatusCode::FOUND
                | StatusCode::SEE_OTHER
                | StatusCode::TEMPORARY_REDIRECT
                | StatusCode::PERMANENT_REDIRECT => {
                    let location = header(&parts.headers, LOCATION).ok_or_else(|| {
                        Error::Invalid("a redirect without a location".to_owned())
                    })?;
                    let target = url
                        .join(location)
                        .map_err(|_| Error::Invalid("a redirect to no URL".to_owned()))?;
                    url = on_api(target.as_str())?;
                    redirected = true;
                }
                status => return Err(self.failure(key, status, &parts.headers, &body, now)),
            }
        }
        Err(Error::Invalid(format!(
            "more than {MAX_REDIRECTS} redirects"
        )))
    }

    /// Sends one GET. A visitor's carries the app credentials until GitHub rejects them,
    /// and is then sent again without them (FR-DATA-02), so that visitors still get
    /// public data. GitHub ignores a client ID it does not know, treating the request as
    /// anonymous, so a rejection takes credentials it does know.
    async fn send(
        &self,
        credential: &Credential,
        url: &Url,
        etag: Option<&str>,
    ) -> Result<Response<Bytes>, Error> {
        let with_app =
            matches!(credential, Credential::Visitor) && !self.app_rejected.load(Ordering::Relaxed);
        let response = self.send_once(credential, url, etag, with_app).await?;
        if with_app && response.status() == StatusCode::UNAUTHORIZED {
            if !self.app_rejected.swap(true, Ordering::Relaxed) {
                error!(
                    "GitHub rejected the OAuth app's client ID and secret (github.client_id, \
                     github.client_secret); until BuhTig restarts, visitors' requests go \
                     without them, at GitHub's lower rate limit for anonymous requests"
                );
            }
            return self.send_once(credential, url, etag, false).await;
        }
        Ok(response)
    }

    async fn send_once(
        &self,
        credential: &Credential,
        url: &Url,
        etag: Option<&str>,
        with_app: bool,
    ) -> Result<Response<Bytes>, Error> {
        let request = self.request(credential, url, etag, with_app)?;
        let start = Instant::now();
        let result = self.transport.send(request).await;
        match &result {
            Ok(response) => debug!(
                path = url.path(),
                status = response.status().as_u16(),
                remaining = header(response.headers(), "x-ratelimit-remaining"),
                duration = ?start.elapsed(),
                "GitHub answered"
            ),
            Err(error) => debug!(path = url.path(), duration = ?start.elapsed(), "{error}"),
        }
        result
    }

    /// A GET, which is all [`Request::new`] makes, to `url` with `credential`.
    fn request(
        &self,
        credential: &Credential,
        url: &Url,
        etag: Option<&str>,
        with_app: bool,
    ) -> Result<Request<()>, Error> {
        let mut request = Request::new(());
        *request.uri_mut() = url
            .as_str()
            .parse()
            .map_err(|_| Error::Invalid("a URL that HTTP cannot carry".to_owned()))?;
        let headers = request.headers_mut();
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/vnd.github+json"),
        );
        headers.insert(
            HeaderName::from_static("x-github-api-version"),
            HeaderValue::from_static(API_VERSION),
        );
        headers.insert(USER_AGENT, HeaderValue::from_static(AGENT));
        match credential {
            Credential::Visitor if with_app => {
                headers.insert(AUTHORIZATION, self.app.clone());
            }
            Credential::Visitor => {}
            Credential::Token(token) => {
                // A token that cannot be sent is not one GitHub could have issued.
                let mut bearer = HeaderValue::try_from(format!("Bearer {}", token.expose()))
                    .map_err(|_| Error::BadCredentials)?;
                bearer.set_sensitive(true);
                headers.insert(AUTHORIZATION, bearer);
            }
        }
        // An unusable validator only costs the saving it would have brought.
        if let Some(etag) = etag.and_then(|etag| HeaderValue::from_str(etag).ok()) {
            headers.insert(IF_NONE_MATCH, etag);
        }
        Ok(request)
    }

    fn key(&self, credential: &Credential) -> Key {
        match credential {
            Credential::Visitor => Key::Visitor,
            Credential::Token(token) => Key::Token(self.hasher.hash_one(token.expose())),
        }
    }

    /// Refuses a request that GitHub's rate limit would refuse, without sending it: GitHub
    /// may ban clients that go on calling while limited.
    fn check(&self, key: Key, bucket: &str) -> Result<(), Error> {
        let now = ChronoUtc::now();
        let limits = self.limits();
        let Some(account) = limits.get(&key) else {
            return Ok(());
        };
        if let Some(until) = account.paused_until.filter(|until| *until > now) {
            return Err(Error::RateLimited { until });
        }
        match account.buckets.get(bucket) {
            Some(limit) if limit.remaining == 0 && limit.reset > now => {
                Err(Error::RateLimited { until: limit.reset })
            }
            _ => Ok(()),
        }
    }

    /// Records the rate-limit reading that an answer carries, in the bucket it names.
    fn record(&self, key: Key, url: &Url, headers: &HeaderMap, now: DateTimeUtc) {
        let Some(reading) = rate_limit(headers) else {
            return;
        };
        let name = header(headers, "x-ratelimit-resource").unwrap_or(bucket(url));
        let mut limits = self.limits();
        let buckets = &mut account(&mut limits, key, now).buckets;
        match buckets.get_mut(name) {
            // Answers can arrive out of order. Of two readings in the same window, the one
            // with less remaining is the later one.
            Some(known) if known.reset == reading.reset => {
                known.limit = reading.limit;
                known.remaining = known.remaining.min(reading.remaining);
            }
            Some(known) if known.reset > reading.reset => {}
            _ => {
                buckets.insert(name.to_owned(), reading);
            }
        }
    }

    /// The error for an answer that carries no data.
    fn failure(
        &self,
        key: Key,
        status: StatusCode,
        headers: &HeaderMap,
        body: &[u8],
        now: DateTimeUtc,
    ) -> Error {
        let message = message(body);
        let limited = status == StatusCode::TOO_MANY_REQUESTS
            || (status == StatusCode::FORBIDDEN && is_rate_limit(headers, message.as_deref()));
        if limited {
            return Error::RateLimited {
                until: self.limited(key, headers, now),
            };
        }
        if matches!(status, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND)
            && let Some(sso) = header(headers, "x-github-sso")
            && sso.starts_with("required")
        {
            let url = sso
                .split(';')
                .find_map(|part| part.trim().strip_prefix("url="))
                .map(str::to_owned);
            return Error::SsoRequired { url };
        }
        match status {
            StatusCode::UNAUTHORIZED => Error::BadCredentials,
            StatusCode::FORBIDDEN => Error::Forbidden { message },
            StatusCode::NOT_FOUND
            | StatusCode::GONE
            | StatusCode::UNAVAILABLE_FOR_LEGAL_REASONS => Error::NotFound,
            _ => Error::Status {
                status: status.as_u16(),
                message,
            },
        }
    }

    /// Until when a rate-limited credential must wait, as GitHub says: for `retry-after`
    /// seconds, else until the reset of a bucket with nothing remaining, else a minute.
    fn limited(&self, key: Key, headers: &HeaderMap, now: DateTimeUtc) -> DateTimeUtc {
        let retry_after = header(headers, RETRY_AFTER)
            .and_then(|seconds| seconds.trim().parse::<u32>().ok())
            .map(|seconds| now + TimeDelta::seconds(i64::from(seconds)));
        let reset = rate_limit(headers)
            .filter(|limit| limit.remaining == 0)
            .map(|limit| limit.reset);
        let until = match (retry_after, reset) {
            (Some(until), _) => until,
            // `record` has noted that the bucket has nothing left, which holds it back.
            (None, Some(reset)) => reset,
            (None, None) => now + SECONDARY_WAIT,
        };
        if retry_after.is_some() || reset.is_none() {
            // A secondary limit, which spans every bucket.
            let mut limits = self.limits();
            let paused = &mut account(&mut limits, key, now).paused_until;
            *paused = Some(paused.map_or(until, |paused| paused.max(until)));
        }
        if key == Key::Visitor {
            warn!(
                %until,
                "GitHub's rate limit for visitors' requests is reached; until it lifts, \
                 visitors see cached data or an error"
            );
        }
        until
    }

    /// The rate limits, even if a thread panicked while it held them: every change to
    /// them leaves them consistent.
    fn limits(&self) -> MutexGuard<'_, HashMap<Key, Account>> {
        self.limits.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// `key`'s account, which is added if need be. Adding one first drops the accounts that
/// no longer hold anything, so that only current limits stay in memory.
fn account(limits: &mut HashMap<Key, Account>, key: Key, now: DateTimeUtc) -> &mut Account {
    if !limits.contains_key(&key) {
        limits.retain(|_, account| account.holds(now));
    }
    limits.entry(key).or_default()
}

/// The bucket GitHub counts a request in, before an answer says.
fn bucket(url: &Url) -> &'static str {
    match url.path() {
        "/search/code" => "code_search",
        path if path.starts_with("/search/") => "search",
        _ => "core",
    }
}

/// The rate-limit reading in an answer's headers, if it has a whole one.
fn rate_limit(headers: &HeaderMap) -> Option<RateLimit> {
    let text = |name: &'static str| header(headers, name).map(str::trim);
    Some(RateLimit {
        limit: text("x-ratelimit-limit")?.parse().ok()?,
        remaining: text("x-ratelimit-remaining")?.parse().ok()?,
        reset: DateTime::from_timestamp(text("x-ratelimit-reset")?.parse().ok()?, 0)?,
    })
}

/// Whether a 403 is a rate limit: a primary one leaves nothing remaining, and a secondary
/// one says how long to wait or that it is one.
fn is_rate_limit(headers: &HeaderMap, message: Option<&str>) -> bool {
    header(headers, "x-ratelimit-remaining").is_some_and(|remaining| remaining.trim() == "0")
        || headers.contains_key(RETRY_AFTER)
        || message.is_some_and(|message| message.to_ascii_lowercase().contains("rate limit"))
}

/// The `message` of a JSON error body.
fn message(body: &[u8]) -> Option<String> {
    let body: Value = serde_json::from_slice(body).ok()?;
    body.get("message")?.as_str().map(str::to_owned)
}

/// The `rel="next"` URL of a `Link` header such as
/// `<https://api.github.com/…&page=2>; rel="next", <https://api.github.com/…&page=5>; rel="last"`.
fn next_link(headers: &HeaderMap) -> Option<String> {
    for value in headers.get_all(LINK) {
        let Ok(mut rest) = value.to_str() else {
            continue;
        };
        while let Some(start) = rest.find('<') {
            let Some(end) = rest[start..].find('>').map(|end| start + end) else {
                break;
            };
            let target = &rest[start + 1..end];
            rest = &rest[end + 1..];
            let params = &rest[..rest.find('<').unwrap_or(rest.len())];
            let is_next = params.split([';', ',']).any(|param| {
                param.trim().strip_prefix("rel=").is_some_and(|rel| {
                    rel.trim_matches('"')
                        .split_whitespace()
                        .any(|rel| rel.eq_ignore_ascii_case("next"))
                })
            });
            if is_next {
                return Some(target.to_owned());
            }
        }
    }
    None
}

/// `url`, if it is on api.github.com over HTTPS, the only place a credential may go.
fn on_api(url: &str) -> Result<Url, Error> {
    Url::parse(url)
        .ok()
        .filter(|url| {
            url.scheme() == "https"
                && url.host_str() == Some(API_HOST)
                && url.port_or_known_default() == Some(443)
                && url.username().is_empty()
                && url.password().is_none()
        })
        .ok_or_else(|| Error::Invalid("a link away from api.github.com".to_owned()))
}

fn header(headers: &HeaderMap, name: impl axum::http::header::AsHeaderName) -> Option<&str> {
    headers.get(name)?.to_str().ok()
}

/// A stand-in for GitHub, for tests (NFR-MNT-03).
#[cfg(test)]
pub mod stub {
    use super::*;

    /// How the stub answers a request.
    type Responder = dyn Fn(&Request<()>) -> Result<Response<Bytes>, Error> + Send + Sync;

    /// Answers each request from a function of it, and keeps every request it gets. It
    /// fails the test if a request is not a GET.
    pub struct Stub {
        answer: Box<Responder>,
        requests: Mutex<Vec<(String, HeaderMap)>>,
    }

    impl Stub {
        pub fn new(
            answer: impl Fn(&Request<()>) -> Result<Response<Bytes>, Error> + Send + Sync + 'static,
        ) -> Arc<Stub> {
            Arc::new(Stub {
                answer: Box::new(answer),
                requests: Mutex::new(Vec::new()),
            })
        }

        /// The URL and headers of every request so far.
        pub fn requests(&self) -> Vec<(String, HeaderMap)> {
            self.requests.lock().unwrap().clone()
        }

        pub fn urls(&self) -> Vec<String> {
            self.requests().into_iter().map(|(url, _)| url).collect()
        }
    }

    impl Transport for Stub {
        fn send(&self, request: Request<()>) -> Sending<'_> {
            assert_eq!(request.method(), "GET", "BuhTig only reads from GitHub");
            let answer = (self.answer)(&request);
            self.requests
                .lock()
                .unwrap()
                .push((request.uri().to_string(), request.headers().clone()));
            Box::pin(std::future::ready(answer))
        }
    }

    /// An answer with `status`, `headers` and `body`.
    pub fn answer(
        status: u16,
        headers: &[(&str, &str)],
        body: &str,
    ) -> Result<Response<Bytes>, Error> {
        let mut response = Response::new(Bytes::copy_from_slice(body.as_bytes()));
        *response.status_mut() = StatusCode::from_u16(status).unwrap();
        for (name, value) in headers {
            response.headers_mut().append(
                HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        Ok(response)
    }

    /// A client for `stub`, with the client ID `client-id` and secret `client-secret`.
    pub fn client(stub: &Arc<Stub>) -> Client {
        Client::with_transport(
            stub.clone(),
            "client-id",
            &Secret::new("client-secret".to_owned()),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::stub::{Stub, answer, client};
    use super::*;
    use crate::test_log::capture_log;

    /// `client-id:client-secret` in base64.
    const APP: &str = "Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=";

    fn path(segments: &[&str]) -> Path {
        Path::new(segments.iter().copied()).unwrap()
    }

    fn token(value: &str) -> Credential {
        Credential::Token(Secret::new(value.to_owned()))
    }

    fn authorization(request: &Request<()>) -> Option<&str> {
        header(request.headers(), AUTHORIZATION)
    }

    /// A reset an hour from now, in seconds since 1970 as GitHub gives it, and as a time.
    fn reset_in_an_hour() -> (String, DateTimeUtc) {
        let seconds = (ChronoUtc::now() + TimeDelta::hours(1)).timestamp();
        (
            seconds.to_string(),
            DateTime::from_timestamp(seconds, 0).unwrap(),
        )
    }

    fn is_fresh<T>(reply: &Result<Reply<T>, Error>) -> bool {
        matches!(reply, Ok(Reply::Fresh { .. }))
    }

    #[test]
    fn each_name_stays_one_segment_of_the_path() {
        assert_eq!(
            path(&["repos", "owner", "repo"]).to_string(),
            "/repos/owner/repo"
        );
        assert_eq!(
            path(&["repos", "a/b", r"c?d#e%f\g"]).to_string(),
            "/repos/a%2Fb/c%3Fd%23e%25f%5Cg"
        );
        assert_eq!(
            path(&["orgs", "org", "repos"])
                .query("sort", "pushed")
                .to_string(),
            "/orgs/org/repos?sort=pushed"
        );
        for name in ["", ".", ".."] {
            assert_eq!(Path::new(["repos", "owner", name]), Err(Error::NotFound));
        }
    }

    #[tokio::test]
    async fn requests_are_gets_to_api_github_com_with_the_callers_credential() {
        let stub = Stub::new(|_| answer(200, &[], "{}"));
        let client = client(&stub);
        let repo = path(&["repos", "owner", "repo"]);
        assert!(is_fresh(
            &client.get(&Credential::Visitor, &repo, None).await
        ));
        assert!(is_fresh(
            &client.get(&token("ghp_secret"), &repo, None).await
        ));

        let requests = stub.requests();
        assert_eq!(stub.urls(), ["https://api.github.com/repos/owner/repo"; 2]);
        assert_eq!(header(&requests[0].1, AUTHORIZATION), Some(APP));
        assert_eq!(
            header(&requests[1].1, AUTHORIZATION),
            Some("Bearer ghp_secret")
        );
        for (_, headers) in &requests {
            assert_eq!(header(headers, ACCEPT), Some("application/vnd.github+json"));
            assert_eq!(header(headers, "x-github-api-version"), Some("2022-11-28"));
            assert_eq!(header(headers, USER_AGENT), Some(AGENT));
            assert!(headers[AUTHORIZATION].is_sensitive());
            assert!(!headers.contains_key(IF_NONE_MATCH));
        }
    }

    #[tokio::test]
    async fn rejected_app_credentials_are_dropped_for_good() {
        let stub = Stub::new(|request| match authorization(request) {
            Some(_) => answer(401, &[], r#"{"message":"Bad credentials"}"#),
            None => answer(200, &[], "{}"),
        });
        let client = client(&stub);
        let repo = path(&["repos", "owner", "repo"]);
        let (log, _guard) = capture_log();

        for _ in 0..2 {
            assert!(is_fresh(
                &client.get(&Credential::Visitor, &repo, None).await
            ));
        }
        let sent: Vec<bool> = stub
            .requests()
            .iter()
            .map(|(_, headers)| headers.contains_key(AUTHORIZATION))
            .collect();
        assert_eq!(sent, [true, false, false]);
        let log = String::from_utf8(log.lock().unwrap().clone()).unwrap();
        assert_eq!(
            log.matches("GitHub rejected the OAuth app's client ID and secret")
                .count(),
            1,
            "{log}"
        );

        // A token that GitHub rejects is the caller's to deal with, and is not sent again.
        assert_eq!(
            client.get(&token("revoked"), &repo, None).await,
            Err(Error::BadCredentials)
        );
        assert_eq!(stub.requests().len(), 4);
    }

    /// Three pages of a list: [1, 2], [3, 4] and [5], each linking to the next.
    fn pages() -> Arc<Stub> {
        Stub::new(|request| {
            let url = Url::parse(&request.uri().to_string()).unwrap();
            let page = url
                .query_pairs()
                .find(|(key, _)| key == "page")
                .map_or(1, |(_, page)| page.parse().unwrap());
            let next = format!(
                r#"<https://api.github.com/organizations/1/repos?per_page=9&page={}>; rel="next", <https://api.github.com/organizations/1/repos?per_page=9&page=3>; rel="last""#,
                page + 1
            );
            match page {
                1 => answer(200, &[("link", &next), ("etag", r#"W/"page-1""#)], "[1,2]"),
                2 => answer(200, &[("link", &next)], "[3,4]"),
                _ => answer(200, &[], "[5]"),
            }
        })
    }

    fn list(reply: Result<Reply<List>, Error>) -> (Vec<Value>, bool, Option<String>) {
        match reply {
            Ok(Reply::Fresh {
                data: List { items, truncated },
                etag,
                ..
            }) => (items, truncated, etag),
            other => panic!("{other:?}"),
        }
    }

    #[tokio::test]
    async fn lists_follow_next_links_up_to_the_limit() {
        let repos = path(&["orgs", "org", "repos"])
            .query("sort", "pushed")
            .query("per_page", "50");
        let numbers =
            |numbers: &[u64]| -> Vec<Value> { numbers.iter().map(|n| (*n).into()).collect() };

        let stub = pages();
        let reply = client(&stub)
            .get_list(&Credential::Visitor, &repos, 3, None)
            .await;
        assert_eq!(list(reply), (numbers(&[1, 2, 3]), true, None));
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/orgs/org/repos?sort=pushed&per_page=3",
                "https://api.github.com/organizations/1/repos?per_page=9&page=2",
            ]
        );

        let stub = pages();
        let reply = client(&stub)
            .get_list(&Credential::Visitor, &repos, 5, None)
            .await;
        assert_eq!(list(reply), (numbers(&[1, 2, 3, 4, 5]), false, None));
        assert_eq!(stub.requests().len(), 3);

        let stub = pages();
        let reply = client(&stub)
            .get_list(&Credential::Visitor, &repos, 1000, None)
            .await;
        assert_eq!(list(reply), (numbers(&[1, 2, 3, 4, 5]), false, None));
        assert_eq!(
            stub.urls()[0],
            "https://api.github.com/orgs/org/repos?sort=pushed&per_page=100"
        );
    }

    #[tokio::test]
    async fn a_list_is_conditional_only_when_its_first_page_decides_it() {
        // The limit is reached on the first page.
        let stub = pages();
        let reply = client(&stub)
            .get_list(&Credential::Visitor, &path(&["x"]), 2, None)
            .await;
        assert_eq!(
            list(reply),
            (
                vec![1.into(), 2.into()],
                true,
                Some(r#"W/"page-1""#.to_owned())
            )
        );

        // The first page is the whole list.
        let stub = Stub::new(|request| match header(request.headers(), IF_NONE_MATCH) {
            Some(r#"W/"v1""#) => answer(304, &[], ""),
            _ => answer(200, &[("etag", r#"W/"v2""#)], "[1]"),
        });
        let github = client(&stub);
        let (_, _, etag) = list(
            github
                .get_list(&Credential::Visitor, &path(&["x"]), 10, None)
                .await,
        );
        assert_eq!(etag.as_deref(), Some(r#"W/"v2""#));
        assert_eq!(
            github
                .get_list(&Credential::Visitor, &path(&["x"]), 10, Some(r#"W/"v1""#))
                .await,
            Ok(Reply::NotModified)
        );
        assert_eq!(
            header(&stub.requests()[1].1, IF_NONE_MATCH),
            Some(r#"W/"v1""#)
        );

        // A full page with no next link: more may follow it before the next request.
        let full = format!("[{}]", vec!["0"; PER_PAGE].join(","));
        let stub = Stub::new(move |_| answer(200, &[("etag", r#"W/"v2""#)], &full));
        let reply = client(&stub)
            .get_list(&Credential::Visitor, &path(&["x"]), 1000, None)
            .await;
        let (items, truncated, etag) = list(reply);
        assert_eq!((items.len(), truncated, etag), (PER_PAGE, false, None));
    }

    #[tokio::test]
    async fn lists_end_at_an_empty_page_and_never_leave_api_github_com() {
        let stub = Stub::new(|_| answer(204, &[], ""));
        let reply = client(&stub)
            .get_list(&Credential::Visitor, &path(&["x"]), 10, None)
            .await;
        assert_eq!(list(reply), (Vec::new(), false, None));

        let stub = Stub::new(|request| match request.uri().path() {
            "/x" => answer(
                200,
                &[("link", r#"<https://api.github.com/y>; rel="next""#)],
                "[1]",
            ),
            _ => answer(
                200,
                &[("link", r#"<https://api.github.com/y>; rel="next""#)],
                "[]",
            ),
        });
        let reply = client(&stub)
            .get_list(&Credential::Visitor, &path(&["x"]), 10, None)
            .await;
        assert_eq!(list(reply), (vec![1.into()], true, None));
        assert_eq!(stub.requests().len(), 2);

        for link in [
            r#"<https://evil.example/x?page=2>; rel="next""#,
            r#"<http://api.github.com/x?page=2>; rel="next""#,
            r#"<https://user:pw@api.github.com/x?page=2>; rel="next""#,
            r#"<https://api.github.com:8443/x?page=2>; rel="next""#,
        ] {
            let stub = Stub::new(move |_| answer(200, &[("link", link)], "[1]"));
            let reply = client(&stub)
                .get_list(&token("t"), &path(&["x"]), 10, None)
                .await;
            assert!(matches!(reply, Err(Error::Invalid(_))), "{link}: {reply:?}");
            assert_eq!(stub.requests().len(), 1, "{link}");
        }
    }

    #[test]
    fn next_links_are_found_among_the_others() {
        let headers = |links: &[&str]| {
            let mut headers = HeaderMap::new();
            for link in links {
                headers.append(LINK, HeaderValue::from_str(link).unwrap());
            }
            headers
        };
        assert_eq!(
            next_link(&headers(&[
                r#"<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?q=a,b&page=3>; rel="next""#
            ])),
            Some("https://api.github.com/x?q=a,b&page=3".to_owned())
        );
        assert_eq!(
            next_link(&headers(&[
                r#"<https://api.github.com/x?page=9>; rel="last""#,
                "<https://api.github.com/x?page=2>; rel=next",
            ])),
            Some("https://api.github.com/x?page=2".to_owned())
        );
        for links in [
            &[][..],
            &[r#"<https://api.github.com/x?page=9>; rel="last""#][..],
            &[r#"<https://api.github.com/x?page=2; rel="next""#][..],
            &["garbage"][..],
        ] {
            assert_eq!(next_link(&headers(links)), None, "{links:?}");
        }
    }

    #[tokio::test]
    async fn a_primary_rate_limit_holds_back_that_bucket_until_it_resets() {
        let (reset, until) = reset_in_an_hour();
        let stub = Stub::new(move |request| {
            if authorization(request).is_some_and(|value| value.starts_with("Bearer")) {
                return answer(200, &[], "{}");
            }
            match request.uri().path() {
                path if path.starts_with("/search/") => answer(
                    200,
                    &[
                        ("x-ratelimit-limit", "30"),
                        ("x-ratelimit-remaining", "29"),
                        ("x-ratelimit-reset", &reset),
                        ("x-ratelimit-resource", "search"),
                    ],
                    "{}",
                ),
                _ => answer(
                    403,
                    &[
                        ("x-ratelimit-limit", "5000"),
                        ("x-ratelimit-remaining", "0"),
                        ("x-ratelimit-reset", &reset),
                        ("x-ratelimit-resource", "core"),
                    ],
                    r#"{"message":"API rate limit exceeded for 203.0.113.1."}"#,
                ),
            }
        });
        let client = client(&stub);
        let limited = Err(Error::RateLimited { until });

        assert_eq!(
            client.get(&Credential::Visitor, &path(&["a"]), None).await,
            limited
        );
        assert_eq!(
            client.get(&Credential::Visitor, &path(&["b"]), None).await,
            limited
        );
        assert_eq!(stub.requests().len(), 1);
        assert_eq!(
            client.visitor_rate_limit(),
            Some(RateLimit {
                limit: 5000,
                remaining: 0,
                reset: until
            })
        );

        // Another bucket of the same credential, and another credential, are not held back.
        let search = path(&["search", "issues"]).query("q", "repo:owner/repo");
        assert!(is_fresh(
            &client.get(&Credential::Visitor, &search, None).await
        ));
        assert!(is_fresh(
            &client.get(&token("t"), &path(&["a"]), None).await
        ));
        assert_eq!(stub.requests().len(), 3);
    }

    #[tokio::test]
    async fn a_secondary_rate_limit_holds_back_every_bucket_of_that_credential() {
        let stub = Stub::new(|request| match authorization(request) {
            Some("Bearer busy") => answer(
                403,
                &[],
                r#"{"message":"You have exceeded a secondary rate limit. Please wait a few minutes before you try again."}"#,
            ),
            _ => answer(200, &[], "{}"),
        });
        let client = client(&stub);
        let before = ChronoUtc::now();
        let Err(Error::RateLimited { until }) =
            client.get(&token("busy"), &path(&["a"]), None).await
        else {
            panic!("not rate limited");
        };
        assert!(
            until >= before + SECONDARY_WAIT && until <= ChronoUtc::now() + SECONDARY_WAIT,
            "{until}"
        );

        let search = path(&["search", "issues"]);
        assert_eq!(
            client.get(&token("busy"), &search, None).await,
            Err(Error::RateLimited { until })
        );
        assert_eq!(stub.requests().len(), 1);
        assert!(is_fresh(&client.get(&token("idle"), &search, None).await));
    }

    #[tokio::test]
    async fn retry_after_says_how_long_to_wait() {
        let stub = Stub::new(|_| answer(429, &[("retry-after", "30")], ""));
        let client = client(&stub);
        let before = ChronoUtc::now();
        let Err(Error::RateLimited { until }) =
            client.get(&Credential::Visitor, &path(&["a"]), None).await
        else {
            panic!("not rate limited");
        };
        let wait = TimeDelta::seconds(30);
        assert!(
            until >= before + wait && until <= ChronoUtc::now() + wait,
            "{until}"
        );
    }

    #[tokio::test]
    async fn the_last_request_of_a_window_holds_back_the_next_one() {
        let (reset, until) = reset_in_an_hour();
        let stub = Stub::new(move |_| {
            answer(
                200,
                &[
                    ("x-ratelimit-limit", "60"),
                    ("x-ratelimit-remaining", "0"),
                    ("x-ratelimit-reset", &reset),
                ],
                "{}",
            )
        });
        let client = client(&stub);
        assert!(is_fresh(
            &client.get(&Credential::Visitor, &path(&["a"]), None).await
        ));
        assert_eq!(
            client.get(&Credential::Visitor, &path(&["a"]), None).await,
            Err(Error::RateLimited { until })
        );
        assert_eq!(stub.requests().len(), 1);
    }

    #[tokio::test]
    async fn a_limit_that_has_reset_holds_nothing_back() {
        let past = (ChronoUtc::now() - TimeDelta::seconds(1))
            .timestamp()
            .to_string();
        let stub = Stub::new(move |_| {
            answer(
                403,
                &[
                    ("x-ratelimit-limit", "60"),
                    ("x-ratelimit-remaining", "0"),
                    ("x-ratelimit-reset", &past),
                ],
                "{}",
            )
        });
        let client = client(&stub);
        for _ in 0..2 {
            let reply = client.get(&Credential::Visitor, &path(&["a"]), None).await;
            assert!(matches!(reply, Err(Error::RateLimited { .. })), "{reply:?}");
        }
        assert_eq!(stub.requests().len(), 2);
        assert_eq!(client.visitor_rate_limit(), None);
    }

    #[tokio::test]
    async fn readings_that_arrive_out_of_order_keep_the_lowest_remaining() {
        let (reset, until) = reset_in_an_hour();
        let later = (until + TimeDelta::hours(1)).timestamp().to_string();
        let stub = Stub::new(move |request| {
            let (remaining, reset) = match request.uri().path() {
                "/a" => ("10", reset.as_str()),
                "/b" => ("12", reset.as_str()),
                _ => ("59", later.as_str()),
            };
            answer(
                200,
                &[
                    ("x-ratelimit-limit", "60"),
                    ("x-ratelimit-remaining", remaining),
                    ("x-ratelimit-reset", reset),
                ],
                "{}",
            )
        });
        let client = client(&stub);
        for segment in ["a", "b"] {
            client
                .get(&Credential::Visitor, &path(&[segment]), None)
                .await
                .unwrap();
        }
        assert_eq!(client.visitor_rate_limit().unwrap().remaining, 10);

        client
            .get(&Credential::Visitor, &path(&["c"]), None)
            .await
            .unwrap();
        let limit = client.visitor_rate_limit().unwrap();
        assert_eq!(
            (limit.remaining, limit.reset),
            (59, until + TimeDelta::hours(1))
        );
    }

    #[tokio::test]
    async fn statistics_being_computed_unchanged_data_and_no_content() {
        let stub = Stub::new(|request| match request.uri().path() {
            "/computing" => answer(202, &[], "{}"),
            "/empty" => answer(204, &[], ""),
            _ => match header(request.headers(), IF_NONE_MATCH) {
                Some(r#"W/"v1""#) => answer(304, &[("etag", r#"W/"v1""#)], ""),
                _ => answer(200, &[("etag", r#"W/"v2""#)], r#"{"stars":1}"#),
            },
        });
        let client = client(&stub);
        let visitor = &Credential::Visitor;

        assert_eq!(
            client.get(visitor, &path(&["computing"]), None).await,
            Ok(Reply::Computing)
        );
        assert_eq!(
            client.get(visitor, &path(&["empty"]), None).await,
            Ok(Reply::Fresh {
                data: Value::Null,
                etag: None,
                redirected: false
            })
        );
        assert_eq!(
            client
                .get(visitor, &path(&["repo"]), Some(r#"W/"v1""#))
                .await,
            Ok(Reply::NotModified)
        );
        assert_eq!(
            header(&stub.requests()[2].1, IF_NONE_MATCH),
            Some(r#"W/"v1""#)
        );
        assert_eq!(
            client
                .get(visitor, &path(&["repo"]), Some(r#"W/"v0""#))
                .await,
            Ok(Reply::Fresh {
                data: serde_json::json!({"stars": 1}),
                etag: Some(r#"W/"v2""#.to_owned()),
                redirected: false
            })
        );
    }

    #[tokio::test]
    async fn renamed_repositories_are_followed_within_api_github_com() {
        let stub = Stub::new(|request| match request.uri().path() {
            "/repos/owner/old" => answer(
                301,
                &[("location", "https://api.github.com/repositories/42")],
                r#"{"message":"Moved Permanently"}"#,
            ),
            "/repos/owner/moved" => answer(307, &[("location", "/repositories/42")], ""),
            _ => answer(200, &[], r#"{"full_name":"owner/new"}"#),
        });
        let client = client(&stub);
        for name in ["old", "moved"] {
            let reply = client
                .get(&token("t"), &path(&["repos", "owner", name]), Some("e"))
                .await;
            assert_eq!(
                reply,
                Ok(Reply::Fresh {
                    data: serde_json::json!({"full_name": "owner/new"}),
                    etag: None,
                    redirected: true
                })
            );
        }
        let requests = stub.requests();
        assert_eq!(requests[1].0, "https://api.github.com/repositories/42");
        for (_, headers) in &requests {
            assert_eq!(header(headers, AUTHORIZATION), Some("Bearer t"));
            assert_eq!(header(headers, IF_NONE_MATCH), Some("e"));
        }
    }

    #[tokio::test]
    async fn redirects_never_leave_api_github_com_or_go_on_forever() {
        let stub = Stub::new(|request| match request.uri().path() {
            "/away" => answer(301, &[("location", "https://evil.example/steal")], ""),
            "/plain" => answer(301, &[("location", "http://api.github.com/x")], ""),
            "/nowhere" => answer(301, &[], ""),
            _ => answer(302, &[("location", "/loop")], ""),
        });
        let client = client(&stub);
        for name in ["away", "plain", "nowhere"] {
            let reply = client.get(&token("t"), &path(&[name]), None).await;
            assert!(matches!(reply, Err(Error::Invalid(_))), "{name}: {reply:?}");
        }
        assert_eq!(stub.requests().len(), 3, "sent only to api.github.com");

        let reply = client.get(&token("t"), &path(&["loop"]), None).await;
        assert_eq!(
            reply,
            Err(Error::Invalid("more than 5 redirects".to_owned()))
        );
        assert_eq!(stub.requests().len(), 3 + 1 + MAX_REDIRECTS);
    }

    #[tokio::test]
    async fn answers_without_data_become_errors() {
        const SSO: &str = "required; url=https://github.com/orgs/org/sso?authorization_request=abc";
        let stub = Stub::new(|request| match request.uri().path() {
            "/missing" => answer(404, &[], r#"{"message":"Not Found"}"#),
            "/gone" => answer(410, &[], ""),
            "/blocked" => answer(451, &[], ""),
            "/sso" => answer(403, &[("x-github-sso", SSO)], ""),
            "/hidden" => answer(404, &[("x-github-sso", SSO)], ""),
            "/denied" => answer(
                403,
                &[],
                r#"{"message":"Resource not accessible by personal access token"}"#,
            ),
            "/empty" => answer(409, &[], r#"{"message":"Git Repository is empty."}"#),
            "/broken" => answer(502, &[], "<html>Bad gateway</html>"),
            "/garbled" => answer(200, &[], "not json"),
            "/odd" => answer(
                200,
                &[
                    ("x-ratelimit-limit", "many"),
                    ("x-ratelimit-remaining", "-1"),
                    ("x-ratelimit-reset", "99999999999999999999"),
                    ("retry-after", "soon"),
                ],
                "{}",
            ),
            "/revoked" => answer(401, &[], r#"{"message":"Bad credentials"}"#),
            _ => Err(Error::Unreachable("connection refused".to_owned())),
        });
        let client = client(&stub);
        let sso = Error::SsoRequired {
            url: Some("https://github.com/orgs/org/sso?authorization_request=abc".to_owned()),
        };
        for (name, expected) in [
            ("missing", Error::NotFound),
            ("gone", Error::NotFound),
            ("blocked", Error::NotFound),
            ("sso", sso.clone()),
            ("hidden", sso),
            (
                "denied",
                Error::Forbidden {
                    message: Some("Resource not accessible by personal access token".to_owned()),
                },
            ),
            (
                "empty",
                Error::Status {
                    status: 409,
                    message: Some("Git Repository is empty.".to_owned()),
                },
            ),
            (
                "broken",
                Error::Status {
                    status: 502,
                    message: None,
                },
            ),
            ("garbled", Error::Invalid("the body is not JSON".to_owned())),
            ("revoked", Error::BadCredentials),
            ("down", Error::Unreachable("connection refused".to_owned())),
        ] {
            assert_eq!(
                client.get(&token("t"), &path(&[name]), None).await,
                Err(expected),
                "{name}"
            );
        }
        assert!(is_fresh(
            &client.get(&token("t"), &path(&["odd"]), None).await
        ));
        assert!(is_fresh(
            &client.get(&token("t"), &path(&["odd"]), None).await
        ));
    }

    #[tokio::test]
    async fn no_credential_shows_in_what_the_client_prints() {
        let stub = Stub::new(|_| answer(403, &[], r#"{"message":"Forbidden"}"#));
        let client = client(&stub);
        let secret = token("ghp_secret");
        let error = client.get(&secret, &path(&["a"]), None).await.unwrap_err();
        client
            .get(&Credential::Visitor, &path(&["a"]), None)
            .await
            .unwrap_err();

        let printed = format!("{secret:?} {error} {error:?} {:?}", stub.requests());
        for leaked in ["ghp_secret", "client-secret", &APP["Basic ".len()..]] {
            assert!(!printed.contains(leaked), "{leaked:?} in {printed}");
        }
    }
}
