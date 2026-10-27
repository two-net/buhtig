//! Sessions (SRS §4.5): which signed-in user a browser belongs to, so that their requests
//! carry their own credential rather than a visitor's (FR-DATA-02). The UI asks who is
//! viewing so as to show "Sign in" or the user's avatar menu (UI-02), and their own
//! history, pins and settings ([`crate::shortcuts`], [`crate::tokens`]).
//!
//! A session's ID is 256 random bits in the session cookie, and the database keeps only
//! its hash (DR-02), so that what the database holds signs no one in. Each sign-in starts
//! a session with a new ID (NFR-SEC-01). A session ends after `auth.session_idle_timeout`
//! without use, and in any case `auth.session_max_age` after sign-in (FR-AUTH-06), or
//! when the user signs out (FR-AUTH-07). Housekeeping deletes those that end on their own.
//!
//! A user is signed out everywhere once the credential they signed in with is of no more
//! use: when GitHub rejects it (FR-AUTH-09), or when it cannot be decrypted because
//! `security.encryption_key` changed (DR-03). So is a user whom `access.allowed_users` no
//! longer lists (FR-AUTH-08).
//!
//! A signed-in user's requests carry their PAT while they have a valid one, and their
//! sign-in credential otherwise (FR-PAT-06). A PAT that has expired, or cannot be decrypted
//! because `security.encryption_key` changed, is marked invalid as it is found, for the user
//! to replace (DR-03, [`crate::tokens`]).

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::extract::{Extension, FromRequestParts};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
use sea_orm::sea_query::prelude::chrono::TimeDelta;
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{
    ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, Set, TransactionTrait,
};
use serde_json::json;
use tracing::{error, info};

use crate::cache::Viewer;
use crate::config::Secret;
use crate::cookies;
use crate::crypto::{self, Sealer};
use crate::entity::credential::{self, Kind, PatStatus};
use crate::entity::{session, user};
use crate::tokens;
use crate::visitors::Visitor;

/// The session cookie, which every request of BuhTig's carries.
const COOKIE: &str = "buhtig_session";

/// How far a session's `last_used_at` may lag behind its last use. Writing it on every
/// request would cost a write for each of a dashboard's widgets.
const TOUCH_INTERVAL: TimeDelta = TimeDelta::minutes(1);

/// What sessions need from the config file.
pub struct Settings {
    pub idle_timeout: Duration,
    pub max_age: Duration,
    /// Lowercase GitHub logins; empty means anyone may sign in (FR-AUTH-08).
    pub allowed_users: BTreeSet<String>,
    /// Whether browsers reach BuhTig over HTTPS, so that its cookies can be `Secure`
    /// (NFR-SEC-01). They do but on `http://localhost` (IF-04), where Safari would not
    /// keep a `Secure` cookie.
    pub secure: bool,
}

pub struct Sessions {
    db: DatabaseConnection,
    sealer: Arc<Sealer>,
    settings: Settings,
}

/// A GitHub user, as GitHub describes them at sign-in.
#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    pub github_id: i64,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
}

/// A signed-in user, the credential they signed in with, and their PAT.
pub struct SignedIn {
    pub user: user::Model,
    pub sign_in: Secret<String>,
    /// Their PAT's row, if they have saved one, which tells what Settings shows of it.
    pub pat: Option<credential::Model>,
    /// Their PAT itself, while it is valid (FR-PAT-06).
    pub token: Option<Secret<String>>,
}

impl Sessions {
    /// Sessions whose credentials `sealer` seals, as it does PATs ([`crate::tokens`]).
    pub fn new(db: DatabaseConnection, sealer: Arc<Sealer>, settings: Settings) -> Sessions {
        Sessions {
            db,
            sealer,
            settings,
        }
    }

    /// Whether the GitHub user `login` may sign in (FR-AUTH-08). Logins ignore case.
    pub fn allows(&self, login: &str) -> bool {
        let allowed = &self.settings.allowed_users;
        allowed.is_empty() || allowed.contains(&login.to_ascii_lowercase())
    }

    /// Whether BuhTig's cookies are `Secure`.
    pub fn secure(&self) -> bool {
        self.settings.secure
    }

    /// Signs the GitHub user `profile` in, with the `token` GitHub issued them, on the
    /// browser that sent `headers`. Returns the `Set-Cookie` of their new session.
    ///
    /// The user is created on their first sign-in, by their GitHub ID, and their login,
    /// name and avatar are refreshed on every one (FR-AUTH-04). The token is kept
    /// encrypted (DR-03), in place of the one before. The session the browser had, if any,
    /// ends: each sign-in gets a new ID (NFR-SEC-01).
    pub async fn sign_in(
        &self,
        profile: Profile,
        token: &Secret<String>,
        headers: &HeaderMap,
    ) -> Result<HeaderValue, DbErr> {
        self.sign_in_at(profile, token, headers, ChronoUtc::now())
            .await
    }

    async fn sign_in_at(
        &self,
        profile: Profile,
        token: &Secret<String>,
        headers: &HeaderMap,
        now: DateTimeUtc,
    ) -> Result<HeaderValue, DbErr> {
        let txn = self.db.begin().await?;
        let user = user::ActiveModel {
            github_id: Set(profile.github_id),
            login: Set(profile.login),
            name: Set(profile.name),
            avatar_url: Set(profile.avatar_url),
            created_at: Set(now),
            last_sign_in_at: Set(now),
            ..Default::default()
        };
        let user_id = user::Entity::insert(user)
            .on_conflict(
                OnConflict::column(user::Column::GithubId)
                    .update_columns([
                        user::Column::Login,
                        user::Column::Name,
                        user::Column::AvatarUrl,
                        user::Column::LastSignInAt,
                    ])
                    .to_owned(),
            )
            .exec(&txn)
            .await?
            .last_insert_id;

        let credential = credential::ActiveModel {
            user_id: Set(user_id),
            kind: Set(Kind::SignIn),
            encrypted_value: Set(self
                .sealer
                .seal(token.expose().as_bytes(), &sign_in_context(user_id))),
            ..Default::default()
        };
        credential::Entity::insert(credential)
            .on_conflict(
                OnConflict::columns([credential::Column::UserId, credential::Column::Kind])
                    .update_column(credential::Column::EncryptedValue)
                    .to_owned(),
            )
            .exec(&txn)
            .await?;

        if let Some(old) = cookies::get(headers, COOKIE) {
            session::Entity::delete_by_id(id_hash(old))
                .exec(&txn)
                .await?;
        }
        let id = crypto::random_id();
        let session = session::ActiveModel {
            id_hash: Set(id_hash(&id)),
            user_id: Set(user_id),
            created_at: Set(now),
            last_used_at: Set(now),
            expires_at: Set(after(now, self.settings.max_age).unwrap_or(DateTimeUtc::MAX_UTC)),
        };
        session::Entity::insert(session).exec(&txn).await?;
        txn.commit().await?;
        Ok(cookies::set(
            COOKIE,
            &id,
            "/",
            self.settings.max_age,
            self.settings.secure,
        ))
    }

    /// The signed-in user whose session a request carries, unless it has ended. Using a
    /// session keeps it from ending for another `auth.session_idle_timeout`.
    pub async fn resolve(&self, headers: &HeaderMap) -> Result<Option<SignedIn>, DbErr> {
        self.resolve_at(headers, ChronoUtc::now()).await
    }

    async fn resolve_at(
        &self,
        headers: &HeaderMap,
        now: DateTimeUtc,
    ) -> Result<Option<SignedIn>, DbErr> {
        let Some(id) = cookies::get(headers, COOKIE) else {
            return Ok(None);
        };
        let id_hash = id_hash(id);
        let Some(session) = session::Entity::find_by_id(id_hash.clone())
            .one(&self.db)
            .await?
        else {
            return Ok(None);
        };
        if self.has_ended(&session, now) {
            session::Entity::delete_by_id(id_hash)
                .exec(&self.db)
                .await?;
            return Ok(None);
        }
        // Deleting the user deletes their sessions too, so this is missing only if that
        // happened since the read above.
        let Some(user) = user::Entity::find_by_id(session.user_id)
            .one(&self.db)
            .await?
        else {
            return Ok(None);
        };
        if !self.allows(&user.login) {
            info!(
                user_id = user.id,
                "signed a user out: access.allowed_users no longer lists them"
            );
            end_all(&self.db, user.id).await?;
            return Ok(None);
        }
        let credentials = credential::Entity::find()
            .filter(credential::Column::UserId.eq(user.id))
            .all(&self.db)
            .await?;
        let of_kind = |kind| {
            credentials
                .iter()
                .find(|credential| credential.kind == kind)
        };
        let credential = of_kind(Kind::SignIn);
        let sign_in =
            credential.and_then(|credential| self.open(credential, &sign_in_context(user.id)));
        let Some(sign_in) = sign_in else {
            // Missing only if the user was signed out everywhere since the read above.
            if credential.is_some() {
                info!(
                    user_id = user.id,
                    "signed a user out: their sign-in credential cannot be decrypted, as \
                     after a change of security.encryption_key"
                );
            }
            end_all(&self.db, user.id).await?;
            return Ok(None);
        };
        let mut pat = of_kind(Kind::Pat).cloned();
        let token = match pat.as_mut() {
            Some(pat) if pat.status == Some(PatStatus::Valid) => {
                let token = self.usable(pat, user.id, now);
                if token.is_none() {
                    tokens::invalidate(&self.db, pat.id).await?;
                    pat.status = Some(PatStatus::Invalid);
                }
                token
            }
            _ => None,
        };
        if session.last_used_at + TOUCH_INTERVAL <= now {
            session::Entity::update_many()
                .col_expr(session::Column::LastUsedAt, Expr::value(now))
                .filter(session::Column::IdHash.eq(id_hash))
                .exec(&self.db)
                .await?;
        }
        Ok(Some(SignedIn {
            user,
            sign_in,
            pat,
            token,
        }))
    }

    /// The token that `credential` holds, if it opens for `context`.
    fn open(&self, credential: &credential::Model, context: &[u8]) -> Option<Secret<String>> {
        let token = self.sealer.open(&credential.encrypted_value, context)?;
        String::from_utf8(token).ok().map(Secret::new)
    }

    /// The PAT `pat` of the user `user_id`, which is marked valid, unless it has expired or
    /// cannot be decrypted: it is then of no more use, until the user replaces it.
    fn usable(
        &self,
        pat: &credential::Model,
        user_id: i64,
        now: DateTimeUtc,
    ) -> Option<Secret<String>> {
        if pat.expires_at.is_some_and(|expires_at| expires_at <= now) {
            info!(
                user_id,
                "a personal access token expired; it is marked invalid"
            );
            return None;
        }
        let token = self.open(pat, &tokens::context(user_id));
        if token.is_none() {
            info!(
                user_id,
                "a personal access token cannot be decrypted, as after a change of \
                 security.encryption_key; it is marked invalid"
            );
        }
        token
    }

    /// Whether a session has ended (FR-AUTH-06), as housekeeping tells: past its
    /// `expires_at`, or by the current settings, which may have been shortened since it
    /// began.
    fn has_ended(&self, session: &session::Model, now: DateTimeUtc) -> bool {
        let ends = |at, duration| after(at, duration).is_some_and(|end| end <= now);
        session.expires_at <= now
            || ends(session.last_used_at, self.settings.idle_timeout)
            || ends(session.created_at, self.settings.max_age)
    }

    /// Ends the session that a request carries, if any (FR-AUTH-07).
    pub async fn sign_out(&self, headers: &HeaderMap) -> Result<(), DbErr> {
        if let Some(id) = cookies::get(headers, COOKIE) {
            session::Entity::delete_by_id(id_hash(id))
                .exec(&self.db)
                .await?;
        }
        Ok(())
    }

    /// The `Set-Cookie` that removes the session cookie from the browser.
    pub fn removal(&self) -> HeaderValue {
        cookies::remove(COOKIE, "/", self.settings.secure)
    }
}

/// Signs the user `user_id` out everywhere: ends all their sessions, and forgets the
/// credential they signed in with, which is of no more use. They sign in again for a new
/// one. All else of theirs stays.
pub async fn end_all(db: &DatabaseConnection, user_id: i64) -> Result<(), DbErr> {
    let txn = db.begin().await?;
    session::Entity::delete_many()
        .filter(session::Column::UserId.eq(user_id))
        .exec(&txn)
        .await?;
    credential::Entity::delete_many()
        .filter(credential::Column::UserId.eq(user_id))
        .filter(credential::Column::Kind.eq(Kind::SignIn))
        .exec(&txn)
        .await?;
    txn.commit().await
}

/// What the database keeps of a session ID (DR-02). The ID is random enough that a hash
/// needs no salt.
fn id_hash(id: &str) -> Vec<u8> {
    crypto::sha256(id.as_bytes())
}

/// What the sign-in credential of the user `user_id` is sealed for, so that it opens for
/// no other row.
fn sign_in_context(user_id: i64) -> Vec<u8> {
    format!("credentials/{user_id}/sign_in").into_bytes()
}

/// `duration` after `at`, or `None` if that is past any time BuhTig can store.
fn after(at: DateTimeUtc, duration: Duration) -> Option<DateTimeUtc> {
    at.checked_add_signed(TimeDelta::from_std(duration).ok()?)
}

/// Who a request is from: the signed-in user whose session it carries, or else a visitor.
/// It needs the [`Sessions`] as an extension of the request, as [`crate::web::router`]
/// adds them, and the peer's address, as a [`Visitor`] does.
///
/// A request that has been told already, as by private mode's gate ([`crate::access`]),
/// carries its viewer as an extension, so that its session is read once.
impl<S: Send + Sync> FromRequestParts<S> for Viewer {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Viewer, Response> {
        if let Some(viewer) = parts.extensions.get::<Viewer>() {
            return Ok(viewer.clone());
        }
        let Extension(sessions) = Extension::<Arc<Sessions>>::from_request_parts(parts, state)
            .await
            .map_err(IntoResponse::into_response)?;
        match sessions.resolve(&parts.headers).await {
            Ok(Some(SignedIn {
                user,
                sign_in,
                pat,
                token,
            })) => Ok(match pat.zip(token) {
                Some((pat, token)) => Viewer::TokenUser {
                    user_id: user.id,
                    credential_id: pat.id,
                    pat: token,
                    sign_in,
                },
                None => Viewer::SignedIn {
                    user_id: user.id,
                    sign_in,
                },
            }),
            Ok(None) => Visitor::from_request_parts(parts, state)
                .await
                .map(Viewer::Visitor)
                .map_err(IntoResponse::into_response),
            Err(error) => {
                error!("cannot read the session: {error}");
                Err(status(StatusCode::SERVICE_UNAVAILABLE))
            }
        }
    }
}

/// `/-/api/session`: `{"user": null, "token": null}` for a visitor. For a signed-in user,
/// `{"user": {"login": …, "name": … or null, "avatar_url": …}, "token": … or null}`: the
/// user as GitHub described them when they last signed in, and what Settings shows of their
/// PAT, as [`tokens::describe`] gives it, if they have saved one.
pub async fn current(
    Extension(sessions): Extension<Arc<Sessions>>,
    headers: HeaderMap,
) -> Response {
    match sessions.resolve(&headers).await {
        Ok(signed_in) => {
            let user = signed_in.as_ref().map(|SignedIn { user, .. }| {
                json!({
                    "login": user.login,
                    "name": user.name,
                    "avatar_url": user.avatar_url,
                })
            });
            let token = signed_in
                .as_ref()
                .and_then(|signed_in| signed_in.pat.as_ref())
                .map(tokens::describe);
            respond(json!({ "user": user, "token": token }))
        }
        Err(error) => {
            error!("cannot read the session: {error}");
            status(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

fn respond(body: serde_json::Value) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

fn status(status: StatusCode) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use axum::extract::ConnectInfo;
    use axum::http::Request;
    use url::Url;

    use sea_orm::SqlxPostgresConnector;
    use sea_orm::sqlx::postgres::PgPoolOptions;

    use super::*;
    use crate::config::DatabaseConfig;
    use crate::db;
    use crate::test_cluster::cluster;

    const KEY: &[u8] = b"a secret of at least thirty-two bytes";

    const DAY: i64 = 24 * 60;

    /// `minutes` after the first sign-in of these tests.
    fn at(minutes: i64) -> DateTimeUtc {
        "2026-10-20T12:00:00Z".parse::<DateTimeUtc>().unwrap() + TimeDelta::minutes(minutes)
    }

    fn settings(allowed_users: &[&str]) -> Settings {
        Settings {
            idle_timeout: Duration::from_secs(7 * 24 * 60 * 60),
            max_age: Duration::from_secs(30 * 24 * 60 * 60),
            allowed_users: allowed_users
                .iter()
                .map(|login| login.to_string())
                .collect(),
            secure: true,
        }
    }

    /// A database of its own.
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

    fn sessions(db: &DatabaseConnection, key: &[u8], settings: Settings) -> Sessions {
        Sessions::new(db.clone(), Arc::new(Sealer::new(key)), settings)
    }

    fn mona() -> Profile {
        Profile {
            github_id: 583231,
            login: "Mona".to_owned(),
            name: Some("Mona Lisa".to_owned()),
            avatar_url: "https://avatars.githubusercontent.com/u/583231".to_owned(),
        }
    }

    fn token(value: &str) -> Secret<String> {
        Secret::new(value.to_owned())
    }

    /// The headers of a request that carries the cookie that `set_cookie` sets.
    fn carrying(set_cookie: &HeaderValue) -> HeaderMap {
        let cookie = set_cookie.to_str().unwrap().split(';').next().unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_str(cookie).unwrap());
        headers
    }

    /// The session ID that `set_cookie` sets.
    fn id(set_cookie: &HeaderValue) -> String {
        let cookie = set_cookie.to_str().unwrap().split(';').next().unwrap();
        cookie.strip_prefix("buhtig_session=").unwrap().to_owned()
    }

    async fn rows(db: &DatabaseConnection) -> Vec<session::Model> {
        session::Entity::find().all(db).await.unwrap()
    }

    async fn sign_in_credentials(db: &DatabaseConnection) -> Vec<credential::Model> {
        credential::Entity::find()
            .filter(credential::Column::Kind.eq(Kind::SignIn))
            .all(db)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn sign_in_keeps_only_a_hash_of_the_session_and_the_token_encrypted() {
        let db = database().await;
        let sessions = sessions(&db, KEY, settings(&[]));
        let cookie = sessions
            .sign_in_at(mona(), &token("gho_mona"), &HeaderMap::new(), at(0))
            .await
            .unwrap();
        let id = id(&cookie);
        assert_eq!(id.len(), 43);
        assert!(cookie.is_sensitive());
        assert_eq!(
            cookie.to_str().unwrap(),
            format!("buhtig_session={id}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure")
        );

        let users = user::Entity::find().all(&db).await.unwrap();
        assert_eq!(users.len(), 1);
        let user = &users[0];
        assert_eq!(
            (user.github_id, user.login.as_str(), user.name.as_deref()),
            (583231, "Mona", Some("Mona Lisa"))
        );
        assert_eq!((user.created_at, user.last_sign_in_at), (at(0), at(0)));

        let rows = rows(&db).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id_hash, crypto::sha256(id.as_bytes()));
        assert_eq!(rows[0].user_id, user.id);
        assert_eq!(
            (rows[0].created_at, rows[0].last_used_at, rows[0].expires_at),
            (at(0), at(0), at(30 * DAY))
        );

        let credentials = sign_in_credentials(&db).await;
        assert_eq!(credentials.len(), 1);
        let sealed = &credentials[0].encrypted_value;
        assert!(!sealed.windows(8).any(|window| window == b"gho_mona"));
        assert_eq!(
            Sealer::new(KEY).open(sealed, &sign_in_context(user.id)),
            Some(b"gho_mona".to_vec())
        );

        let signed_in = sessions
            .resolve_at(&carrying(&cookie), at(1))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(signed_in.user, *user);
        assert_eq!(signed_in.sign_in.expose(), "gho_mona");
    }

    #[tokio::test]
    async fn each_sign_in_refreshes_the_user_and_starts_a_new_session() {
        let db = database().await;
        let sessions = sessions(&db, KEY, settings(&[]));
        let first = sessions
            .sign_in_at(mona(), &token("gho_first"), &HeaderMap::new(), at(0))
            .await
            .unwrap();
        let elsewhere = sessions
            .sign_in_at(mona(), &token("gho_first"), &HeaderMap::new(), at(1))
            .await
            .unwrap();
        // Mona renamed her account, and took her name off it, since.
        let renamed = Profile {
            login: "mona-lisa".to_owned(),
            name: None,
            avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4".to_owned(),
            ..mona()
        };
        let second = sessions
            .sign_in_at(renamed, &token("gho_second"), &carrying(&first), at(10))
            .await
            .unwrap();
        assert_ne!(id(&first), id(&second));

        let users = user::Entity::find().all(&db).await.unwrap();
        assert_eq!(users.len(), 1);
        let user = &users[0];
        assert_eq!(
            (
                user.login.as_str(),
                user.name.as_deref(),
                user.avatar_url.as_str()
            ),
            (
                "mona-lisa",
                None,
                "https://avatars.githubusercontent.com/u/583231?v=4"
            )
        );
        assert_eq!((user.created_at, user.last_sign_in_at), (at(0), at(10)));

        // The browser's old session ended. The one on another browser goes on, with the
        // new token, which is the only one kept.
        assert!(
            sessions
                .resolve_at(&carrying(&first), at(11))
                .await
                .unwrap()
                .is_none()
        );
        for cookie in [&second, &elsewhere] {
            let signed_in = sessions
                .resolve_at(&carrying(cookie), at(11))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(signed_in.sign_in.expose(), "gho_second");
        }
        assert_eq!(rows(&db).await.len(), 2);
        assert_eq!(sign_in_credentials(&db).await.len(), 1);
    }

    #[tokio::test]
    async fn sessions_end_when_idle_and_at_their_maximum_age() {
        let db = database().await;
        let sessions = sessions(&db, KEY, settings(&[]));
        let resolves = async |cookie: &HeaderValue, minutes| {
            sessions
                .resolve_at(&carrying(cookie), at(minutes))
                .await
                .unwrap()
                .is_some()
        };

        // Used every 6 days, a session lasts 30.
        let used = sessions
            .sign_in_at(mona(), &token("gho_mona"), &HeaderMap::new(), at(0))
            .await
            .unwrap();
        for days in [6, 12, 18, 24] {
            assert!(resolves(&used, days * DAY).await, "{days} days");
        }
        assert!(resolves(&used, 30 * DAY - 1).await);
        assert!(!resolves(&used, 30 * DAY).await);

        // Unused for 7 days, it ends.
        let idle = sessions
            .sign_in_at(mona(), &token("gho_mona"), &HeaderMap::new(), at(0))
            .await
            .unwrap();
        assert!(!resolves(&idle, 7 * DAY).await);

        // Settings shortened since sign-in apply at once.
        let shortened = sessions_with_max_age(&db, Duration::from_secs(24 * 60 * 60));
        let older = sessions
            .sign_in_at(mona(), &token("gho_mona"), &HeaderMap::new(), at(0))
            .await
            .unwrap();
        assert!(
            shortened
                .resolve_at(&carrying(&older), at(DAY))
                .await
                .unwrap()
                .is_none()
        );

        // Ended sessions are deleted as they are found.
        assert!(rows(&db).await.is_empty());
    }

    fn sessions_with_max_age(db: &DatabaseConnection, max_age: Duration) -> Sessions {
        sessions(
            db,
            KEY,
            Settings {
                max_age,
                ..settings(&[])
            },
        )
    }

    #[tokio::test]
    async fn use_is_recorded_at_most_once_a_minute() {
        let db = database().await;
        let sessions = sessions(&db, KEY, settings(&[]));
        let cookie = sessions
            .sign_in_at(mona(), &token("gho_mona"), &HeaderMap::new(), at(0))
            .await
            .unwrap();
        let last_used = async |now| {
            sessions
                .resolve_at(&carrying(&cookie), now)
                .await
                .unwrap()
                .unwrap();
            rows(&db).await[0].last_used_at
        };
        assert_eq!(last_used(at(0) + TimeDelta::seconds(59)).await, at(0));
        assert_eq!(last_used(at(1)).await, at(1));
        assert_eq!(last_used(at(1) + TimeDelta::seconds(30)).await, at(1));
        assert_eq!(last_used(at(5)).await, at(5));
    }

    #[tokio::test]
    async fn signing_out_ends_the_session_at_once() {
        let db = database().await;
        let sessions = sessions(&db, KEY, settings(&[]));
        let here = sessions
            .sign_in_at(mona(), &token("gho_mona"), &HeaderMap::new(), at(0))
            .await
            .unwrap();
        let elsewhere = sessions
            .sign_in_at(mona(), &token("gho_mona"), &HeaderMap::new(), at(0))
            .await
            .unwrap();
        sessions.sign_out(&carrying(&here)).await.unwrap();
        assert!(
            sessions
                .resolve_at(&carrying(&here), at(1))
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            sessions
                .resolve_at(&carrying(&elsewhere), at(1))
                .await
                .unwrap()
                .is_some()
        );
        // Without a session, there is nothing to end.
        sessions.sign_out(&HeaderMap::new()).await.unwrap();
        assert_eq!(
            sessions.removal(),
            "buhtig_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"
        );
    }

    #[tokio::test]
    async fn a_new_encryption_key_signs_everyone_out() {
        let db = database().await;
        let cookie = sessions(&db, KEY, settings(&[]))
            .sign_in_at(mona(), &token("gho_mona"), &HeaderMap::new(), at(0))
            .await
            .unwrap();
        let rekeyed = sessions(&db, b"another secret of thirty-two bytes", settings(&[]));
        assert!(
            rekeyed
                .resolve_at(&carrying(&cookie), at(1))
                .await
                .unwrap()
                .is_none()
        );
        assert!(rows(&db).await.is_empty());
        assert!(sign_in_credentials(&db).await.is_empty());
        assert_eq!(user::Entity::find().all(&db).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn users_no_longer_allowed_are_signed_out() {
        let db = database().await;
        let cookie = sessions(&db, KEY, settings(&["mona"]))
            .sign_in_at(mona(), &token("gho_mona"), &HeaderMap::new(), at(0))
            .await
            .unwrap();
        let narrowed = sessions(&db, KEY, settings(&["hubot"]));
        assert!(
            narrowed
                .resolve_at(&carrying(&cookie), at(1))
                .await
                .unwrap()
                .is_none()
        );
        assert!(rows(&db).await.is_empty());
        assert!(sign_in_credentials(&db).await.is_empty());
    }

    #[test]
    fn allowed_users_are_told_apart_ignoring_case() {
        let db = DatabaseConnection::default();
        let anyone = sessions(&db, KEY, settings(&[]));
        assert!(anyone.allows("Mona") && anyone.allows("hubot"));
        let some = sessions(&db, KEY, settings(&["mona", "octo-cat"]));
        assert!(some.allows("Mona") && some.allows("MONA") && some.allows("Octo-Cat"));
        assert!(!some.allows("hubot") && !some.allows("mona-lisa"));
    }

    /// Who `headers` say a request from 203.0.113.1 is from.
    async fn viewer(sessions: Sessions, headers: HeaderMap) -> Result<Viewer, Response> {
        let mut request = Request::new(());
        *request.headers_mut() = headers;
        request.extensions_mut().insert(Arc::new(sessions));
        request.extensions_mut().insert(ConnectInfo(
            "203.0.113.1:4711".parse::<SocketAddr>().unwrap(),
        ));
        let (mut parts, ()) = request.into_parts();
        Viewer::from_request_parts(&mut parts, &()).await
    }

    #[tokio::test]
    async fn requests_without_a_session_are_a_visitors() {
        let sessions = sessions(&DatabaseConnection::default(), KEY, settings(&[]));
        let viewer = viewer(sessions, HeaderMap::new()).await.unwrap();
        assert_eq!(format!("{viewer:?}"), "Visitor(Visitor(203.0.113.1))");
    }

    /// A database that cannot be reached, which every query fails on at once.
    fn unreachable_database() -> DatabaseConnection {
        let pool = PgPoolOptions::new()
            .acquire_timeout(Duration::from_secs(1))
            .connect_lazy("postgres://buhtig@127.0.0.1:1/buhtig")
            .unwrap();
        SqlxPostgresConnector::from_sqlx_postgres_pool(pool)
    }

    #[tokio::test]
    async fn requests_whose_session_cannot_be_read_are_refused() {
        let sessions = sessions(&unreachable_database(), KEY, settings(&[]));
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_static("buhtig_session=x"));
        let response = viewer(sessions, headers).await.unwrap_err();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn requests_with_a_session_are_the_signed_in_users() {
        let db = database().await;
        let sessions = sessions(&db, KEY, settings(&[]));
        let cookie = sessions
            .sign_in(mona(), &token("gho_mona"), &HeaderMap::new())
            .await
            .unwrap();
        let user_id = user::Entity::find().one(&db).await.unwrap().unwrap().id;
        match viewer(sessions, carrying(&cookie)).await.unwrap() {
            Viewer::SignedIn {
                user_id: signed_in,
                sign_in,
            } => {
                assert_eq!(signed_in, user_id);
                assert_eq!(sign_in.expose(), "gho_mona");
            }
            other => panic!("{other:?}"),
        }
    }

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

    fn ok(body: &str) -> (StatusCode, String, String) {
        (StatusCode::OK, "no-store".to_owned(), body.to_owned())
    }

    #[tokio::test]
    async fn the_ui_is_told_who_is_viewing() {
        let db = database().await;
        let sessions = Arc::new(sessions(&db, KEY, settings(&[])));
        let cookie = sessions
            .sign_in(mona(), &token("gho_mona"), &HeaderMap::new())
            .await
            .unwrap();
        let current =
            async |headers| parts(current(Extension(sessions.clone()), headers).await).await;

        assert_eq!(
            current(HeaderMap::new()).await,
            ok(r#"{"token":null,"user":null}"#)
        );
        assert_eq!(
            current(carrying(&cookie)).await,
            ok(
                r#"{"token":null,"user":{"avatar_url":"https://avatars.githubusercontent.com/u/583231","login":"Mona","name":"Mona Lisa"}}"#
            )
        );
    }

    /// Saves a classic PAT, sealed as `sealed`, for the user `user_id`.
    async fn save_pat(
        db: &DatabaseConnection,
        user_id: i64,
        sealed: Vec<u8>,
        expires_at: Option<DateTimeUtc>,
    ) -> credential::Model {
        use crate::entity::credential::PatType;
        use sea_orm::ActiveModelTrait;

        credential::Entity::delete_many()
            .filter(credential::Column::Kind.eq(Kind::Pat))
            .exec(db)
            .await
            .unwrap();
        credential::ActiveModel {
            user_id: Set(user_id),
            kind: Set(Kind::Pat),
            encrypted_value: Set(sealed),
            pat_type: Set(Some(PatType::Classic)),
            last_four: Set(Some("mona".to_owned())),
            scopes: Set(Some(json!(["repo"]))),
            expires_at: Set(expires_at),
            status: Set(Some(PatStatus::Valid)),
            last_validated_at: Set(Some(at(0))),
            ..Default::default()
        }
        .insert(db)
        .await
        .unwrap()
    }

    async fn pat_status(db: &DatabaseConnection) -> Option<PatStatus> {
        credential::Entity::find()
            .filter(credential::Column::Kind.eq(Kind::Pat))
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .status
    }

    #[tokio::test]
    async fn a_valid_pat_is_what_the_users_requests_carry() {
        let db = database().await;
        let cookie = sessions(&db, KEY, settings(&[]))
            .sign_in(mona(), &token("gho_mona"), &HeaderMap::new())
            .await
            .unwrap();
        let user_id = user::Entity::find().one(&db).await.unwrap().unwrap().id;
        let sealed = Sealer::new(KEY).seal(b"ghp_mona", &tokens::context(user_id));
        let pat = save_pat(&db, user_id, sealed, None).await;

        match viewer(sessions(&db, KEY, settings(&[])), carrying(&cookie))
            .await
            .unwrap()
        {
            Viewer::TokenUser {
                user_id: signed_in,
                credential_id,
                pat: token,
                sign_in,
            } => {
                assert_eq!((signed_in, credential_id), (user_id, pat.id));
                assert_eq!(
                    (token.expose().as_str(), sign_in.expose().as_str()),
                    ("ghp_mona", "gho_mona")
                );
            }
            other => panic!("{other:?}"),
        }

        // The UI is told what Settings shows of it, and never the token.
        let sessions = Arc::new(sessions(&db, KEY, settings(&[])));
        let (status, _, body) = parts(current(Extension(sessions), carrying(&cookie)).await).await;
        assert_eq!(status, StatusCode::OK);
        let body: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(body["token"], tokens::describe(&pat));
        assert_eq!(body["token"]["last_four"], "mona");
        assert!(!body.to_string().contains("ghp_mona"));
    }

    #[tokio::test]
    async fn pats_that_expired_or_cannot_be_decrypted_are_marked_invalid() {
        let db = database().await;
        let sessions = sessions(&db, KEY, settings(&[]));
        let cookie = sessions
            .sign_in_at(mona(), &token("gho_mona"), &HeaderMap::new(), at(0))
            .await
            .unwrap();
        let user_id = user::Entity::find().one(&db).await.unwrap().unwrap().id;
        let resolve = async |minutes| {
            sessions
                .resolve_at(&carrying(&cookie), at(minutes))
                .await
                .unwrap()
                .expect("still signed in")
        };
        let sealed = || Sealer::new(KEY).seal(b"ghp_mona", &tokens::context(user_id));

        // Until it expires, the PAT is used.
        save_pat(&db, user_id, sealed(), Some(at(10))).await;
        assert_eq!(resolve(9).await.token.unwrap().expose(), "ghp_mona");
        // Then it is not, and the user is asked to replace it.
        let expired = resolve(10).await;
        assert!(expired.token.is_none());
        assert_eq!(expired.pat.unwrap().status, Some(PatStatus::Invalid));
        assert_eq!(pat_status(&db).await, Some(PatStatus::Invalid));
        assert!(resolve(11).await.token.is_none());

        // DR-03: sealed with another key, or for another row, it cannot be decrypted.
        for sealed in [
            Sealer::new(b"another secret of thirty-two bytes")
                .seal(b"ghp_mona", &tokens::context(user_id)),
            Sealer::new(KEY).seal(b"ghp_mona", &tokens::context(user_id + 1)),
        ] {
            save_pat(&db, user_id, sealed, None).await;
            let undecryptable = resolve(20).await;
            assert!(undecryptable.token.is_none());
            assert_eq!(undecryptable.pat.unwrap().status, Some(PatStatus::Invalid));
            assert_eq!(pat_status(&db).await, Some(PatStatus::Invalid));
        }
        // The user stays signed in with the credential they signed in with.
        assert_eq!(resolve(21).await.sign_in.expose(), "gho_mona");
    }
}
