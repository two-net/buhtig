//! BuhTig's cache of GitHub data, in PostgreSQL (SRS §4.9). Data younger than
//! `cache.ttl` is served without calling GitHub (FR-DATA-03). When GitHub fails, the most
//! recent data is served instead, with its age (FR-DATA-05).
//!
//! Every entry belongs to a [`Scope`] (FR-DATA-04). Data fetched without a PAT, for a
//! visitor or a signed-in user, is shared: anyone may be served it, so it must hold only
//! public information. Data fetched with a PAT is private to that user. A request's
//! [`Viewer`] decides both its credential and its scope, so the two cannot disagree, and
//! no one is served data that another user's PAT fetched (FR-ACC-06).
//!
//! Visitors may fetch only so much from GitHub (FR-DATA-10, FR-DATA-11). Once they may not,
//! they are served what the cache has, however old, as during an outage.
//!
//! Requests that miss the same data in the same scope at the same time wait for one fetch
//! (FR-DATA-08). Those fetches, and the marks that limit refreshes (FR-DATA-07), are held
//! in memory alone, which a restart may lose (NFR-REL-02).

#![allow(
    dead_code,
    reason = "the dashboards that read through the cache are still to come (#14, #15)"
)]

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
use sea_orm::sea_query::prelude::chrono::TimeDelta;
use sea_orm::sea_query::{Expr, Func, OnConflict, Order};
use sea_orm::{
    ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
};
use serde_json::Value;
use tokio::sync::watch;
use tracing::{debug, error, warn};

use crate::config::{CacheConfig, LimitsConfig, Secret};
use crate::entity::cache_entry::{self, Scope};
use crate::github::{self, Credential, List, Path, Reply};
use crate::visitors::{Held, Visitor, Visitors};

/// FR-DATA-07: a dashboard may be refreshed at most once a minute.
const REFRESH_INTERVAL: TimeDelta = TimeDelta::minutes(1);

/// The time now, which tests set.
type Clock = dyn Fn() -> DateTimeUtc + Sync;

/// Who data is fetched for. That decides both the credential (FR-DATA-02) and the scope
/// (FR-DATA-04).
#[derive(Clone, Debug)]
pub enum Viewer {
    /// Someone who has not signed in: BuhTig's app credentials, the shared cache, and the
    /// limits on what visitors may fetch.
    Visitor(Visitor),
    /// A signed-in user without a valid PAT: their sign-in credential (FR-PAT-06), which
    /// sees only public data (A-03), and the shared cache.
    SignedIn { sign_in: Secret<String> },
    /// A token user: their PAT, and their private cache. `user_id` is their `users.id`.
    TokenUser { user_id: i64, pat: Secret<String> },
}

impl Viewer {
    fn scope(&self) -> Scope {
        match self {
            Viewer::Visitor(_) | Viewer::SignedIn { .. } => Scope::Shared,
            Viewer::TokenUser { user_id, .. } => Scope::User(*user_id),
        }
    }

    /// The token the viewer's requests carry, if any.
    fn token(&self) -> Option<&Secret<String>> {
        match self {
            Viewer::Visitor(_) => None,
            Viewer::SignedIn { sign_in } => Some(sign_in),
            Viewer::TokenUser { pat, .. } => Some(pat),
        }
    }

    fn credential(&self) -> Credential {
        self.token()
            .cloned()
            .map_or(Credential::Visitor, Credential::Token)
    }
}

/// What the cache had for a request.
#[derive(Clone, Debug, PartialEq)]
pub enum Outcome<T> {
    Data(Cached<T>),
    /// GitHub is still computing this statistic; ask again later (FR-REPO-10). Nothing is
    /// cached for it.
    Computing,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Cached<T> {
    pub data: T,
    /// When GitHub last gave or confirmed the data (FR-DATA-06).
    pub fetched_at: DateTimeUtc,
    /// Why newer data is missing, when this is the most recent data cached, however old.
    pub stale: Option<Stale>,
}

/// Why GitHub was not asked for newer data, or had none.
#[derive(Clone, Debug, PartialEq)]
pub enum Stale {
    /// GitHub failed (FR-DATA-05).
    GitHub(github::Error),
    /// The viewer is a visitor who may not fetch from GitHub now, until they sign in
    /// (FR-DATA-10, FR-DATA-11).
    Held(Held),
}

/// Why the cache has no data for a request.
#[derive(Debug)]
pub enum Error {
    /// GitHub had none, and nothing is cached. A rate limit says until when it holds
    /// (FR-DATA-05).
    GitHub(github::Error),
    /// The viewer is a visitor who may not fetch from GitHub now, and nothing is cached
    /// (FR-DATA-10, FR-DATA-11).
    Held(Held),
    Database(DbErr),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::GitHub(error) => error.fmt(f),
            Error::Held(held) => held.fmt(f),
            Error::Database(error) => write!(f, "cannot read cached GitHub data: {error}"),
        }
    }
}

impl std::error::Error for Error {}

/// Why a dashboard cannot be refreshed now (FR-DATA-07).
#[derive(Debug, PartialEq)]
pub enum Refused {
    /// Only signed-in users may refresh (FR-ACC-02).
    SignInRequired,
    /// It was refreshed less than a minute ago, and may be again from `until`.
    TooSoon { until: DateTimeUtc },
}

pub struct Cache {
    db: DatabaseConnection,
    github: Arc<github::Client>,
    ttl: TimeDelta,
    /// The fetches in progress, by scope and resource key. Each is watched by the
    /// requests that wait for it.
    flights: Mutex<HashMap<(Scope, String), Watch>>,
    /// When each dashboard was last refreshed, by scope and lowercased dashboard path.
    refreshes: Mutex<HashMap<(Scope, String), DateTimeUtc>>,
    /// How much visitors may still fetch from GitHub (FR-DATA-10, FR-DATA-11).
    visitors: Visitors,
}

/// What to read from GitHub.
#[derive(Clone, Copy)]
enum Fetch<'a> {
    One(&'a Path),
    List { path: &'a Path, limit: usize },
}

impl Fetch<'_> {
    /// The `resource_key` of its cache entries, such as `/repos/owner/repo/languages`, or
    /// `/orgs/org/repos?sort=pushed limit=1000` for a list. A path has no spaces, since
    /// they are percent-encoded, so the two kinds of key cannot meet.
    fn key(&self) -> String {
        match self {
            Fetch::One(path) => path.to_string(),
            Fetch::List { path, limit } => format!("{path} limit={limit}"),
        }
    }

    /// Whether `data` is what this fetch stores.
    fn holds(&self, data: &Value) -> bool {
        match self {
            Fetch::One(_) => true,
            Fetch::List { .. } => {
                data.get("items").is_some_and(Value::is_array)
                    && data.get("truncated").is_some_and(Value::is_boolean)
            }
        }
    }

    async fn send(
        &self,
        github: &github::Client,
        credential: &Credential,
        etag: Option<&str>,
    ) -> Result<Reply<Value>, github::Error> {
        match self {
            Fetch::One(path) => github.get(credential, path, etag).await,
            Fetch::List { path, limit } => Ok(github
                .get_list(credential, path, *limit, etag)
                .await?
                .map(list_value)),
        }
    }
}

/// What the requests waiting for a fetch watch, until it lands.
type Watch = watch::Receiver<Option<Arc<Landing>>>;

/// What a fetch came to, for the requests that waited for it.
struct Landing {
    result: Result<Outcome<Value>, github::Error>,
    /// The token the fetch carried, to tell whether its error is about that token.
    token: Option<Secret<String>>,
    /// False when the data was not stored, because it is marked private.
    stored: bool,
}

impl Landing {
    /// Whether `viewer` may take this result as its own: whether it would have had the
    /// same from the cache, or from GitHub with its own credential.
    fn serves(&self, viewer: &Viewer) -> bool {
        let error = match &self.result {
            Ok(Outcome::Data(cached)) => match &cached.stale {
                None => None,
                Some(Stale::GitHub(error)) => Some(error),
                // Held results never land, and a hold is the one visitor's alone.
                Some(Stale::Held(_)) => return false,
            },
            Ok(Outcome::Computing) => None,
            Err(error) => Some(error),
        };
        self.stored
            && error.is_none_or(|error| {
                !depends_on_credential(error) || self.token.as_ref() == viewer.token()
            })
    }
}

/// A request's part in fetching an entry: it leads the fetch, or waits for another
/// request's.
enum Flight<'a> {
    Lead(Lead<'a>),
    Follow(Watch),
}

/// The fetch that a request leads. It leaves `flights` when it lands, or else when it is
/// dropped, as when its request is cancelled, so that the requests waiting for it start
/// over.
struct Lead<'a> {
    cache: &'a Cache,
    id: (Scope, String),
    sender: watch::Sender<Option<Arc<Landing>>>,
    landed: bool,
}

impl Lead<'_> {
    /// Hands `landing` to the requests waiting for it, and returns its result.
    fn land(mut self, landing: Landing) -> Result<Outcome<Value>, github::Error> {
        // No one can start waiting once the flight has left `flights`. A request that
        // misses the entry after this reads what the fetch stored, or fetches anew.
        drop(self.cache.flights().remove(&self.id));
        self.landed = true;
        if self.sender.receiver_count() == 0 {
            return landing.result;
        }
        let result = landing.result.clone();
        self.sender.send_replace(Some(Arc::new(landing)));
        result
    }
}

impl Drop for Lead<'_> {
    fn drop(&mut self) {
        // Until it lands, the flight in `flights` under its id is this one.
        if !self.landed {
            self.cache.flights().remove(&self.id);
        }
    }
}

impl Cache {
    pub fn new(
        db: DatabaseConnection,
        github: Arc<github::Client>,
        config: &CacheConfig,
        limits: &LimitsConfig,
    ) -> Cache {
        Cache {
            db,
            github,
            ttl: TimeDelta::from_std(config.ttl).unwrap_or(TimeDelta::MAX),
            flights: Mutex::default(),
            refreshes: Mutex::default(),
            visitors: Visitors::new(limits.visitor_fetches_per_hour),
        }
    }

    /// One resource, for a dashboard: its path, such as `/owner/repo` or `/org`
    /// (FR-NAV-01), which [`Cache::refresh`] takes.
    ///
    /// Only for data that is the same for everyone who may see it. Data about the
    /// viewer, such as `/user`, must not be read through the cache: a signed-in user's
    /// would be shared.
    pub async fn get(
        &self,
        viewer: &Viewer,
        dashboard: &str,
        path: &Path,
    ) -> Result<Outcome<Value>, Error> {
        self.lookup(viewer, dashboard, Fetch::One(path), &ChronoUtc::now)
            .await
    }

    /// Up to `limit` items of a list, for a dashboard, as [`Cache::get`].
    pub async fn get_list(
        &self,
        viewer: &Viewer,
        dashboard: &str,
        path: &Path,
        limit: usize,
    ) -> Result<Outcome<List>, Error> {
        self.list(viewer, dashboard, path, limit, &ChronoUtc::now)
            .await
    }

    /// Makes the next requests for a dashboard's data ask GitHub, conditionally, however
    /// fresh what is cached (FR-DATA-07). Only signed-in users may, at most once a minute
    /// for each dashboard in each scope: shared data refreshed by one user is then less
    /// than a minute old for everyone.
    ///
    /// Each dashboard refreshed is remembered for up to `cache.ttl`, so `dashboard` must
    /// be one that the caller has checked.
    pub fn refresh(&self, viewer: &Viewer, dashboard: &str) -> Result<(), Refused> {
        self.refresh_at(viewer, dashboard, ChronoUtc::now())
    }

    /// The name of a repository picked at random from the shared cache, which holds only
    /// public ones (FR-DATA-04), or `None` while it holds none (FR-SRCH-10).
    ///
    /// Only repositories read whole count, as their dashboards read them, however old: not
    /// those that only appear in a list. The name is `full_name`, as GitHub returns it
    /// (FR-NAV-04), whatever case the path was asked for in.
    pub async fn random_repository(&self) -> Result<Option<String>, DbErr> {
        // Here alone: `ExprTrait` gives `String` methods that shadow those of `str`, such
        // as `matches`.
        use sea_orm::sea_query::ExprTrait;
        use sea_orm::sea_query::extension::postgres::PgExpr;

        use cache_entry::Column;

        let name = Expr::col(Column::Data).cast_json_field("full_name");
        cache_entry::Entity::find()
            .select_only()
            .expr(name.clone())
            .filter(Column::Scope.eq(Scope::Shared.key()))
            // `/repos/{owner}/{repo}`, and not what is under it, such as its languages.
            .filter(Column::ResourceKey.like("/repos/%/%"))
            .filter(Column::ResourceKey.not_like("/repos/%/%/%"))
            .filter(name.is_not_null())
            .order_by(Func::random(), Order::Asc)
            .into_tuple()
            .one(&self.db)
            .await
    }

    async fn list(
        &self,
        viewer: &Viewer,
        dashboard: &str,
        path: &Path,
        limit: usize,
        clock: &Clock,
    ) -> Result<Outcome<List>, Error> {
        let fetch = Fetch::List { path, limit };
        match self.lookup(viewer, dashboard, fetch, clock).await? {
            Outcome::Computing => Ok(Outcome::Computing),
            Outcome::Data(Cached {
                data,
                fetched_at,
                stale,
            }) => {
                // `lookup` only returns data that `fetch.holds`.
                let data = value_list(data).ok_or_else(|| {
                    Error::GitHub(github::Error::Invalid(
                        "a cached list is not one".to_owned(),
                    ))
                })?;
                Ok(Outcome::Data(Cached {
                    data,
                    fetched_at,
                    stale,
                }))
            }
        }
    }

    fn refresh_at(
        &self,
        viewer: &Viewer,
        dashboard: &str,
        now: DateTimeUtc,
    ) -> Result<(), Refused> {
        if matches!(viewer, Viewer::Visitor(_)) {
            return Err(Refused::SignInRequired);
        }
        let id = (viewer.scope(), mark(dashboard));
        let mut refreshes = self.refreshes();
        if let Some(until) = refreshes
            .get(&id)
            .map(|at| *at + REFRESH_INTERVAL)
            .filter(|until| *until > now)
        {
            return Err(Refused::TooSoon { until });
        }
        // A mark matters while it limits refreshes, and while data fetched before it
        // could otherwise still be fresh.
        let kept = REFRESH_INTERVAL.max(self.ttl);
        refreshes.retain(|_, at| expiry(*at, kept) > now);
        refreshes.insert(id, now);
        Ok(())
    }

    /// The data for `fetch`: from the cache while it is fresh, else from GitHub if the
    /// viewer may ask it, else what the cache has, however old.
    async fn lookup(
        &self,
        viewer: &Viewer,
        dashboard: &str,
        fetch: Fetch<'_>,
        clock: &Clock,
    ) -> Result<Outcome<Value>, Error> {
        let scope = viewer.scope();
        let key = fetch.key();
        loop {
            if let Some(entry) = self.fresh(scope, &key, fetch, dashboard, clock).await? {
                debug!(key, "served GitHub data from the cache");
                return Ok(Outcome::Data(cached(entry, None)));
            }
            match self.flight(scope, &key) {
                Flight::Lead(lead) => {
                    // Read again: another fetch may have landed since the read above.
                    let stored = self.stored(scope, &key, fetch).await?;
                    let landing = match stored {
                        Some(entry) if self.is_fresh(&entry, scope, dashboard, clock()) => {
                            Landing {
                                result: Ok(Outcome::Data(cached(entry, None))),
                                token: None,
                                stored: true,
                            }
                        }
                        stored => {
                            if let Viewer::Visitor(visitor) = viewer
                                && let Err(held) = self.visitors.admit(
                                    visitor,
                                    dashboard,
                                    self.github.visitor_rate_limit(),
                                    clock(),
                                )
                            {
                                // The hold is this visitor's alone, so it does not land:
                                // the requests waiting for it start over, each to be let
                                // through or held back on its own.
                                drop(lead);
                                debug!(key, "served a visitor from the cache only: {held}");
                                return match stored {
                                    Some(entry) => {
                                        Ok(Outcome::Data(cached(entry, Some(Stale::Held(held)))))
                                    }
                                    None => Err(Error::Held(held)),
                                };
                            }
                            self.fetch(viewer, fetch, &key, stored, clock).await
                        }
                    };
                    return lead.land(landing).map_err(Error::GitHub);
                }
                Flight::Follow(mut flight) => {
                    let landing = flight
                        .wait_for(Option::is_some)
                        .await
                        .ok()
                        .and_then(|landed| Option::clone(&landed));
                    if let Some(landing) = landing
                        && landing.serves(viewer)
                    {
                        return landing.result.clone().map_err(Error::GitHub);
                    }
                    // The fetch was cancelled, or its result is not this viewer's to
                    // take: start over.
                }
            }
        }
    }

    /// The entry for `key` in `scope`, if it is fresh.
    async fn fresh(
        &self,
        scope: Scope,
        key: &str,
        fetch: Fetch<'_>,
        dashboard: &str,
        clock: &Clock,
    ) -> Result<Option<cache_entry::Model>, Error> {
        let stored = self.stored(scope, key, fetch).await?;
        Ok(stored.filter(|entry| self.is_fresh(entry, scope, dashboard, clock())))
    }

    fn is_fresh(
        &self,
        entry: &cache_entry::Model,
        scope: Scope,
        dashboard: &str,
        now: DateTimeUtc,
    ) -> bool {
        let refreshed = self.refreshes().get(&(scope, mark(dashboard))).copied();
        // Against the current TTL too, so that a shorter one applies to what is stored.
        entry.expires_at > now
            && expiry(entry.fetched_at, self.ttl) > now
            && refreshed.is_none_or(|refreshed| entry.fetched_at >= refreshed)
    }

    /// Joins the fetch for `key` in `scope` that is in progress, or else leads a new one.
    fn flight(&self, scope: Scope, key: &str) -> Flight<'_> {
        let id = (scope, key.to_owned());
        let mut flights = self.flights();
        if let Some(flight) = flights.get(&id) {
            return Flight::Follow(flight.clone());
        }
        let (sender, receiver) = watch::channel(None);
        flights.insert(id.clone(), receiver);
        Flight::Lead(Lead {
            cache: self,
            id,
            sender,
            landed: false,
        })
    }

    /// Asks GitHub for `fetch` with the viewer's credential, conditionally on what is
    /// `stored`, and caches the answer.
    async fn fetch(
        &self,
        viewer: &Viewer,
        fetch: Fetch<'_>,
        key: &str,
        stored: Option<cache_entry::Model>,
        clock: &Clock,
    ) -> Landing {
        let scope = viewer.scope();
        // As late as can be, so that a refresh just before counts (FR-DATA-07).
        let now = clock();
        let etag = stored.as_ref().and_then(|entry| entry.etag.as_deref());
        let reply = fetch.send(&self.github, &viewer.credential(), etag).await;
        let mut stored_data = true;
        let result = match reply {
            Ok(Reply::Fresh { mut data, etag, .. }) => {
                if scope == Scope::Shared && marks_private(&data) {
                    // GitHub gave it for this viewer's own credential, so it is theirs to
                    // see, but it must never be served to anyone else.
                    warn!(
                        key,
                        "GitHub returned data marked private or internal to a request \
                         without a PAT; it is not cached"
                    );
                    // Nor is what was cached while it was public served any longer.
                    if stored.is_some() {
                        self.forget(scope, key).await;
                    }
                    stored_data = false;
                } else {
                    if scope == Scope::Shared {
                        strip_permissions(&mut data);
                    }
                    self.store(scope, key, &data, etag, now).await;
                }
                debug!(key, "fetched GitHub data");
                Ok(Outcome::Data(Cached {
                    data,
                    fetched_at: now,
                    stale: None,
                }))
            }
            Ok(Reply::NotModified) => match stored {
                Some(entry) => {
                    self.confirm(entry.id, now).await;
                    debug!(key, "GitHub confirmed the cached data");
                    Ok(Outcome::Data(Cached {
                        data: entry.data,
                        fetched_at: now,
                        stale: None,
                    }))
                }
                None => Err(github::Error::Invalid(
                    "not modified, although the request was not conditional".to_owned(),
                )),
            },
            Ok(Reply::Computing) => Ok(Outcome::Computing),
            Err(error) => self.failed(scope, key, stored, error).await,
        };
        Landing {
            result,
            token: viewer.token().cloned(),
            stored: stored_data,
        }
    }

    /// The result when GitHub had no data for a request.
    async fn failed(
        &self,
        scope: Scope,
        key: &str,
        stored: Option<cache_entry::Model>,
        error: github::Error,
    ) -> Result<Outcome<Value>, github::Error> {
        if is_outage(&error) {
            return match stored {
                Some(entry) => {
                    debug!(key, "served stale GitHub data from the cache: {error}");
                    Ok(Outcome::Data(cached(entry, Some(Stale::GitHub(error)))))
                }
                None => Err(error),
            };
        }
        // The resource is no longer this scope's to see, so what was cached for it is not
        // served again, not even during an outage. In the shared scope, that takes an
        // answer that every credential would get.
        let lost =
            denies_access(&error) && (scope != Scope::Shared || !depends_on_credential(&error));
        if lost && stored.is_some() {
            self.forget(scope, key).await;
        }
        Err(error)
    }

    /// The entry for `key` in `scope`, if it holds what `fetch` stores.
    async fn stored(
        &self,
        scope: Scope,
        key: &str,
        fetch: Fetch<'_>,
    ) -> Result<Option<cache_entry::Model>, Error> {
        let entry = cache_entry::Entity::find()
            .filter(cache_entry::Column::Scope.eq(scope.key()))
            .filter(cache_entry::Column::ResourceKey.eq(key))
            .one(&self.db)
            .await
            .map_err(Error::Database)?;
        Ok(entry.filter(|entry| fetch.holds(&entry.data)))
    }

    /// Stores data fetched at `now`. A failure is only logged: the data is still served.
    async fn store(
        &self,
        scope: Scope,
        key: &str,
        data: &Value,
        etag: Option<String>,
        now: DateTimeUtc,
    ) {
        use cache_entry::Column;

        let entry = cache_entry::ActiveModel {
            scope: Set(scope.key()),
            resource_key: Set(key.to_owned()),
            user_id: Set(scope.user_id()),
            data: Set(data.clone()),
            fetched_at: Set(now),
            expires_at: Set(expiry(now, self.ttl)),
            etag: Set(etag),
            ..Default::default()
        };
        let result = cache_entry::Entity::insert(entry)
            .on_conflict(
                OnConflict::columns([Column::Scope, Column::ResourceKey])
                    .update_columns([
                        Column::Data,
                        Column::FetchedAt,
                        Column::ExpiresAt,
                        Column::Etag,
                    ])
                    .to_owned(),
            )
            .exec(&self.db)
            .await;
        if let Err(error) = result {
            error!(key, "cannot cache GitHub data: {error}");
        }
    }

    /// Records that GitHub confirmed at `now` that an entry is unchanged (FR-DATA-09).
    async fn confirm(&self, id: i64, now: DateTimeUtc) {
        let result = cache_entry::Entity::update_many()
            .col_expr(cache_entry::Column::FetchedAt, Expr::value(now))
            .col_expr(
                cache_entry::Column::ExpiresAt,
                Expr::value(expiry(now, self.ttl)),
            )
            .filter(cache_entry::Column::Id.eq(id))
            .exec(&self.db)
            .await;
        if let Err(error) = result {
            error!("cannot update cached GitHub data: {error}");
        }
    }

    async fn forget(&self, scope: Scope, key: &str) {
        let result = cache_entry::Entity::delete_many()
            .filter(cache_entry::Column::Scope.eq(scope.key()))
            .filter(cache_entry::Column::ResourceKey.eq(key))
            .exec(&self.db)
            .await;
        if let Err(error) = result {
            error!(key, "cannot delete cached GitHub data: {error}");
        }
    }

    /// The fetches in progress, even if a thread panicked while it held them: every
    /// change to them leaves them consistent.
    fn flights(&self) -> MutexGuard<'_, HashMap<(Scope, String), Watch>> {
        self.flights.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn refreshes(&self) -> MutexGuard<'_, HashMap<(Scope, String), DateTimeUtc>> {
        self.refreshes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

fn cached(entry: cache_entry::Model, stale: Option<Stale>) -> Cached<Value> {
    Cached {
        data: entry.data,
        fetched_at: entry.fetched_at,
        stale,
    }
}

/// The key of a dashboard's refresh mark. GitHub's names ignore case.
fn mark(dashboard: &str) -> String {
    dashboard.to_ascii_lowercase()
}

/// When data fetched at `at` stops being fresh. A TTL too long for any date never ends.
fn expiry(at: DateTimeUtc, ttl: TimeDelta) -> DateTimeUtc {
    at.checked_add_signed(ttl).unwrap_or(DateTimeUtc::MAX_UTC)
}

/// Whether GitHub failed for a reason other than the resource, so that the data cached
/// for it still stands (FR-DATA-05).
fn is_outage(error: &github::Error) -> bool {
    match error {
        github::Error::Unreachable(_)
        | github::Error::RateLimited { .. }
        | github::Error::Invalid(_) => true,
        github::Error::Status { status, .. } => *status >= 500,
        _ => false,
    }
}

/// Whether GitHub denied the credential the resource: it does not exist, or is not the
/// credential's to see (FR-ACC-07).
fn denies_access(error: &github::Error) -> bool {
    matches!(
        error,
        github::Error::NotFound
            | github::Error::Forbidden { .. }
            | github::Error::SsoRequired { .. }
    )
}

/// Whether an error is about the credential that met it, so that another credential may
/// fare differently: signed-in users each have their own rate limit, for example.
fn depends_on_credential(error: &github::Error) -> bool {
    matches!(
        error,
        github::Error::RateLimited { .. }
            | github::Error::BadCredentials
            | github::Error::Forbidden { .. }
            | github::Error::SsoRequired { .. }
    )
}

/// Whether GitHub marks anything in `data` as private or internal, as it does
/// repositories with `private` and `visibility`, so that it must stay out of the shared
/// cache (FR-DATA-04). serde_json parses at most 128 levels deep, which bounds the
/// recursion.
fn marks_private(data: &Value) -> bool {
    match data {
        Value::Array(items) => items.iter().any(marks_private),
        Value::Object(object) => {
            object.get("private") == Some(&Value::Bool(true))
                || object
                    .get("visibility")
                    .and_then(Value::as_str)
                    .is_some_and(|visibility| {
                        visibility.eq_ignore_ascii_case("private")
                            || visibility.eq_ignore_ascii_case("internal")
                    })
                || object.values().any(marks_private)
        }
        _ => false,
    }
}

/// Removes every `permissions` member, which GitHub fills in for the viewer, such as
/// whether they may push to a repository. What is left is the same for everyone, so the
/// shared cache holds only public information (FR-ACC-06).
fn strip_permissions(data: &mut Value) {
    match data {
        Value::Array(items) => items.iter_mut().for_each(strip_permissions),
        Value::Object(object) => {
            object.remove("permissions");
            object.values_mut().for_each(strip_permissions);
        }
        _ => {}
    }
}

/// How a list is stored.
fn list_value(list: List) -> Value {
    serde_json::json!({ "items": list.items, "truncated": list.truncated })
}

fn value_list(value: Value) -> Option<List> {
    let Value::Object(mut object) = value else {
        return None;
    };
    let truncated = object.get("truncated")?.as_bool()?;
    let Value::Array(items) = object.remove("items")? else {
        return None;
    };
    Some(List { items, truncated })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::future::Future;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, Instant};

    use axum::body::Bytes;
    use axum::http::header::{AUTHORIZATION, IF_NONE_MATCH};
    use axum::http::{HeaderMap, Request, Response};
    use sea_orm::ActiveModelTrait;
    use sea_orm::sea_query::prelude::chrono::DateTime;
    use serde_json::json;
    use tokio::task::JoinSet;
    use url::Url;

    use super::*;
    use crate::config::DatabaseConfig;
    use crate::db;
    use crate::entity::user;
    use crate::github::stub::{Stub, answer};
    use crate::github::{Sending, Transport};
    use crate::test_cluster::cluster;
    use crate::test_log::capture_log;

    /// `client-id:client-secret` in base64, which visitors' requests carry.
    const APP: &str = "Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=";

    const DASHBOARD: &str = "/owner/repo";

    type Answer = dyn Fn(&Request<()>) -> Result<Response<Bytes>, github::Error> + Send + Sync;

    /// A cache on a database of its own, in front of a stub GitHub that answers as the
    /// test says, with Alice and Bob as users.
    struct Setup {
        cache: Arc<Cache>,
        db: DatabaseConnection,
        github: Arc<github::Client>,
        stub: Arc<Stub>,
        respond: Arc<Mutex<Box<Answer>>>,
        delay: Arc<AtomicU64>,
        alice: i64,
        bob: i64,
    }

    /// Sends requests on to the stub after `delay` milliseconds, so that they overlap.
    struct Delayed {
        stub: Arc<Stub>,
        delay: Arc<AtomicU64>,
    }

    impl Transport for Delayed {
        fn send(&self, request: Request<()>) -> Sending<'_> {
            let delay = Duration::from_millis(self.delay.load(Ordering::Relaxed));
            Box::pin(async move {
                tokio::time::sleep(delay).await;
                self.stub.send(request).await
            })
        }
    }

    async fn setup() -> Setup {
        let cluster = cluster();
        let database = cluster.create_database();
        let url = Url::parse(&cluster.url(&database)).unwrap();
        let db = db::connect(&DatabaseConfig {
            url: Secret::new(url),
            max_connections: 20,
        })
        .await
        .unwrap();
        db::migrate(&db).await.unwrap();
        let alice = add_user(&db, 1, "alice").await;
        let bob = add_user(&db, 2, "bob").await;

        let respond: Arc<Mutex<Box<Answer>>> =
            Arc::new(Mutex::new(Box::new(|_| answer(200, &[], "{}"))));
        let stub = Stub::new({
            let respond = respond.clone();
            move |request| (respond.lock().unwrap())(request)
        });
        let delay = Arc::new(AtomicU64::new(0));
        let transport = Delayed {
            stub: stub.clone(),
            delay: delay.clone(),
        };
        let github = Arc::new(github::Client::with_transport(
            Arc::new(transport),
            "client-id",
            &Secret::new("client-secret".to_owned()),
        ));
        Setup {
            cache: Arc::new(Cache::new(
                db.clone(),
                github.clone(),
                &config(15),
                &limits(30),
            )),
            db,
            github,
            stub,
            respond,
            delay,
            alice,
            bob,
        }
    }

    async fn add_user(db: &DatabaseConnection, github_id: i64, login: &str) -> i64 {
        user::ActiveModel {
            github_id: Set(github_id),
            login: Set(login.to_owned()),
            name: Set(None),
            avatar_url: Set(format!(
                "https://avatars.githubusercontent.com/u/{github_id}"
            )),
            created_at: Set(at(0)),
            last_sign_in_at: Set(at(0)),
            ..Default::default()
        }
        .insert(db)
        .await
        .unwrap()
        .id
    }

    impl Cache {
        /// [`Cache::get`] at `now`.
        async fn get_at(
            &self,
            viewer: &Viewer,
            dashboard: &str,
            path: &Path,
            now: DateTimeUtc,
        ) -> Result<Outcome<Value>, Error> {
            self.lookup(viewer, dashboard, Fetch::One(path), &move || now)
                .await
        }

        /// [`Cache::get_list`] at `now`.
        async fn get_list_at(
            &self,
            viewer: &Viewer,
            dashboard: &str,
            path: &Path,
            limit: usize,
            now: DateTimeUtc,
        ) -> Result<Outcome<List>, Error> {
            self.list(viewer, dashboard, path, limit, &move || now)
                .await
        }
    }

    fn config(ttl_minutes: u64) -> CacheConfig {
        CacheConfig {
            ttl: Duration::from_secs(ttl_minutes * 60),
            retention: Duration::from_secs(30 * 24 * 60 * 60),
        }
    }

    fn limits(visitor_fetches_per_hour: u32) -> LimitsConfig {
        LimitsConfig {
            org_repositories: 1000,
            visitor_fetches_per_hour,
        }
    }

    impl Setup {
        /// Makes the stub answer each request with `respond`.
        fn answer(
            &self,
            respond: impl Fn(&Request<()>) -> Result<Response<Bytes>, github::Error>
            + Send
            + Sync
            + 'static,
        ) {
            *self.respond.lock().unwrap() = Box::new(respond);
        }

        /// Makes GitHub take 200 ms to answer, so that requests overlap. The database
        /// connections they need are opened first: opening one takes long enough in a debug
        /// build that an overlap could be over before a request reads the cache.
        async fn overlap(&self) {
            self.delay.store(200, Ordering::Relaxed);
            let pool = self.db.get_postgres_connection_pool();
            let mut connections = Vec::new();
            for _ in 0..12 {
                connections.push(pool.acquire().await.unwrap());
            }
        }

        /// Waits for a request spawned before to lead a fetch, so that the next one waits
        /// for it. How long a spawned request takes to start varies with the load on the
        /// machine.
        async fn leading(&self) {
            let deadline = Instant::now() + Duration::from_secs(10);
            while self.cache.flights().is_empty() {
                assert!(Instant::now() < deadline, "no request leads a fetch");
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        }

        fn alice(&self) -> Viewer {
            Viewer::TokenUser {
                user_id: self.alice,
                pat: Secret::new("pat-alice".to_owned()),
            }
        }

        fn bob(&self) -> Viewer {
            Viewer::TokenUser {
                user_id: self.bob,
                pat: Secret::new("pat-bob".to_owned()),
            }
        }

        async fn get(
            &self,
            viewer: &Viewer,
            path: &Path,
            now: DateTimeUtc,
        ) -> Result<Outcome<Value>, Error> {
            self.cache.get_at(viewer, DASHBOARD, path, now).await
        }

        /// A `get` that can be spawned, at the real time.
        fn spawn_get(
            &self,
            viewer: Viewer,
            path: &Path,
        ) -> impl Future<Output = Result<Outcome<Value>, Error>> + Send + 'static {
            let cache = self.cache.clone();
            let path = path.clone();
            async move { cache.get(&viewer, DASHBOARD, &path).await }
        }

        /// The `Authorization` of every request GitHub got.
        fn sent(&self) -> Vec<String> {
            self.stub
                .requests()
                .iter()
                .map(|(_, headers)| {
                    sent_header(headers, AUTHORIZATION)
                        .unwrap_or_default()
                        .to_owned()
                })
                .collect()
        }

        async fn rows(&self) -> Vec<cache_entry::Model> {
            cache_entry::Entity::find()
                .order_by_asc(cache_entry::Column::Id)
                .all(&self.db)
                .await
                .unwrap()
        }
    }

    fn signed_in(token: &str) -> Viewer {
        Viewer::SignedIn {
            sign_in: Secret::new(token.to_owned()),
        }
    }

    /// A visitor who reaches BuhTig directly from a public address.
    fn visitor() -> Viewer {
        visitor_from("203.0.113.1")
    }

    fn visitor_from(address: &str) -> Viewer {
        Viewer::Visitor(Visitor::of(address.parse().unwrap(), &HeaderMap::new()))
    }

    fn path(segments: &[&str]) -> Path {
        Path::new(segments.iter().copied()).unwrap()
    }

    /// `minutes` after a fixed time.
    fn at(minutes: i64) -> DateTimeUtc {
        "2026-10-21T12:00:00Z".parse::<DateTimeUtc>().unwrap() + TimeDelta::minutes(minutes)
    }

    fn header(request: &Request<()>, name: impl axum::http::header::AsHeaderName) -> Option<&str> {
        request.headers().get(name)?.to_str().ok()
    }

    fn sent_header(
        headers: &HeaderMap,
        name: impl axum::http::header::AsHeaderName,
    ) -> Option<&str> {
        headers.get(name)?.to_str().ok()
    }

    fn data<T: fmt::Debug>(result: Result<Outcome<T>, Error>) -> Cached<T> {
        match result {
            Ok(Outcome::Data(cached)) => cached,
            other => panic!("no data: {other:?}"),
        }
    }

    fn github_error<T: fmt::Debug>(result: Result<Outcome<T>, Error>) -> github::Error {
        match result {
            Err(Error::GitHub(error)) => error,
            other => panic!("no GitHub error: {other:?}"),
        }
    }

    fn held<T: fmt::Debug>(result: Result<Outcome<T>, Error>) -> Held {
        match result {
            Err(Error::Held(held)) => held,
            other => panic!("not held: {other:?}"),
        }
    }

    /// A primary rate limit that resets in an hour, and when that is.
    fn rate_limited() -> (
        impl Fn(&Request<()>) -> Result<Response<Bytes>, github::Error>,
        DateTimeUtc,
    ) {
        let seconds = (ChronoUtc::now() + TimeDelta::hours(1)).timestamp();
        let reset = seconds.to_string();
        let respond = move |_: &Request<()>| {
            answer(
                403,
                &[
                    ("x-ratelimit-limit", "5000"),
                    ("x-ratelimit-remaining", "0"),
                    ("x-ratelimit-reset", &reset),
                ],
                r#"{"message":"API rate limit exceeded"}"#,
            )
        };
        (respond, DateTime::from_timestamp(seconds, 0).unwrap())
    }

    #[tokio::test]
    async fn fresh_data_is_served_without_asking_github_and_then_revalidated() {
        let setup = setup().await;
        let repo = path(&["repos", "owner", "repo"]);
        setup.answer(|request| match header(request, IF_NONE_MATCH) {
            Some(r#"W/"v1""#) => answer(304, &[], ""),
            _ => answer(200, &[("etag", r#"W/"v1""#)], r#"{"stars":1}"#),
        });
        let first = data(setup.get(&visitor(), &repo, at(0)).await);
        assert_eq!(
            first,
            Cached {
                data: json!({"stars": 1}),
                fetched_at: at(0),
                stale: None
            }
        );

        // Within the TTL.
        assert_eq!(data(setup.get(&visitor(), &repo, at(14)).await), first);
        assert_eq!(setup.stub.requests().len(), 1);

        // After it, conditionally: GitHub confirms the data.
        let confirmed = data(setup.get(&visitor(), &repo, at(16)).await);
        assert_eq!(
            (confirmed.data, confirmed.fetched_at),
            (json!({"stars": 1}), at(16))
        );
        let requests = setup.stub.requests();
        assert_eq!(
            sent_header(&requests[1].1, IF_NONE_MATCH),
            Some(r#"W/"v1""#)
        );
        let rows = setup.rows().await;
        assert_eq!((rows[0].fetched_at, rows[0].expires_at), (at(16), at(31)));

        // Or GitHub has new data, which replaces the old.
        setup.answer(|_| answer(200, &[("etag", r#"W/"v2""#)], r#"{"stars":2}"#));
        let changed = data(setup.get(&visitor(), &repo, at(32)).await);
        assert_eq!(changed.data, json!({"stars": 2}));
        let rows = setup.rows().await;
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].data.clone(), rows[0].etag.as_deref()),
            (json!({"stars": 2}), Some(r#"W/"v2""#))
        );

        // A shorter TTL applies to what is already stored.
        let shorter = Cache::new(
            setup.db.clone(),
            setup.github.clone(),
            &config(5),
            &limits(30),
        );
        let refetched = data(shorter.get_at(&visitor(), DASHBOARD, &repo, at(38)).await);
        assert_eq!(refetched.fetched_at, at(38));
        assert_eq!(setup.stub.requests().len(), 4);
    }

    #[tokio::test]
    async fn data_fetched_without_a_pat_is_shared_and_holds_no_permissions() {
        let setup = setup().await;
        let repo = path(&["repos", "owner", "repo"]);
        setup.answer(|_| {
            answer(
                200,
                &[],
                r#"{"full_name":"owner/repo","private":false,"owner":{"login":"owner"},"permissions":{"admin":true,"push":true}}"#,
            )
        });
        let public =
            json!({"full_name": "owner/repo", "private": false, "owner": {"login": "owner"}});

        let shared = data(setup.get(&visitor(), &repo, at(0)).await);
        assert_eq!(shared.data, public);
        let rows = setup.rows().await;
        assert_eq!(
            (
                rows[0].scope.as_str(),
                rows[0].resource_key.as_str(),
                rows[0].user_id
            ),
            ("shared", "/repos/owner/repo", None)
        );
        assert_eq!(rows[0].data, public);

        // A signed-in user is served the shared data.
        assert_eq!(
            data(setup.get(&signed_in("sign-in-bob"), &repo, at(1)).await),
            shared
        );
        assert_eq!(setup.sent(), [APP]);

        // A token user is not: they fetch with their PAT into their own scope, which keeps
        // what GitHub says about them.
        let alice = data(setup.get(&setup.alice(), &repo, at(1)).await);
        assert_eq!(
            alice.data["permissions"],
            json!({"admin": true, "push": true})
        );
        assert_eq!(setup.sent(), [APP, "Bearer pat-alice"]);
        let rows = setup.rows().await;
        assert_eq!(
            (rows[1].scope.clone(), rows[1].user_id),
            (format!("user:{}", setup.alice), Some(setup.alice))
        );
        assert_eq!(rows[1].data, alice.data);

        // A signed-in user's fetch is shared too, and a visitor is served from it.
        let other = path(&["repos", "owner", "other"]);
        let fetched = data(setup.get(&signed_in("sign-in-bob"), &other, at(1)).await);
        assert_eq!(fetched.data, public);
        assert_eq!(data(setup.get(&visitor(), &other, at(2)).await), fetched);
        assert_eq!(
            setup.sent(),
            [APP, "Bearer pat-alice", "Bearer sign-in-bob"]
        );
        assert_eq!(setup.rows().await[2].scope, "shared");
    }

    #[tokio::test]
    async fn data_fetched_with_a_pat_is_served_only_to_its_user() {
        let setup = setup().await;
        let secret = path(&["repos", "owner", "secret"]);
        setup.answer(|request| match header(request, AUTHORIZATION) {
            Some("Bearer pat-alice") => {
                answer(200, &[], r#"{"full_name":"owner/secret","private":true}"#)
            }
            _ => answer(404, &[], r#"{"message":"Not Found"}"#),
        });
        let alice = data(setup.get(&setup.alice(), &secret, at(0)).await);
        assert_eq!(
            alice.data,
            json!({"full_name": "owner/secret", "private": true})
        );

        // Everyone else asks GitHub with their own credential, and is told it is not there.
        for viewer in [visitor(), signed_in("sign-in-bob"), setup.bob()] {
            assert_eq!(
                github_error(setup.get(&viewer, &secret, at(1)).await),
                github::Error::NotFound,
                "{viewer:?}"
            );
        }
        assert_eq!(
            setup.sent(),
            [
                "Bearer pat-alice",
                APP,
                "Bearer sign-in-bob",
                "Bearer pat-bob"
            ]
        );

        // Alice is still served from her own cache.
        assert_eq!(data(setup.get(&setup.alice(), &secret, at(2)).await), alice);
        assert_eq!(setup.stub.requests().len(), 4);
        let rows = setup.rows().await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].scope, format!("user:{}", setup.alice));
    }

    #[tokio::test]
    async fn data_marked_private_never_enters_the_shared_cache() {
        let setup = setup().await;
        setup.answer(|request| match request.uri().path() {
            "/repos/owner/private" => answer(200, &[], r#"{"name":"private","private":true}"#),
            "/repos/owner/fork" => answer(
                200,
                &[],
                r#"{"name":"fork","private":false,"source":{"name":"upstream","private":true}}"#,
            ),
            _ => answer(
                200,
                &[],
                r#"[{"name":"a","visibility":"public"},{"name":"b","visibility":"internal"}]"#,
            ),
        });
        let (log, _guard) = capture_log();

        for name in ["private", "fork"] {
            let repo = path(&["repos", "owner", name]);
            for viewer in [visitor(), signed_in("sign-in-bob")] {
                // GitHub gave it for this viewer's own credential.
                let fetched = data(setup.get(&viewer, &repo, at(0)).await);
                assert_eq!(fetched.data["name"], name);
            }
        }
        let repos = path(&["orgs", "org", "repos"]);
        for viewer in [visitor(), signed_in("sign-in-bob")] {
            let list = data(
                setup
                    .cache
                    .get_list_at(&viewer, "/org", &repos, 10, at(0))
                    .await,
            );
            assert_eq!(list.data.items.len(), 2);
        }

        assert!(setup.rows().await.is_empty());
        assert_eq!(
            setup.stub.requests().len(),
            6,
            "each viewer had to ask GitHub"
        );
        let log = String::from_utf8(log.lock().unwrap().clone()).unwrap();
        assert_eq!(
            log.matches("marked private or internal").count(),
            6,
            "{log}"
        );

        // Fetched with a PAT, it is cached for that user.
        let private = path(&["repos", "owner", "private"]);
        data(setup.get(&setup.alice(), &private, at(0)).await);
        let rows = setup.rows().await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].scope, format!("user:{}", setup.alice));

        // What was cached while it was public goes once GitHub marks it private.
        let turned = path(&["repos", "owner", "turned"]);
        setup.answer(|_| answer(200, &[], r#"{"name":"turned","private":false}"#));
        data(setup.get(&visitor(), &turned, at(0)).await);
        assert_eq!(setup.rows().await.len(), 2);
        setup.answer(|_| answer(200, &[], r#"{"name":"turned","private":true}"#));
        data(setup.get(&visitor(), &turned, at(16)).await);
        assert_eq!(setup.rows().await, rows);
    }

    #[tokio::test]
    async fn when_github_fails_the_latest_data_is_served_with_its_age() {
        let setup = setup().await;
        let repo = path(&["repos", "owner", "repo"]);
        setup.answer(|_| answer(200, &[("etag", "e")], r#"{"stars":1}"#));
        data(setup.get(&visitor(), &repo, at(0)).await);
        let stale = |error| Cached {
            data: json!({"stars": 1}),
            fetched_at: at(0),
            stale: Some(Stale::GitHub(error)),
        };

        // AC-09.
        setup.answer(|_| Err(github::Error::Unreachable("connection refused".to_owned())));
        assert_eq!(
            data(setup.get(&visitor(), &repo, at(16)).await),
            stale(github::Error::Unreachable("connection refused".to_owned()))
        );
        setup.answer(|_| answer(200, &[], "not json"));
        assert_eq!(
            data(setup.get(&visitor(), &repo, at(16)).await),
            stale(github::Error::Invalid("the body is not JSON".to_owned()))
        );
        setup.answer(|_| answer(502, &[], "<html>Bad gateway</html>"));
        assert_eq!(
            data(setup.get(&visitor(), &repo, at(17)).await),
            stale(github::Error::Status {
                status: 502,
                message: None
            })
        );
        let (respond, until) = rate_limited();
        setup.answer(respond);
        assert_eq!(
            data(setup.get(&visitor(), &repo, at(18)).await),
            stale(github::Error::RateLimited { until })
        );

        // With nothing cached, the error says when the rate limit lifts.
        let other = path(&["repos", "owner", "other"]);
        assert_eq!(
            github_error(setup.get(&signed_in("sign-in-bob"), &other, at(19)).await),
            github::Error::RateLimited { until }
        );
        // A visitor is not let ask, since nothing of visitors' rate limit remains.
        assert_eq!(
            held(setup.get(&visitor(), &other, at(19)).await),
            Held::Reserve { until }
        );
        assert_eq!(setup.stub.requests().len(), 6);
        let rows = setup.rows().await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].fetched_at, at(0));
    }

    #[tokio::test]
    async fn lost_access_deletes_the_entry_and_a_rejected_token_keeps_it() {
        let setup = setup().await;
        let repo = path(&["repos", "owner", "repo"]);
        setup.answer(|_| answer(200, &[], r#"{"stars":1}"#));
        data(setup.get(&visitor(), &repo, at(0)).await);
        data(setup.get(&setup.alice(), &repo, at(0)).await);

        // A rejected token says nothing about the repository, and one user's 403 is
        // about that user's credential.
        setup.answer(|request| match header(request, AUTHORIZATION) {
            Some("Bearer revoked") => answer(401, &[], r#"{"message":"Bad credentials"}"#),
            Some("Bearer blocked") => answer(403, &[], r#"{"message":"Forbidden"}"#),
            Some("Bearer pat-alice") => answer(
                403,
                &[(
                    "x-github-sso",
                    "required; url=https://github.com/orgs/owner/sso",
                )],
                "",
            ),
            _ => answer(404, &[], r#"{"message":"Not Found"}"#),
        });
        assert_eq!(
            github_error(setup.get(&signed_in("revoked"), &repo, at(16)).await),
            github::Error::BadCredentials
        );
        assert!(matches!(
            github_error(setup.get(&signed_in("blocked"), &repo, at(16)).await),
            github::Error::Forbidden { .. }
        ));
        assert_eq!(setup.rows().await.len(), 2);

        // The repository went private: it is gone from the shared cache, and not served
        // from it even while GitHub is down.
        assert_eq!(
            github_error(setup.get(&visitor(), &repo, at(17)).await),
            github::Error::NotFound
        );
        assert!(matches!(
            github_error(setup.get(&setup.alice(), &repo, at(17)).await),
            github::Error::SsoRequired { .. }
        ));
        assert!(setup.rows().await.is_empty());
        setup.answer(|_| Err(github::Error::Unreachable("connection refused".to_owned())));
        assert!(matches!(
            github_error(setup.get(&visitor(), &repo, at(18)).await),
            github::Error::Unreachable(_)
        ));
    }

    #[tokio::test]
    async fn statistics_being_computed_are_not_cached() {
        let setup = setup().await;
        setup.answer(|_| answer(202, &[], "{}"));
        let stats = path(&["repos", "owner", "repo", "stats", "commit_activity"]);
        assert_eq!(
            setup.get(&visitor(), &stats, at(0)).await.unwrap(),
            Outcome::Computing
        );
        assert!(setup.rows().await.is_empty());
    }

    #[tokio::test]
    async fn concurrent_misses_in_one_scope_make_one_request() {
        let setup = setup().await;
        setup.overlap().await;
        setup.answer(|_| answer(200, &[], r#"{"stars":1}"#));
        let repo = path(&["repos", "owner", "repo"]);

        let mut gets = JoinSet::new();
        for _ in 0..10 {
            gets.spawn(setup.spawn_get(visitor(), &repo));
        }
        for result in gets.join_all().await {
            assert_eq!(data(result).data, json!({"stars": 1}));
        }
        assert_eq!(setup.sent(), [APP]);

        // Other scopes and other keys are fetched on their own.
        let other = path(&["repos", "owner", "other"]);
        let third = path(&["repos", "owner", "third"]);
        let mut gets = JoinSet::new();
        gets.spawn(setup.spawn_get(visitor(), &other));
        gets.spawn(setup.spawn_get(setup.alice(), &other));
        gets.spawn(setup.spawn_get(visitor(), &third));
        for result in gets.join_all().await {
            data(result);
        }
        assert_eq!(setup.stub.requests().len(), 4);
        assert!(setup.cache.flights().is_empty());
    }

    #[tokio::test]
    async fn waiting_requests_share_an_outage_but_not_a_rate_limit() {
        let setup = setup().await;
        setup.overlap().await;

        // GitHub is down for everyone.
        setup.answer(|_| Err(github::Error::Unreachable("connection refused".to_owned())));
        let repo = path(&["repos", "owner", "repo"]);
        let leader = tokio::spawn(setup.spawn_get(visitor(), &repo));
        setup.leading().await;
        let follower = setup
            .cache
            .get(&signed_in("sign-in-b"), DASHBOARD, &repo)
            .await;
        for result in [leader.await.unwrap(), follower] {
            assert!(matches!(
                github_error(result),
                github::Error::Unreachable(_)
            ));
        }
        assert_eq!(setup.sent(), [APP]);

        // A rate limit is the leader's own: the follower asks with its own token.
        let (rate_limited, _) = rate_limited();
        setup.answer(move |request| match header(request, AUTHORIZATION) {
            Some("Bearer sign-in-a") => rate_limited(request),
            _ => answer(200, &[], r#"{"stars":1}"#),
        });
        let other = path(&["repos", "owner", "other"]);
        let leader = tokio::spawn(setup.spawn_get(signed_in("sign-in-a"), &other));
        setup.leading().await;
        let follower = setup
            .cache
            .get(&signed_in("sign-in-b"), DASHBOARD, &other)
            .await;
        assert!(matches!(
            github_error(leader.await.unwrap()),
            github::Error::RateLimited { .. }
        ));
        assert_eq!(data(follower).data, json!({"stars": 1}));
        assert_eq!(setup.sent(), [APP, "Bearer sign-in-a", "Bearer sign-in-b"]);
        assert!(setup.cache.flights().is_empty());
    }

    #[tokio::test]
    async fn data_marked_private_is_not_handed_to_waiting_requests() {
        let setup = setup().await;
        setup.overlap().await;
        setup.answer(|request| match header(request, AUTHORIZATION) {
            Some("Bearer sign-in-a") => answer(200, &[], r#"{"name":"secret","private":true}"#),
            _ => answer(404, &[], r#"{"message":"Not Found"}"#),
        });
        let repo = path(&["repos", "owner", "secret"]);
        let leader = tokio::spawn(setup.spawn_get(signed_in("sign-in-a"), &repo));
        setup.leading().await;
        let follower = setup.cache.get(&visitor(), DASHBOARD, &repo).await;
        assert_eq!(data(leader.await.unwrap()).data["name"], "secret");
        assert_eq!(github_error(follower), github::Error::NotFound);
        assert_eq!(setup.sent(), ["Bearer sign-in-a", APP]);
    }

    #[tokio::test]
    async fn a_cancelled_fetch_hands_over_to_a_waiting_request() {
        let setup = setup().await;
        setup.overlap().await;
        setup.answer(|_| answer(200, &[], r#"{"stars":1}"#));
        let repo = path(&["repos", "owner", "repo"]);

        let leader = tokio::spawn(tokio::time::timeout(
            Duration::from_millis(100),
            setup.spawn_get(visitor(), &repo),
        ));
        tokio::time::sleep(Duration::from_millis(50)).await;
        let follower = setup.cache.get(&visitor(), DASHBOARD, &repo).await;
        assert!(
            leader.await.unwrap().is_err(),
            "the leader was not cancelled"
        );
        assert_eq!(data(follower).data, json!({"stars": 1}));
        assert_eq!(setup.stub.requests().len(), 1);
        assert!(setup.cache.flights().is_empty());
    }

    #[tokio::test]
    async fn signed_in_users_may_refresh_a_dashboard_once_a_minute() {
        let setup = setup().await;
        let cache = &setup.cache;
        let repo = path(&["repos", "owner", "repo"]);
        setup.answer(|request| match header(request, IF_NONE_MATCH) {
            Some("e") => answer(304, &[], ""),
            _ => answer(200, &[("etag", "e")], r#"{"stars":1}"#),
        });
        assert_eq!(
            cache.refresh_at(&visitor(), DASHBOARD, at(0)),
            Err(Refused::SignInRequired)
        );
        data(setup.get(&visitor(), &repo, at(0)).await);
        data(setup.get(&setup.alice(), &repo, at(0)).await);

        // The shared data is asked for again, conditionally, though it is fresh. Alice's
        // own is not.
        assert_eq!(
            cache.refresh_at(&signed_in("sign-in-bob"), "/Owner/Repo", at(1)),
            Ok(())
        );
        assert_eq!(
            data(setup.get(&visitor(), &repo, at(1)).await).fetched_at,
            at(1)
        );
        assert_eq!(
            data(setup.get(&setup.alice(), &repo, at(1)).await).fetched_at,
            at(0)
        );
        assert_eq!(setup.sent(), [APP, "Bearer pat-alice", APP]);
        assert_eq!(
            sent_header(&setup.stub.requests()[2].1, IF_NONE_MATCH),
            Some("e")
        );
        data(setup.get(&visitor(), &repo, at(1)).await);
        assert_eq!(setup.stub.requests().len(), 3, "refreshed once");

        // Not again within the minute, by anyone in that scope.
        let half = at(1) + TimeDelta::seconds(30);
        assert_eq!(
            cache.refresh_at(&signed_in("sign-in-carol"), DASHBOARD, half),
            Err(Refused::TooSoon { until: at(2) })
        );

        // Alice's scope is refreshed on its own.
        assert_eq!(cache.refresh_at(&setup.alice(), DASHBOARD, half), Ok(()));
        assert_eq!(
            data(setup.get(&setup.alice(), &repo, half).await).fetched_at,
            half
        );
        assert_eq!(setup.sent()[3], "Bearer pat-alice");

        assert_eq!(
            cache.refresh_at(&signed_in("sign-in-bob"), DASHBOARD, at(2)),
            Ok(())
        );
    }

    #[tokio::test]
    async fn lists_are_cached_with_their_limit() {
        let setup = setup().await;
        setup.answer(|_| answer(200, &[], r#"[{"name":"a"},{"name":"b"},{"name":"c"}]"#));
        let repos = path(&["orgs", "org", "repos"]).query("sort", "pushed");
        let visitor = visitor();
        let get_list = |limit, now| {
            setup
                .cache
                .get_list_at(&visitor, "/org", &repos, limit, now)
        };

        let two = data(get_list(2, at(0)).await);
        assert_eq!(
            two.data,
            List {
                items: vec![json!({"name": "a"}), json!({"name": "b"})],
                truncated: true
            }
        );
        assert_eq!(data(get_list(2, at(1)).await), two);
        assert_eq!(setup.stub.requests().len(), 1);

        let five = data(get_list(5, at(1)).await);
        assert_eq!((five.data.items.len(), five.data.truncated), (3, false));
        // The same path read as one resource is cached apart.
        let one = data(setup.cache.get_at(&visitor, "/org", &repos, at(1)).await);
        assert_eq!(one.data.as_array().map(Vec::len), Some(3));
        assert_eq!(setup.stub.requests().len(), 3);
        let keys: Vec<String> = setup
            .rows()
            .await
            .into_iter()
            .map(|row| row.resource_key)
            .collect();
        assert_eq!(
            keys,
            [
                "/orgs/org/repos?sort=pushed limit=2",
                "/orgs/org/repos?sort=pushed limit=5",
                "/orgs/org/repos?sort=pushed",
            ]
        );

        // A stored list that is not one counts as missing.
        cache_entry::Entity::update_many()
            .col_expr(
                cache_entry::Column::Data,
                Expr::value(json!({"items": "none"})),
            )
            .filter(cache_entry::Column::ResourceKey.eq("/orgs/org/repos?sort=pushed limit=2"))
            .exec(&setup.db)
            .await
            .unwrap();
        assert_eq!(data(get_list(2, at(2)).await).data, two.data);
        assert_eq!(setup.stub.requests().len(), 4);
    }

    #[tokio::test]
    async fn a_random_repository_is_a_public_one_read_whole() {
        let setup = setup().await;
        let cache = &setup.cache;
        let store = |scope, key: &'static str, data: Value| async move {
            cache.store(scope, key, &data, None, at(0)).await;
        };
        assert_eq!(cache.random_repository().await.unwrap(), None);

        // Not an account, part of a repository, a list, or a repository that only a token
        // user may see.
        store(
            Scope::Shared,
            "/users/acme",
            json!({"login": "acme", "type": "Organization"}),
        )
        .await;
        store(
            Scope::Shared,
            "/repos/owner/repo/languages",
            json!({"Rust": 100}),
        )
        .await;
        store(
            Scope::Shared,
            "/orgs/acme/repos?sort=pushed limit=1000",
            json!({"items": [{"full_name": "acme/widget"}], "truncated": false}),
        )
        .await;
        store(
            Scope::User(setup.alice),
            "/repos/owner/secret",
            json!({"full_name": "owner/secret", "private": true}),
        )
        .await;
        assert_eq!(cache.random_repository().await.unwrap(), None);

        // Each repository may come up, named as GitHub names it.
        store(
            Scope::Shared,
            "/repos/Owner/Repo",
            json!({"full_name": "owner/repo", "private": false}),
        )
        .await;
        store(
            Scope::Shared,
            "/repos/acme/widget",
            json!({"full_name": "acme/widget", "private": false}),
        )
        .await;
        let mut names = HashSet::new();
        for _ in 0..64 {
            names.insert(cache.random_repository().await.unwrap().unwrap());
        }
        assert_eq!(
            names,
            HashSet::from(["owner/repo".to_owned(), "acme/widget".to_owned()])
        );
    }

    #[tokio::test]
    async fn a_visitor_over_the_limit_is_served_from_the_cache_only() {
        let setup = setup().await;
        setup.answer(|_| answer(200, &[], r#"{"stars":1}"#));
        let limited = Cache::new(
            setup.db.clone(),
            setup.github.clone(),
            &config(15),
            &limits(2),
        );
        let cache = &limited;
        let get = move |viewer: Viewer, name: &'static str, now: DateTimeUtc| async move {
            let repo = path(&["repos", "owner", name]);
            cache
                .get_at(&viewer, &format!("/owner/{name}"), &repo, now)
                .await
        };

        // Cached by a signed-in user, which costs no visitor anything.
        data(get(signed_in("sign-in-bob"), "seeded", at(0)).await);

        // A visitor loads two dashboards, each with more than one fetch.
        for name in ["a", "b"] {
            data(get(visitor(), name, at(1)).await);
            let languages = path(&["repos", "owner", name, "languages"]);
            let dashboard = format!("/owner/{name}");
            data(
                limited
                    .get_at(&visitor(), &dashboard, &languages, at(2))
                    .await,
            );
        }
        assert_eq!(setup.stub.requests().len(), 5);

        // A third is held back, until an hour after the first.
        let until = Some(at(61));
        assert_eq!(
            held(get(visitor(), "c", at(3)).await),
            Held::Quota { until }
        );
        // What is cached is served all the same: fresh, and older with its age.
        assert_eq!(data(get(visitor(), "a", at(3)).await).stale, None);
        let seeded = data(get(visitor(), "seeded", at(16)).await);
        assert_eq!(
            (seeded.fetched_at, seeded.stale),
            (at(0), Some(Stale::Held(Held::Quota { until })))
        );
        assert_eq!(setup.stub.requests().len(), 5);
        assert!(limited.flights().is_empty());

        // Another visitor, and a signed-in user, still ask GitHub.
        data(get(visitor_from("203.0.113.2"), "c", at(16)).await);
        data(get(signed_in("sign-in-bob"), "d", at(16)).await);
        assert_eq!(setup.stub.requests().len(), 7);

        // An hour after the first load, the visitor may make another.
        data(get(visitor(), "e", at(61)).await);
        assert_eq!(setup.stub.requests().len(), 8);
    }

    #[tokio::test]
    async fn visitors_are_served_from_the_cache_only_while_their_rate_limit_runs_low() {
        let setup = setup().await;
        // In real time, since the client drops readings that have reset.
        let seconds = (ChronoUtc::now() + TimeDelta::hours(1)).timestamp();
        let until = DateTime::from_timestamp(seconds, 0).unwrap();
        let remaining = move |remaining: u32| {
            move |_: &Request<()>| {
                answer(
                    200,
                    &[
                        ("x-ratelimit-limit", "5000"),
                        ("x-ratelimit-remaining", &remaining.to_string()),
                        ("x-ratelimit-reset", &seconds.to_string()),
                    ],
                    r#"{"stars":1}"#,
                )
            }
        };
        let repo = |name: &str| path(&["repos", "owner", name]);

        // Exactly a tenth remaining is enough.
        setup.answer(remaining(500));
        data(setup.get(&visitor(), &repo("a"), at(0)).await);
        data(setup.get(&visitor(), &repo("b"), at(0)).await);
        // Less is not. Once a visitor is held back, no answer could tell of more.
        setup.answer(remaining(499));
        data(setup.get(&visitor(), &repo("c"), at(0)).await);
        assert_eq!(setup.stub.requests().len(), 3);
        let reserve = Held::Reserve { until };
        assert_eq!(
            held(setup.get(&visitor(), &repo("d"), at(1)).await),
            reserve
        );

        // What is cached is served all the same: fresh, and older with its age.
        assert_eq!(
            data(setup.get(&visitor(), &repo("a"), at(1)).await).stale,
            None
        );
        let stale = data(setup.get(&visitor(), &repo("a"), at(16)).await);
        assert_eq!(
            (stale.fetched_at, stale.stale),
            (at(0), Some(Stale::Held(reserve)))
        );
        assert_eq!(setup.stub.requests().len(), 3);
        assert!(setup.cache.flights().is_empty());

        // Signed-in users ask GitHub with their own credential, and visitors are then
        // served what they fetched.
        data(
            setup
                .get(&signed_in("sign-in-bob"), &repo("d"), at(16))
                .await,
        );
        assert_eq!(
            data(setup.get(&visitor(), &repo("d"), at(17)).await).fetched_at,
            at(16)
        );
        assert_eq!(setup.stub.requests().len(), 4);
    }
}
