//! Personal access tokens (SRS §4.6). A signed-in user may save one PAT in Settings, so that
//! BuhTig reads GitHub with it on their behalf and sees what it can, private and internal
//! data too (FR-PAT-01, FR-PAT-06). No one needs one to use BuhTig.
//!
//! Before a PAT is saved, GitHub is asked whose it is: it must be valid, and the signed-in
//! user's own (FR-PAT-02). It is then kept encrypted with `security.encryption_key`, as the
//! sign-in credential is (DR-03), and only the server reads it again, to call GitHub
//! (NFR-SEC-05). The UI is told only what Settings shows of it (FR-PAT-04).
//!
//! Data fetched with a PAT goes to its user's private cache, and each entry names the PAT
//! that fetched it (FR-DATA-04). Replacing or removing the PAT deletes its row, and the
//! database deletes those entries with it, at once (FR-PAT-05). Once GitHub rejects a PAT,
//! it is marked invalid and its data deleted, and the user's requests go with their sign-in
//! credential until they replace it (FR-PAT-07).
//!
//! Each client may have at most 10 tokens checked a minute (NFR-SEC-08), so that BuhTig
//! cannot be used to try out tokens.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Extension, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
use sea_orm::sea_query::prelude::chrono::{SecondsFormat, TimeDelta};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use serde_json::{Value, json};
use tracing::{error, info, warn};

use crate::config::Secret;
use crate::crypto::Sealer;
use crate::entity::credential::{self, Kind, PatStatus, PatType};
use crate::entity::{cache_entry, user};
use crate::github;
use crate::session::Sessions;
use crate::throttle::Throttle;
use crate::visitors::Visitor;

/// The longest token BuhTig takes. GitHub's are well under it.
const MAX_LENGTH: usize = 255;

/// How many tokens each client may have checked in [`CHECK_WINDOW`] (NFR-SEC-08).
const CHECKS: usize = 10;

const CHECK_WINDOW: TimeDelta = TimeDelta::minutes(1);

pub struct Tokens {
    db: DatabaseConnection,
    sealer: Arc<Sealer>,
    github: Arc<github::Client>,
    checks: Throttle,
}

/// Why a token was not saved.
#[derive(Debug)]
enum Refusal {
    /// It is no PAT (FR-PAT-03), so GitHub was not asked about it.
    NotAToken,
    /// The client has had too many tokens checked, and may try again at `until`
    /// (NFR-SEC-08).
    TooMany {
        until: DateTimeUtc,
    },
    /// GitHub does not take it, as one revoked or expired (FR-PAT-02).
    Rejected,
    /// It is another GitHub account's than the user's (FR-PAT-02, AC-04).
    OtherAccount,
    /// GitHub could not say whose it is.
    GitHub(github::Error),
    Database(DbErr),
}

impl From<DbErr> for Refusal {
    fn from(error: DbErr) -> Refusal {
        Refusal::Database(error)
    }
}

impl Refusal {
    fn response(self, now: DateTimeUtc) -> Response {
        let error =
            |error: &str| answer(StatusCode::UNPROCESSABLE_ENTITY, json!({ "error": error }));
        match self {
            Refusal::NotAToken => error("not_a_token"),
            Refusal::Rejected => error("rejected"),
            Refusal::OtherAccount => error("other_account"),
            Refusal::TooMany { until } => {
                let seconds = (until - now).num_seconds().max(1);
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    [
                        (header::CACHE_CONTROL, "no-store".to_owned()),
                        (header::RETRY_AFTER, seconds.to_string()),
                    ],
                )
                    .into_response()
            }
            Refusal::GitHub(error) => {
                warn!("cannot check a personal access token with GitHub: {error}");
                status(StatusCode::BAD_GATEWAY)
            }
            Refusal::Database(error) => {
                error!("cannot save a personal access token: {error}");
                status(StatusCode::SERVICE_UNAVAILABLE)
            }
        }
    }
}

impl Tokens {
    /// Tokens sealed by `sealer`, the [`Sessions`]' own, and checked with `github`.
    pub fn new(db: DatabaseConnection, sealer: Arc<Sealer>, github: Arc<github::Client>) -> Tokens {
        Tokens {
            db,
            sealer,
            github,
            checks: Throttle::new(CHECKS, CHECK_WINDOW),
        }
    }

    /// Saves `token` as the PAT of `user`, as asked by `client` at `now`, in place of the
    /// one before, whose private cache goes with it (FR-PAT-05). Returns the new row.
    async fn save_at(
        &self,
        user: &user::Model,
        client: &Visitor,
        token: &str,
        now: DateTimeUtc,
    ) -> Result<credential::Model, Refusal> {
        let token = token.trim();
        let pat_type = classify(token).ok_or(Refusal::NotAToken)?;
        self.checks
            .admit(client, now)
            .map_err(|until| Refusal::TooMany { until })?;
        let token = Secret::new(token.to_owned());
        let info = match self.github.inspect(&token).await {
            Ok(info) => info,
            Err(github::Error::BadCredentials) => return Err(Refusal::Rejected),
            Err(error) => return Err(Refusal::GitHub(error)),
        };
        if info.user.get("id").and_then(Value::as_i64) != Some(user.github_id) {
            info!(
                user_id = user.id,
                "refused a personal access token of another GitHub account"
            );
            return Err(Refusal::OtherAccount);
        }

        let value = token.expose();
        let txn = self.db.begin().await?;
        // Deleted rather than updated, so that the new row has a new ID: data that a
        // fetch with the old token brings back cannot be stored under it.
        credential::Entity::delete_many()
            .filter(credential::Column::UserId.eq(user.id))
            .filter(credential::Column::Kind.eq(Kind::Pat))
            .exec(&txn)
            .await?;
        let pat = credential::ActiveModel {
            user_id: Set(user.id),
            kind: Set(Kind::Pat),
            encrypted_value: Set(self.sealer.seal(value.as_bytes(), &context(user.id))),
            pat_type: Set(Some(pat_type)),
            // ASCII, as `classify` checked.
            last_four: Set(Some(value[value.len().saturating_sub(4)..].to_owned())),
            scopes: Set(info.scopes.map(|scopes| json!(scopes))),
            expires_at: Set(info.expires_at),
            status: Set(Some(PatStatus::Valid)),
            last_validated_at: Set(Some(now)),
            ..Default::default()
        }
        .insert(&txn)
        .await?;
        txn.commit().await?;
        info!(user_id = user.id, "saved a personal access token");
        Ok(pat)
    }

    /// Removes the PAT of the user `user_id`, if they have one, and its private cache with
    /// it (FR-PAT-05).
    async fn remove(&self, user_id: i64) -> Result<(), DbErr> {
        let removed = credential::Entity::delete_many()
            .filter(credential::Column::UserId.eq(user_id))
            .filter(credential::Column::Kind.eq(Kind::Pat))
            .exec(&self.db)
            .await?;
        if removed.rows_affected > 0 {
            info!(user_id, "removed a personal access token");
        }
        Ok(())
    }
}

/// What kind of PAT `token` is, by GitHub's prefixes (FR-PAT-03): `github_pat_` for a
/// fine-grained one, and `ghp_` for a classic one, or 40 hexadecimal digits for a classic
/// one made before GitHub gave tokens prefixes. `None` for anything else, such as another
/// kind of GitHub token, which GitHub need not be asked about.
fn classify(token: &str) -> Option<PatType> {
    let has = |prefix: &str| token.len() > prefix.len() && token.starts_with(prefix);
    if token.len() > MAX_LENGTH
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        None
    } else if has("github_pat_") {
        Some(PatType::FineGrained)
    } else if has("ghp_")
        || (token.len() == 40 && token.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        Some(PatType::Classic)
    } else {
        None
    }
}

/// What the PAT of the user `user_id` is sealed for, so that it opens for no other row.
pub fn context(user_id: i64) -> Vec<u8> {
    format!("credentials/{user_id}/pat").into_bytes()
}

/// What Settings shows of a PAT (FR-PAT-04), never the token itself:
///
/// ```json
/// {"type": "classic" | "fine_grained", "last_four": "abcd",
///  "scopes": ["repo", …] | null, "expires_at": … | null, "status": "valid" | "invalid",
///  "last_validated_at": …}
/// ```
///
/// `scopes` are a classic token's, as GitHub reported them, and `null` for a fine-grained
/// token, whose permissions GitHub does not report. `expires_at` is `null` for a token that
/// never expires. Times are as `fetched_at` is told (FR-DATA-06).
pub fn describe(pat: &credential::Model) -> Value {
    let iso = |at: DateTimeUtc| at.to_rfc3339_opts(SecondsFormat::Millis, true);
    json!({
        "type": pat.pat_type.map(|pat_type| match pat_type {
            PatType::Classic => "classic",
            PatType::FineGrained => "fine_grained",
        }),
        "last_four": pat.last_four,
        "scopes": pat.scopes,
        "expires_at": pat.expires_at.map(iso),
        "status": match pat.status {
            Some(PatStatus::Valid) => "valid",
            Some(PatStatus::Invalid) | None => "invalid",
        },
        "last_validated_at": pat.last_validated_at.map(iso),
    })
}

/// Marks the PAT `credential_id` invalid, as when GitHub rejects it (FR-PAT-07), or it can
/// no longer be decrypted (DR-03), and deletes the data fetched with it. Its user's requests
/// go with their sign-in credential from then on, until they replace it.
pub async fn invalidate(db: &DatabaseConnection, credential_id: i64) -> Result<(), DbErr> {
    let txn = db.begin().await?;
    credential::Entity::update_many()
        .set(credential::ActiveModel {
            status: Set(Some(PatStatus::Invalid)),
            ..Default::default()
        })
        .filter(credential::Column::Id.eq(credential_id))
        .filter(credential::Column::Kind.eq(Kind::Pat))
        .exec(&txn)
        .await?;
    cache_entry::Entity::delete_many()
        .filter(cache_entry::Column::CredentialId.eq(credential_id))
        .exec(&txn)
        .await?;
    txn.commit().await
}

/// `PUT /-/api/token` with `{"token": "…"}`: saves the signed-in user's PAT, in place of the
/// one before, once GitHub has said that it is valid and theirs (FR-PAT-02). It answers what
/// Settings shows of it, as [`describe`] gives it.
///
/// 401 for a visitor. 422 with `{"error": …}` for a token not saved: `not_a_token` for what
/// is no PAT (FR-PAT-03), `rejected` for one that GitHub does not take, as one revoked or
/// expired, and `other_account` for another GitHub account's (AC-04). 429 once the client
/// has had 10 tokens checked in a minute (NFR-SEC-08), with when it may try again. 502 when
/// GitHub cannot tell now.
///
/// It changes state, so it is no GET (NFR-SEC-02). Other sites' requests carry no session
/// cookie, which is `SameSite=Lax`, and a browser asks BuhTig before it sends another site's
/// PUT of JSON, which BuhTig never allows.
pub async fn save(
    State(tokens): State<Arc<Tokens>>,
    Extension(sessions): Extension<Arc<Sessions>>,
    client: Visitor,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let user = match signed_in(&sessions, &headers).await {
        Ok(user) => user,
        Err(response) => return response,
    };
    let token = body
        .get("token")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let now = ChronoUtc::now();
    match tokens.save_at(&user, &client, token, now).await {
        Ok(pat) => answer(StatusCode::OK, describe(&pat)),
        Err(refusal) => refusal.response(now),
    }
}

/// `DELETE /-/api/token`: removes the signed-in user's PAT, if they have one, and their
/// private cache with it, at once (FR-PAT-05). 204 once it is gone, and 401 for a visitor.
/// It is protected as [`save`] is.
pub async fn remove(
    State(tokens): State<Arc<Tokens>>,
    Extension(sessions): Extension<Arc<Sessions>>,
    headers: HeaderMap,
) -> Response {
    let user = match signed_in(&sessions, &headers).await {
        Ok(user) => user,
        Err(response) => return response,
    };
    match tokens.remove(user.id).await {
        Ok(()) => status(StatusCode::NO_CONTENT),
        Err(error) => {
            error!("cannot remove a personal access token: {error}");
            status(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

/// The signed-in user whose session a request carries, or the response for a request
/// without one.
async fn signed_in(sessions: &Sessions, headers: &HeaderMap) -> Result<user::Model, Response> {
    match sessions.resolve(headers).await {
        Ok(Some(signed_in)) => Ok(signed_in.user),
        Ok(None) => Err(status(StatusCode::UNAUTHORIZED)),
        Err(error) => {
            error!("cannot read the session: {error}");
            Err(status(StatusCode::SERVICE_UNAVAILABLE))
        }
    }
}

fn answer(status: StatusCode, body: Value) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

fn status(status: StatusCode) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;
    use std::time::Duration;

    use axum::extract::{ConnectInfo, FromRequestParts};
    use axum::http::header::{AUTHORIZATION, COOKIE};
    use axum::http::{HeaderValue, Request};
    use url::Url;

    use super::*;
    use crate::cache::{self, Cache, Outcome, Viewer};
    use crate::config::{CacheConfig, DatabaseConfig, LimitsConfig};
    use crate::db;
    use crate::github::stub::{Stub, answer, client};
    use crate::session::{Profile, Settings};
    use crate::test_cluster::cluster;
    use crate::test_log::capture_log;

    const KEY: &[u8] = b"a secret of at least thirty-two bytes";

    /// Mona's classic token, and her fine-grained one.
    const MONAS: &str = "ghp_monas00000000000000000000000000000abcd";
    const MONAS_FINE: &str = "github_pat_11MONA0000000000_fine000000wxyz";
    /// Bob's token, which Mona must not save as hers.
    const BOBS: &str = "ghp_bobs000000000000000000000000000000bobs";
    /// A token that GitHub no longer takes.
    const REVOKED: &str = "ghp_revoked00000000000000000000000000dead";
    /// What Mona signed in with, which sees no private repository.
    const SIGN_IN: &str = "gho_sign_in";

    /// GitHub as tokens meet it. Mona's tokens see her private repository `mona/secret`,
    /// which is not found for anything else.
    fn github() -> Arc<Stub> {
        Stub::new(|request: &Request<_>| {
            let token = request
                .headers()
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "));
            match (request.uri().path(), token) {
                ("/user", Some(MONAS)) => answer(
                    200,
                    &[
                        ("x-oauth-scopes", "repo, read:org"),
                        (
                            "github-authentication-token-expiration",
                            "2026-11-25 12:00:00 UTC",
                        ),
                    ],
                    r#"{"id": 583231, "login": "Mona"}"#,
                ),
                ("/user", Some(MONAS_FINE)) => answer(200, &[], r#"{"id": 583231}"#),
                ("/user", Some(BOBS)) => answer(
                    200,
                    &[("x-oauth-scopes", "")],
                    r#"{"id": 2, "login": "bob"}"#,
                ),
                ("/repos/mona/secret", Some(MONAS | MONAS_FINE)) => {
                    answer(200, &[], r#"{"full_name": "mona/secret", "private": true}"#)
                }
                (_, Some(REVOKED)) => answer(401, &[], r#"{"message": "Bad credentials"}"#),
                _ => answer(404, &[], r#"{"message": "Not Found"}"#),
            }
        })
    }

    /// Mona, signed in, in front of the stub GitHub.
    struct Setup {
        db: DatabaseConnection,
        stub: Arc<Stub>,
        sessions: Arc<Sessions>,
        tokens: Arc<Tokens>,
        cache: Arc<Cache>,
        mona: user::Model,
        /// The headers of Mona's requests, which carry her session.
        signed_in: HeaderMap,
    }

    async fn setup() -> Setup {
        let cluster = cluster();
        let database = cluster.create_database();
        let db = db::connect(&DatabaseConfig {
            url: Secret::new(Url::parse(&cluster.url(&database)).unwrap()),
            max_connections: 5,
        })
        .await
        .unwrap();
        db::migrate(&db).await.unwrap();

        let stub = github();
        let github = Arc::new(client(&stub));
        let sealer = Arc::new(Sealer::new(KEY));
        let sessions = Arc::new(Sessions::new(
            db.clone(),
            sealer.clone(),
            Settings {
                idle_timeout: Duration::from_secs(7 * 24 * 60 * 60),
                max_age: Duration::from_secs(30 * 24 * 60 * 60),
                allowed_users: Default::default(),
                secure: true,
            },
        ));
        let mona = Profile {
            github_id: 583231,
            login: "Mona".to_owned(),
            name: None,
            avatar_url: "https://avatars.githubusercontent.com/u/583231".to_owned(),
        };
        let cookie = sessions
            .sign_in(mona, &Secret::new(SIGN_IN.to_owned()), &HeaderMap::new())
            .await
            .unwrap();
        let mut signed_in = HeaderMap::new();
        let pair = cookie.to_str().unwrap().split(';').next().unwrap();
        signed_in.insert(COOKIE, HeaderValue::from_str(pair).unwrap());
        let mona = user::Entity::find().one(&db).await.unwrap().unwrap();

        Setup {
            tokens: Arc::new(Tokens::new(db.clone(), sealer, github.clone())),
            cache: Arc::new(Cache::new(
                db.clone(),
                github,
                &CacheConfig {
                    ttl: Duration::from_secs(15 * 60),
                    retention: Duration::from_secs(30 * 24 * 60 * 60),
                },
                &LimitsConfig {
                    org_repositories: 1000,
                    visitor_fetches_per_hour: 30,
                },
            )),
            db,
            stub,
            sessions,
            mona,
            signed_in,
        }
    }

    /// The client that requests come from.
    fn from() -> Visitor {
        Visitor::of("203.0.113.1".parse().unwrap(), &HeaderMap::new())
    }

    /// The status of a response, and its body as JSON, `null` if it has none.
    async fn parts(response: Response) -> (StatusCode, Value) {
        let status = response.status();
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = if body.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&body).unwrap()
        };
        (status, body)
    }

    fn refused(error: &str) -> (StatusCode, Value) {
        (StatusCode::UNPROCESSABLE_ENTITY, json!({ "error": error }))
    }

    impl Setup {
        /// Asks to save `body`, with `headers`.
        async fn put(&self, headers: HeaderMap, body: Value) -> (StatusCode, Value) {
            let response = save(
                State(self.tokens.clone()),
                Extension(self.sessions.clone()),
                from(),
                headers,
                Json(body),
            )
            .await;
            parts(response).await
        }

        /// Asks to save `token` as Mona's PAT.
        async fn save(&self, token: &str) -> (StatusCode, Value) {
            self.put(self.signed_in.clone(), json!({ "token": token }))
                .await
        }

        async fn remove(&self, headers: HeaderMap) -> StatusCode {
            let response = remove(
                State(self.tokens.clone()),
                Extension(self.sessions.clone()),
                headers,
            )
            .await;
            parts(response).await.0
        }

        /// Who Mona's requests say she is.
        async fn viewer(&self) -> Viewer {
            let mut request = Request::new(());
            *request.headers_mut() = self.signed_in.clone();
            request.extensions_mut().insert(self.sessions.clone());
            request.extensions_mut().insert(ConnectInfo(
                "203.0.113.1:4711".parse::<SocketAddr>().unwrap(),
            ));
            let (mut parts, ()) = request.into_parts();
            Viewer::from_request_parts(&mut parts, &()).await.unwrap()
        }

        async fn pats(&self) -> Vec<credential::Model> {
            credential::Entity::find()
                .filter(credential::Column::Kind.eq(Kind::Pat))
                .all(&self.db)
                .await
                .unwrap()
        }

        async fn private_entries(&self) -> Vec<cache_entry::Model> {
            cache_entry::Entity::find()
                .filter(cache_entry::Column::UserId.is_not_null())
                .all(&self.db)
                .await
                .unwrap()
        }

        /// Mona's private repository, as `viewer` gets it.
        async fn secret(&self, viewer: &Viewer) -> Result<Outcome<Value>, cache::Error> {
            let path = github::Path::new(["repos", "mona", "secret"]).unwrap();
            self.cache.get(viewer, "/mona/secret", &path).await
        }
    }

    #[test]
    fn only_what_looks_like_a_pat_is_one() {
        let longest = format!("ghp_{}", "a".repeat(MAX_LENGTH - 4));
        for (token, expected) in [
            ("ghp_abc123", Some(PatType::Classic)),
            ("github_pat_11ABC_def", Some(PatType::FineGrained)),
            (
                "0123456789abcdef0123456789ABCDEF01234567",
                Some(PatType::Classic),
            ),
            (&longest, Some(PatType::Classic)),
            // Other kinds of GitHub token.
            ("gho_abc", None),
            ("ghu_abc", None),
            ("ghs_abc", None),
            ("ghr_abc", None),
            // Prefixes alone, and what no token holds.
            ("ghp_", None),
            ("github_pat_", None),
            ("", None),
            ("ghp_abc def", None),
            ("ghp_abc\n", None),
            ("ghp_abc-def", None),
            ("ghp_ünï", None),
            ("0123456789abcdef0123456789abcdef0123456", None),
            ("0123456789abcdef0123456789abcdef0123456g", None),
            ("password", None),
        ] {
            assert_eq!(classify(token), expected, "{token:?}");
        }
        assert_eq!(classify(&format!("{longest}a")), None);
    }

    #[tokio::test]
    async fn a_pat_is_saved_encrypted_once_github_says_it_is_the_users() {
        let setup = setup().await;
        // Pasted with the whitespace around it.
        let (status, mut body) = setup.save(&format!("  {MONAS}\n")).await;
        assert_eq!(status, StatusCode::OK);
        let validated = body
            .as_object_mut()
            .unwrap()
            .remove("last_validated_at")
            .unwrap();
        assert!(validated.as_str().unwrap().parse::<DateTimeUtc>().is_ok());
        assert_eq!(
            body,
            json!({
                "type": "classic",
                "last_four": "abcd",
                "scopes": ["repo", "read:org"],
                "expires_at": "2026-11-25T12:00:00.000Z",
                "status": "valid",
            })
        );

        let pats = setup.pats().await;
        assert_eq!(pats.len(), 1);
        let pat = &pats[0];
        assert_eq!(pat.user_id, setup.mona.id);
        assert!(
            !pat.encrypted_value
                .windows(MONAS.len())
                .any(|window| window == MONAS.as_bytes())
        );
        assert_eq!(
            Sealer::new(KEY).open(&pat.encrypted_value, &context(setup.mona.id)),
            Some(MONAS.as_bytes().to_vec())
        );
        assert_eq!(
            setup.stub.urls(),
            ["https://api.github.com/user"],
            "checked with GitHub"
        );

        // A fine-grained token, whose permissions and expiry GitHub does not tell here.
        let (status, body) = setup.save(MONAS_FINE).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            (
                &body["type"],
                &body["last_four"],
                &body["scopes"],
                &body["expires_at"]
            ),
            (
                &json!("fine_grained"),
                &json!("wxyz"),
                &Value::Null,
                &Value::Null
            )
        );
        assert_eq!(setup.pats().await.len(), 1, "one PAT per user");
    }

    #[tokio::test]
    async fn another_accounts_pat_is_refused_and_nothing_stored() {
        let setup = setup().await;
        // AC-04.
        assert_eq!(setup.save(BOBS).await, refused("other_account"));
        assert!(setup.pats().await.is_empty());

        // Nor does it replace the one before.
        assert_eq!(setup.save(MONAS).await.0, StatusCode::OK);
        let before = setup.pats().await;
        assert_eq!(setup.save(BOBS).await, refused("other_account"));
        assert_eq!(setup.pats().await, before);
    }

    #[tokio::test]
    async fn pats_github_does_not_take_are_refused() {
        let setup = setup().await;
        assert_eq!(setup.save(REVOKED).await, refused("rejected"));
        assert!(setup.pats().await.is_empty());
    }

    #[tokio::test]
    async fn what_is_no_pat_is_refused_without_asking_github() {
        let setup = setup().await;
        for body in [
            json!({ "token": SIGN_IN }),
            json!({ "token": "my password" }),
            json!({ "token": "" }),
            json!({ "token": 42 }),
            json!({}),
            json!([MONAS]),
        ] {
            assert_eq!(
                setup.put(setup.signed_in.clone(), body.clone()).await,
                refused("not_a_token"),
                "{body}"
            );
        }
        assert!(setup.stub.requests().is_empty());
    }

    #[tokio::test]
    async fn each_client_may_have_10_tokens_checked_a_minute() {
        let setup = setup().await;
        let start = ChronoUtc::now();
        let save = async |client: &Visitor, seconds| {
            let at = start + TimeDelta::seconds(seconds);
            setup
                .tokens
                .save_at(&setup.mona, client, REVOKED, at)
                .await
                .map(|_| ())
        };
        let alice = from();
        for second in 0..10 {
            assert!(matches!(save(&alice, second).await, Err(Refusal::Rejected)));
        }
        let until = start + TimeDelta::seconds(60);
        assert!(matches!(
            save(&alice, 30).await,
            Err(Refusal::TooMany { until: at }) if at == until
        ));
        assert_eq!(setup.stub.requests().len(), 10);

        // Another client may, and so may this one once a minute has passed.
        let bob = Visitor::of("203.0.113.2".parse().unwrap(), &HeaderMap::new());
        assert!(matches!(save(&bob, 30).await, Err(Refusal::Rejected)));
        assert!(matches!(save(&alice, 60).await, Err(Refusal::Rejected)));

        // The client is told when it may try again.
        let response = Refusal::TooMany { until }.response(start + TimeDelta::seconds(30));
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()[header::RETRY_AFTER], "30");
    }

    #[tokio::test]
    async fn replacing_or_removing_a_pat_deletes_its_private_cache_at_once() {
        let setup = setup().await;
        // Signed in without a PAT, Mona sees no private repository.
        assert!(matches!(setup.viewer().await, Viewer::SignedIn { .. }));
        assert!(matches!(
            setup.secret(&setup.viewer().await).await,
            Err(cache::Error::GitHub(github::Error::NotFound))
        ));

        // With one, she does, from her private cache.
        setup.save(MONAS).await;
        let classic = setup.viewer().await;
        let Viewer::TokenUser { credential_id, .. } = classic else {
            panic!("{classic:?}");
        };
        assert!(matches!(setup.secret(&classic).await, Ok(Outcome::Data(_))));
        let entries = setup.private_entries().await;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].credential_id, Some(credential_id));

        // Replaced, her PAT takes its private cache with it.
        setup.save(MONAS_FINE).await;
        assert!(setup.private_entries().await.is_empty());
        let fine = setup.viewer().await;
        assert!(matches!(setup.secret(&fine).await, Ok(Outcome::Data(_))));
        assert_eq!(setup.private_entries().await.len(), 1);

        // AC-11: removed, so does it, and the repository is not found again.
        assert_eq!(
            setup.remove(setup.signed_in.clone()).await,
            StatusCode::NO_CONTENT
        );
        assert!(setup.pats().await.is_empty());
        assert!(setup.private_entries().await.is_empty());
        let viewer = setup.viewer().await;
        assert!(matches!(viewer, Viewer::SignedIn { .. }));
        assert!(matches!(
            setup.secret(&viewer).await,
            Err(cache::Error::GitHub(github::Error::NotFound))
        ));
        // Removing what is gone changes nothing.
        assert_eq!(
            setup.remove(setup.signed_in.clone()).await,
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn data_a_pat_fetches_after_it_is_removed_is_not_kept() {
        let setup = setup().await;
        setup.save(MONAS).await;
        // A request that read Mona's PAT before she removed it.
        let before = setup.viewer().await;
        setup.remove(setup.signed_in.clone()).await;

        let (log, _guard) = capture_log();
        // It still gets what GitHub gave it, but the cache keeps none of it.
        assert!(matches!(setup.secret(&before).await, Ok(Outcome::Data(_))));
        assert!(setup.private_entries().await.is_empty());
        let log = String::from_utf8(log.lock().unwrap().clone()).unwrap();
        assert!(!log.contains("ERROR"), "{log}");
    }

    #[tokio::test]
    async fn visitors_have_no_pat_to_save_or_remove() {
        let setup = setup().await;
        assert_eq!(
            setup.put(HeaderMap::new(), json!({ "token": MONAS })).await,
            (StatusCode::UNAUTHORIZED, Value::Null)
        );
        assert_eq!(
            setup.remove(HeaderMap::new()).await,
            StatusCode::UNAUTHORIZED
        );
        assert!(setup.stub.requests().is_empty());
    }

    #[tokio::test]
    async fn no_token_shows_in_what_buhtig_logs_or_answers() {
        let setup = setup().await;
        let (log, _guard) = capture_log();
        let mut answers = Vec::new();
        for token in [MONAS, BOBS, REVOKED, MONAS_FINE] {
            answers.push(setup.save(token).await.1);
        }
        let viewer = setup.viewer().await;
        setup.secret(&viewer).await.unwrap();
        let pats = setup.pats().await;
        setup.remove(setup.signed_in.clone()).await;

        let logged = String::from_utf8(log.lock().unwrap().clone()).unwrap();
        let printed = format!("{logged} {answers:?} {viewer:?} {pats:?}");
        for token in [MONAS, BOBS, REVOKED, MONAS_FINE] {
            assert!(!printed.contains(token), "{token} in {printed}");
        }
        assert!(printed.contains("saved a personal access token"));
    }

    #[tokio::test]
    async fn invalid_pats_are_marked_so_and_lose_their_data() {
        let setup = setup().await;
        setup.save(MONAS).await;
        setup.secret(&setup.viewer().await).await.unwrap();
        let pat = setup.pats().await.remove(0);

        invalidate(&setup.db, pat.id).await.unwrap();
        let invalid = setup.pats().await.remove(0);
        assert_eq!(invalid.status, Some(PatStatus::Invalid));
        assert_eq!(describe(&invalid)["status"], "invalid");
        assert!(setup.private_entries().await.is_empty());
        // Mona's requests go with her sign-in credential again.
        assert!(matches!(setup.viewer().await, Viewer::SignedIn { .. }));
    }
}
