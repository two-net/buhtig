//! Personal shortcuts (SRS §4.8): the dashboards a signed-in user viewed recently, and those
//! they pinned, which the home page offers below the search box, pins first (FR-SRCH-08).
//!
//! A dashboard records a view of itself once GitHub has told it the resource's name, as
//! GitHub spells it (FR-PERS-01). History keeps the resource and when it was last viewed,
//! nothing else, and housekeeping keeps each user's 20 newest entries (FR-DB-08). A user may
//! clear it (FR-PERS-03). They may pin up to 12 dashboards, unpin them (FR-PERS-02), and
//! put their pins in the order they like (FR-PERS-05).
//!
//! GitHub's names ignore letter case, so a dashboard is the same whatever the case of its
//! name, as on the home page. A view replaces the entries of the same dashboard spelled
//! otherwise, and pinning one already pinned only respells it.
//!
//! All of it is for signed-in users alone (FR-ACC-02). What changes state is no GET, and
//! other origins' pages cannot send it ([`crate::security`], NFR-SEC-02).

use std::collections::HashMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
use sea_orm::sea_query::prelude::chrono::SecondsFormat;
use sea_orm::sea_query::{Expr, ExprTrait, Func, IntoColumnRef, OnConflict};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DatabaseTransaction, DbErr, EntityTrait,
    QueryFilter, QueryOrder, QuerySelect, Set, TransactionTrait,
};
use serde_json::{Value, json};
use tracing::error;

use crate::accounts::is_account_name;
use crate::cache::Viewer;
use crate::entity::{ResourceKind, history_entry, pin, user};
use crate::repositories;

/// A dashboard, as history and pins record it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dashboard {
    kind: ResourceKind,
    /// `owner/repo` or `org`.
    name: String,
}

impl Dashboard {
    /// The dashboard that a route's path names, `{owner}/{repo}` or `{org}`, if those can be
    /// GitHub's names (FR-SRCH-04).
    fn at(params: &HashMap<String, String>) -> Option<Dashboard> {
        match (params.get("owner"), params.get("repo"), params.get("org")) {
            (Some(owner), Some(repo), None) => {
                Dashboard::named(ResourceKind::Repository, format!("{owner}/{repo}"))
            }
            (None, None, Some(org)) => Dashboard::named(ResourceKind::Organization, org.clone()),
            _ => None,
        }
    }

    /// The dashboard that the UI names as `{"kind": …, "name": …}`.
    fn from_json(value: &Value) -> Option<Dashboard> {
        let kind = match value.get("kind")?.as_str()? {
            "repository" => ResourceKind::Repository,
            "organization" => ResourceKind::Organization,
            _ => return None,
        };
        Dashboard::named(kind, value.get("name")?.as_str()?.to_owned())
    }

    /// The `kind` dashboard `name`, if that can be one's name.
    fn named(kind: ResourceKind, name: String) -> Option<Dashboard> {
        let valid = match kind {
            ResourceKind::Repository => repositories::names(&name).is_some(),
            ResourceKind::Organization => is_account_name(&name),
        };
        valid.then_some(Dashboard { kind, name })
    }

    /// The condition that `column`, of names, holds this dashboard's, whatever its case.
    fn name_in(&self, column: impl IntoColumnRef) -> Expr {
        Expr::expr(Func::lower(Expr::col(column))).eq(self.name.to_ascii_lowercase())
    }

    /// Whether a row of `kind` and `name` is this dashboard, whatever the case of its name.
    fn is(&self, kind: ResourceKind, name: &str) -> bool {
        kind == self.kind && name.eq_ignore_ascii_case(&self.name)
    }
}

/// Why a dashboard was not pinned.
#[derive(Debug)]
pub enum PinRefused {
    /// The user has pinned as many as they may (FR-PERS-02).
    TooMany,
    Database(DbErr),
}

impl From<DbErr> for PinRefused {
    fn from(error: DbErr) -> PinRefused {
        PinRefused::Database(error)
    }
}

pub struct Shortcuts {
    db: DatabaseConnection,
}

impl Shortcuts {
    pub fn new(db: DatabaseConnection) -> Shortcuts {
        Shortcuts { db }
    }

    /// The pins of the user `user_id`, in their order.
    pub async fn pins(&self, user_id: i64) -> Result<Vec<pin::Model>, DbErr> {
        pins_of(&self.db, user_id).await
    }

    /// The dashboards the user `user_id` viewed recently, newest first. Only as many as
    /// housekeeping keeps, since there may be more until its next pass.
    pub async fn recent(&self, user_id: i64) -> Result<Vec<history_entry::Model>, DbErr> {
        use history_entry::Column;

        history_entry::Entity::find()
            .filter(Column::UserId.eq(user_id))
            .order_by_desc(Column::LastViewedAt)
            .order_by_desc(Column::Id)
            .limit(history_entry::KEPT_PER_USER)
            .all(&self.db)
            .await
    }

    /// Records that the user `user_id` viewed `dashboard` at `now`, in place of any entry
    /// for it spelled otherwise (FR-PERS-01).
    pub async fn record_at(
        &self,
        user_id: i64,
        dashboard: &Dashboard,
        now: DateTimeUtc,
    ) -> Result<(), DbErr> {
        use history_entry::Column;

        let txn = self.db.begin().await?;
        history_entry::Entity::delete_many()
            .filter(Column::UserId.eq(user_id))
            .filter(Column::ResourceKind.eq(dashboard.kind))
            .filter(dashboard.name_in(Column::ResourceName))
            .filter(Column::ResourceName.ne(dashboard.name.as_str()))
            .exec(&txn)
            .await?;
        let entry = history_entry::ActiveModel {
            user_id: Set(user_id),
            resource_kind: Set(dashboard.kind),
            resource_name: Set(dashboard.name.clone()),
            last_viewed_at: Set(now),
            ..Default::default()
        };
        history_entry::Entity::insert(entry)
            .on_conflict(
                OnConflict::columns([Column::UserId, Column::ResourceKind, Column::ResourceName])
                    .update_column(Column::LastViewedAt)
                    .to_owned(),
            )
            .exec_without_returning(&txn)
            .await?;
        txn.commit().await
    }

    /// Forgets every dashboard the user `user_id` viewed (FR-PERS-03). Their pins stay.
    pub async fn clear_history(&self, user_id: i64) -> Result<(), DbErr> {
        history_entry::Entity::delete_many()
            .filter(history_entry::Column::UserId.eq(user_id))
            .exec(&self.db)
            .await?;
        Ok(())
    }

    /// Pins `dashboard` for the user `user_id`, after their other pins, unless they have
    /// pinned as many as they may (FR-PERS-02). A dashboard they pinned already keeps its
    /// place, with its name spelled as now. Answers their pins.
    pub async fn pin(
        &self,
        user_id: i64,
        dashboard: &Dashboard,
    ) -> Result<Vec<pin::Model>, PinRefused> {
        let txn = self.db.begin().await?;
        lock(&txn, user_id).await?;
        let pins = pins_of(&txn, user_id).await?;
        match pins
            .iter()
            .find(|pin| dashboard.is(pin.resource_kind, &pin.resource_name))
        {
            Some(pinned) if pinned.resource_name == dashboard.name => {}
            Some(pinned) => {
                pin::Entity::update_many()
                    .col_expr(
                        pin::Column::ResourceName,
                        Expr::value(dashboard.name.as_str()),
                    )
                    .filter(pin::Column::Id.eq(pinned.id))
                    .exec(&txn)
                    .await?;
            }
            None if pins.len() as u64 >= pin::MAX_PER_USER => return Err(PinRefused::TooMany),
            None => {
                let last = pins.iter().map(|pin| pin.position).max();
                let new = pin::ActiveModel {
                    user_id: Set(user_id),
                    resource_kind: Set(dashboard.kind),
                    resource_name: Set(dashboard.name.clone()),
                    position: Set(last.map_or(0, |last| last + 1)),
                    ..Default::default()
                };
                pin::Entity::insert(new)
                    .exec_without_returning(&txn)
                    .await?;
            }
        }
        let pins = pins_of(&txn, user_id).await?;
        txn.commit().await?;
        Ok(pins)
    }

    /// Unpins `dashboard` for the user `user_id`, if they pinned it, whatever the case of its
    /// name (FR-PERS-02). Answers their pins.
    pub async fn unpin(
        &self,
        user_id: i64,
        dashboard: &Dashboard,
    ) -> Result<Vec<pin::Model>, DbErr> {
        use pin::Column;

        pin::Entity::delete_many()
            .filter(Column::UserId.eq(user_id))
            .filter(Column::ResourceKind.eq(dashboard.kind))
            .filter(dashboard.name_in(Column::ResourceName))
            .exec(&self.db)
            .await?;
        pins_of(&self.db, user_id).await
    }

    /// Puts the pins of the user `user_id` in the order of `order` (FR-PERS-05). Pins it
    /// leaves out follow, in the order they had, and what it names that is not pinned is
    /// passed over, so that a change made elsewhere since the UI last asked is not undone.
    /// Answers their pins.
    pub async fn reorder(
        &self,
        user_id: i64,
        order: &[Dashboard],
    ) -> Result<Vec<pin::Model>, DbErr> {
        let txn = self.db.begin().await?;
        lock(&txn, user_id).await?;
        let mut rest = pins_of(&txn, user_id).await?;
        let mut ordered = Vec::with_capacity(rest.len());
        for dashboard in order {
            if let Some(at) = rest
                .iter()
                .position(|pin| dashboard.is(pin.resource_kind, &pin.resource_name))
            {
                ordered.push(rest.remove(at));
            }
        }
        ordered.append(&mut rest);
        for (position, pin) in (0..).zip(&ordered) {
            if pin.position != position {
                pin::Entity::update_many()
                    .col_expr(pin::Column::Position, Expr::value(position))
                    .filter(pin::Column::Id.eq(pin.id))
                    .exec(&txn)
                    .await?;
            }
        }
        let pins = pins_of(&txn, user_id).await?;
        txn.commit().await?;
        Ok(pins)
    }
}

/// The pins of the user `user_id`, in their order.
async fn pins_of(db: &impl ConnectionTrait, user_id: i64) -> Result<Vec<pin::Model>, DbErr> {
    pin::Entity::find()
        .filter(pin::Column::UserId.eq(user_id))
        .order_by_asc(pin::Column::Position)
        .order_by_asc(pin::Column::Id)
        .all(db)
        .await
}

/// Locks the row of the user `user_id` until `txn` ends, so that their pins change one
/// request at a time: two at once could pin more than they may, or give two pins one place.
async fn lock(txn: &DatabaseTransaction, user_id: i64) -> Result<(), DbErr> {
    user::Entity::find_by_id(user_id)
        .lock_exclusive()
        .one(txn)
        .await?;
    Ok(())
}

/// `GET /-/api/shortcuts`: `{"pins": […], "recent": […]}` for a signed-in user, and 401 for a
/// visitor, who has none (FR-ACC-02). Each item is `{"kind": "repository" | "organization",
/// "name": "owner/repo" | "org"}`, and each recent one also has `"viewed_at"`, when the user
/// last viewed it, as the UI is told times, such as `2026-10-22T12:00:00.123Z`. Pins are in
/// the user's order, and recent dashboards newest first, pinned or not. The UI picks the
/// shortcuts from them (FR-SRCH-08).
pub async fn list(State(shortcuts): State<Arc<Shortcuts>>, viewer: Viewer) -> Response {
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    let pins = match shortcuts.pins(user_id).await {
        Ok(pins) => pins,
        Err(error) => return unavailable("read the pins", error),
    };
    match shortcuts.recent(user_id).await {
        Ok(recent) => answer(
            StatusCode::OK,
            json!({
                "pins": listed(&pins),
                "recent": recent.iter().map(viewed).collect::<Vec<_>>(),
            }),
        ),
        Err(error) => unavailable("read the history", error),
    }
}

/// `POST /-/api/repositories/{owner}/{repo}/view` and `POST /-/api/organizations/{org}/view`:
/// records that the signed-in user viewed the dashboard, which the dashboard asks once its
/// name is as GitHub spells it (FR-PERS-01). 204 once it is, 401 for a visitor, and 400 for
/// names that cannot be GitHub's.
pub async fn view(
    State(shortcuts): State<Arc<Shortcuts>>,
    viewer: Viewer,
    Path(params): Path<HashMap<String, String>>,
) -> Response {
    let Some(dashboard) = Dashboard::at(&params) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    match shortcuts
        .record_at(user_id, &dashboard, ChronoUtc::now())
        .await
    {
        Ok(()) => status(StatusCode::NO_CONTENT),
        Err(error) => unavailable("record a view", error),
    }
}

/// `DELETE /-/api/history`: clears the signed-in user's history (FR-PERS-03). 204 once it
/// is, and 401 for a visitor.
pub async fn clear_history(State(shortcuts): State<Arc<Shortcuts>>, viewer: Viewer) -> Response {
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    match shortcuts.clear_history(user_id).await {
        Ok(()) => status(StatusCode::NO_CONTENT),
        Err(error) => unavailable("clear a history", error),
    }
}

/// `PUT /-/api/repositories/{owner}/{repo}/pin` and `PUT /-/api/organizations/{org}/pin`:
/// pins the dashboard for the signed-in user (FR-PERS-02), and answers `{"pins": […]}`, as
/// [`list`] has them. 409 with `{"error": "too_many_pins"}` if they have pinned 12
/// already, 401 for a visitor, and 400 for names that cannot be GitHub's.
pub async fn pin(
    State(shortcuts): State<Arc<Shortcuts>>,
    viewer: Viewer,
    Path(params): Path<HashMap<String, String>>,
) -> Response {
    let Some(dashboard) = Dashboard::at(&params) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    match shortcuts.pin(user_id, &dashboard).await {
        Ok(pins) => answer(StatusCode::OK, json!({ "pins": listed(&pins) })),
        Err(PinRefused::TooMany) => {
            answer(StatusCode::CONFLICT, json!({ "error": "too_many_pins" }))
        }
        Err(PinRefused::Database(error)) => unavailable("pin a dashboard", error),
    }
}

/// `DELETE /-/api/repositories/{owner}/{repo}/pin` and `DELETE /-/api/organizations/{org}/pin`:
/// unpins the dashboard for the signed-in user, if they pinned it (FR-PERS-02), and answers
/// `{"pins": […]}`. 401 for a visitor, and 400 for names that cannot be GitHub's.
pub async fn unpin(
    State(shortcuts): State<Arc<Shortcuts>>,
    viewer: Viewer,
    Path(params): Path<HashMap<String, String>>,
) -> Response {
    let Some(dashboard) = Dashboard::at(&params) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    match shortcuts.unpin(user_id, &dashboard).await {
        Ok(pins) => answer(StatusCode::OK, json!({ "pins": listed(&pins) })),
        Err(error) => unavailable("unpin a dashboard", error),
    }
}

/// `PUT /-/api/pins` of `{"pins": […]}`, with items as [`list`] has them: puts the signed-in
/// user's pins in that order (FR-PERS-05), as [`Shortcuts::reorder`] does, and answers
/// `{"pins": […]}`. 422 with `{"error": "invalid_pins"}` for a body that is not such a list,
/// and 401 for a visitor.
pub async fn reorder(
    State(shortcuts): State<Arc<Shortcuts>>,
    viewer: Viewer,
    Json(body): Json<Value>,
) -> Response {
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    let order: Option<Vec<Dashboard>> = body
        .get("pins")
        .and_then(Value::as_array)
        .and_then(|pins| pins.iter().map(Dashboard::from_json).collect());
    let Some(order) = order else {
        return answer(
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({ "error": "invalid_pins" }),
        );
    };
    match shortcuts.reorder(user_id, &order).await {
        Ok(pins) => answer(StatusCode::OK, json!({ "pins": listed(&pins) })),
        Err(error) => unavailable("reorder pins", error),
    }
}

fn listed(pins: &[pin::Model]) -> Vec<Value> {
    pins.iter()
        .map(|pin| item(pin.resource_kind, &pin.resource_name))
        .collect()
}

/// A dashboard, as the UI is told of it.
fn item(kind: ResourceKind, name: &str) -> Value {
    let kind = match kind {
        ResourceKind::Repository => "repository",
        ResourceKind::Organization => "organization",
    };
    json!({ "kind": kind, "name": name })
}

/// A dashboard the user viewed, as the UI is told of it, with when they last did, as
/// [`Cached::fetched_at_iso`](crate::cache::Cached::fetched_at_iso) tells times.
fn viewed(entry: &history_entry::Model) -> Value {
    let mut item = item(entry.resource_kind, &entry.resource_name);
    item["viewed_at"] = entry
        .last_viewed_at
        .to_rfc3339_opts(SecondsFormat::Millis, true)
        .into();
    item
}

/// The response to a request that the database failed, as it did to `doing` with `error`.
fn unavailable(doing: &str, error: DbErr) -> Response {
    error!("cannot {doing}: {error}");
    status(StatusCode::SERVICE_UNAVAILABLE)
}

fn answer(status: StatusCode, body: Value) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

fn status(status: StatusCode) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderMap;
    use sea_orm::sea_query::prelude::chrono::TimeDelta;
    use url::Url;

    use super::*;
    use crate::config::{DatabaseConfig, Secret};
    use crate::db;
    use crate::test_cluster::cluster;
    use crate::visitors::Visitor;

    /// `minutes` after the first view of these tests.
    fn at(minutes: i64) -> DateTimeUtc {
        "2026-10-20T12:00:00Z".parse::<DateTimeUtc>().unwrap() + TimeDelta::minutes(minutes)
    }

    fn repository(name: &str) -> Dashboard {
        Dashboard::named(ResourceKind::Repository, name.to_owned()).unwrap()
    }

    fn organization(name: &str) -> Dashboard {
        Dashboard::named(ResourceKind::Organization, name.to_owned()).unwrap()
    }

    /// Shortcuts kept in a database of their own, and the IDs of its two users, Mona and
    /// Hubot.
    async fn setup() -> (Shortcuts, i64, i64) {
        let cluster = cluster();
        let database = cluster.create_database();
        let db = db::connect(&DatabaseConfig {
            url: Secret::new(Url::parse(&cluster.url(&database)).unwrap()),
            max_connections: 5,
        })
        .await
        .unwrap();
        db::migrate(&db).await.unwrap();
        let mut ids = Vec::new();
        for (github_id, login) in [(583231, "mona"), (1, "hubot")] {
            let user = user::ActiveModel {
                github_id: Set(github_id),
                login: Set(login.to_owned()),
                name: Set(None),
                avatar_url: Set(format!(
                    "https://avatars.githubusercontent.com/u/{github_id}"
                )),
                created_at: Set(at(0)),
                last_sign_in_at: Set(at(0)),
                ..Default::default()
            };
            let id = user::Entity::insert(user)
                .exec(&db)
                .await
                .unwrap()
                .last_insert_id;
            ids.push(id);
        }
        (Shortcuts::new(db), ids[0], ids[1])
    }

    /// The dashboards the user `user_id` viewed recently, newest first, as `kind:name`.
    async fn recent(shortcuts: &Shortcuts, user_id: i64) -> Vec<String> {
        shortcuts
            .recent(user_id)
            .await
            .unwrap()
            .iter()
            .map(|entry| named(entry.resource_kind, &entry.resource_name))
            .collect()
    }

    /// The pins of the user `user_id`, in their order, as `kind:name`.
    async fn pins(shortcuts: &Shortcuts, user_id: i64) -> Vec<String> {
        names(&shortcuts.pins(user_id).await.unwrap())
    }

    fn names(pins: &[pin::Model]) -> Vec<String> {
        pins.iter()
            .map(|pin| named(pin.resource_kind, &pin.resource_name))
            .collect()
    }

    fn named(kind: ResourceKind, name: &str) -> String {
        match kind {
            ResourceKind::Repository => format!("repository:{name}"),
            ResourceKind::Organization => format!("organization:{name}"),
        }
    }

    #[test]
    fn dashboards_are_named_as_github_may_name_them() {
        let params = |pairs: &[(&str, &str)]| {
            pairs
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect::<HashMap<_, _>>()
        };
        assert_eq!(
            Dashboard::at(&params(&[("owner", "Owner"), ("repo", "re.po")])),
            Some(repository("Owner/re.po"))
        );
        assert_eq!(
            Dashboard::at(&params(&[("org", "acme")])),
            Some(organization("acme"))
        );
        for pairs in [
            &[("owner", "-owner"), ("repo", "repo")][..],
            &[("owner", "owner"), ("repo", "..")],
            &[("owner", "owner"), ("repo", "re/po")],
            &[("org", "ac.me")],
            &[("org", "")],
            &[],
        ] {
            assert_eq!(Dashboard::at(&params(pairs)), None, "{pairs:?}");
        }

        assert_eq!(
            Dashboard::from_json(&json!({ "kind": "repository", "name": "owner/repo" })),
            Some(repository("owner/repo"))
        );
        assert_eq!(
            Dashboard::from_json(&json!({ "kind": "organization", "name": "acme" })),
            Some(organization("acme"))
        );
        for value in [
            json!({ "kind": "repository", "name": "acme" }),
            json!({ "kind": "organization", "name": "owner/repo" }),
            json!({ "kind": "user", "name": "mona" }),
            json!({ "kind": "repository" }),
            json!({ "name": "owner/repo" }),
            json!("owner/repo"),
        ] {
            assert_eq!(Dashboard::from_json(&value), None, "{value}");
        }
    }

    #[tokio::test]
    async fn each_view_moves_its_dashboard_first() {
        let (shortcuts, mona, _) = setup().await;
        let record = async |dashboard: Dashboard, minutes| {
            shortcuts
                .record_at(mona, &dashboard, at(minutes))
                .await
                .unwrap();
        };
        record(repository("owner/repo"), 0).await;
        record(organization("acme"), 1).await;
        // A repository and an organization of the same name are two dashboards.
        record(repository("acme/acme"), 2).await;
        record(organization("owner"), 3).await;
        record(repository("owner/repo"), 4).await;
        assert_eq!(
            recent(&shortcuts, mona).await,
            [
                "repository:owner/repo",
                "organization:owner",
                "repository:acme/acme",
                "organization:acme",
            ]
        );
        let entries = shortcuts.recent(mona).await.unwrap();
        assert_eq!(entries[0].last_viewed_at, at(4));
    }

    #[tokio::test]
    async fn a_view_spelled_otherwise_replaces_the_one_before() {
        let (shortcuts, mona, _) = setup().await;
        shortcuts
            .record_at(mona, &repository("Owner/Repo"), at(0))
            .await
            .unwrap();
        shortcuts
            .record_at(mona, &organization("Owner"), at(1))
            .await
            .unwrap();
        shortcuts
            .record_at(mona, &repository("owner/repo"), at(2))
            .await
            .unwrap();
        assert_eq!(
            recent(&shortcuts, mona).await,
            ["repository:owner/repo", "organization:Owner"]
        );
    }

    #[tokio::test]
    async fn only_the_newest_20_are_recent_even_before_housekeeping() {
        let (shortcuts, mona, _) = setup().await;
        for i in 0..25 {
            shortcuts
                .record_at(mona, &organization(&format!("org-{i}")), at(i))
                .await
                .unwrap();
        }
        let expected: Vec<String> = (5..25)
            .rev()
            .map(|i| format!("organization:org-{i}"))
            .collect();
        assert_eq!(recent(&shortcuts, mona).await, expected);
    }

    #[tokio::test]
    async fn clearing_history_leaves_pins_and_other_users_alone() {
        let (shortcuts, mona, hubot) = setup().await;
        for user_id in [mona, hubot] {
            shortcuts
                .record_at(user_id, &repository("owner/repo"), at(0))
                .await
                .unwrap();
            shortcuts.pin(user_id, &organization("acme")).await.unwrap();
        }
        shortcuts.clear_history(mona).await.unwrap();
        assert!(recent(&shortcuts, mona).await.is_empty());
        assert_eq!(pins(&shortcuts, mona).await, ["organization:acme"]);
        assert_eq!(recent(&shortcuts, hubot).await, ["repository:owner/repo"]);
    }

    #[tokio::test]
    async fn pins_go_after_the_others_once_each() {
        let (shortcuts, mona, hubot) = setup().await;
        for dashboard in [
            repository("owner/repo"),
            organization("acme"),
            repository("acme/widget"),
            organization("acme"),
        ] {
            shortcuts.pin(mona, &dashboard).await.unwrap();
        }
        assert_eq!(
            pins(&shortcuts, mona).await,
            [
                "repository:owner/repo",
                "organization:acme",
                "repository:acme/widget",
            ]
        );
        // Pinned again as GitHub spells it now, it keeps its place.
        let pinned = shortcuts.pin(mona, &organization("ACME")).await.unwrap();
        assert_eq!(
            names(&pinned),
            [
                "repository:owner/repo",
                "organization:ACME",
                "repository:acme/widget",
            ]
        );
        assert!(pins(&shortcuts, hubot).await.is_empty());
    }

    #[tokio::test]
    async fn a_user_may_pin_12() {
        let (shortcuts, mona, hubot) = setup().await;
        for i in 0..12 {
            shortcuts
                .pin(mona, &organization(&format!("org-{i}")))
                .await
                .unwrap();
        }
        assert!(matches!(
            shortcuts.pin(mona, &organization("org-12")).await,
            Err(PinRefused::TooMany)
        ));
        // What is pinned already may be, again.
        assert_eq!(
            shortcuts
                .pin(mona, &organization("ORG-0"))
                .await
                .unwrap()
                .len(),
            12
        );
        // Others are not limited by Mona's pins.
        shortcuts.pin(hubot, &organization("org-12")).await.unwrap();
        // Once she unpins one, she may pin another, which goes last.
        shortcuts.unpin(mona, &organization("org-3")).await.unwrap();
        let pinned = shortcuts.pin(mona, &organization("org-12")).await.unwrap();
        assert_eq!(pinned.len(), 12);
        assert_eq!(names(&pinned).last().unwrap(), "organization:org-12");
    }

    #[tokio::test]
    async fn pins_at_once_do_not_go_past_12() {
        let (shortcuts, mona, _) = setup().await;
        for i in 0..11 {
            shortcuts
                .pin(mona, &organization(&format!("org-{i}")))
                .await
                .unwrap();
        }
        let (first, second) = (organization("first"), organization("second"));
        let (first, second) =
            tokio::join!(shortcuts.pin(mona, &first), shortcuts.pin(mona, &second),);
        assert!(
            matches!(
                (&first, &second),
                (Ok(_), Err(PinRefused::TooMany)) | (Err(PinRefused::TooMany), Ok(_))
            ),
            "{first:?} {second:?}"
        );
        let pinned = shortcuts.pins(mona).await.unwrap();
        assert_eq!(pinned.len(), 12);
        let positions: Vec<i32> = pinned.iter().map(|pin| pin.position).collect();
        assert_eq!(positions, (0..12).collect::<Vec<_>>());
    }

    #[tokio::test]
    async fn unpinning_ignores_case_and_what_is_not_pinned() {
        let (shortcuts, mona, hubot) = setup().await;
        for user_id in [mona, hubot] {
            shortcuts
                .pin(user_id, &repository("Owner/Repo"))
                .await
                .unwrap();
            shortcuts.pin(user_id, &organization("acme")).await.unwrap();
        }
        let pinned = shortcuts
            .unpin(mona, &repository("owner/repo"))
            .await
            .unwrap();
        assert_eq!(names(&pinned), ["organization:acme"]);
        // An organization is not a repository, and what is not pinned stays so.
        for dashboard in [organization("acme-two"), repository("acme/acme")] {
            let pinned = shortcuts.unpin(mona, &dashboard).await.unwrap();
            assert_eq!(names(&pinned), ["organization:acme"]);
        }
        assert_eq!(
            pins(&shortcuts, hubot).await,
            ["repository:Owner/Repo", "organization:acme"]
        );
    }

    #[tokio::test]
    async fn pins_go_in_the_order_given() {
        let (shortcuts, mona, hubot) = setup().await;
        for name in ["a", "b", "c", "d"] {
            for user_id in [mona, hubot] {
                shortcuts.pin(user_id, &organization(name)).await.unwrap();
            }
        }
        let order = |names: &[&str]| -> Vec<Dashboard> {
            names.iter().map(|name| organization(name)).collect()
        };
        let reordered = shortcuts
            .reorder(mona, &order(&["d", "c", "b", "a"]))
            .await
            .unwrap();
        assert_eq!(
            names(&reordered),
            [
                "organization:d",
                "organization:c",
                "organization:b",
                "organization:a",
            ]
        );
        // What it leaves out follows in its order, and what is not pinned, or not an
        // organization, is passed over. Letter case does not matter.
        let mut partly = order(&["unpinned", "B"]);
        partly.push(repository("acme/a"));
        let reordered = shortcuts.reorder(mona, &partly).await.unwrap();
        assert_eq!(
            names(&reordered),
            [
                "organization:b",
                "organization:d",
                "organization:c",
                "organization:a",
            ]
        );
        let positions: Vec<i32> = reordered.iter().map(|pin| pin.position).collect();
        assert_eq!(positions, [0, 1, 2, 3]);
        // Hubot's are his own.
        assert_eq!(
            pins(&shortcuts, hubot).await,
            [
                "organization:a",
                "organization:b",
                "organization:c",
                "organization:d",
            ]
        );
    }

    fn visitor() -> Viewer {
        Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ))
    }

    fn signed_in(user_id: i64) -> Viewer {
        Viewer::SignedIn {
            user_id,
            sign_in: Secret::new("gho_mona".to_owned()),
        }
    }

    fn path(pairs: &[(&str, &str)]) -> Path<HashMap<String, String>> {
        Path(
            pairs
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect(),
        )
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

    #[tokio::test]
    async fn visitors_have_no_shortcuts() {
        let (shortcuts, _, _) = setup().await;
        let shortcuts = Arc::new(shortcuts);
        let state = || State(shortcuts.clone());
        let repo = || path(&[("owner", "owner"), ("repo", "repo")]);
        let unauthorized = (StatusCode::UNAUTHORIZED, Value::Null);
        assert_eq!(parts(list(state(), visitor()).await).await, unauthorized);
        assert_eq!(
            parts(view(state(), visitor(), repo()).await).await,
            unauthorized
        );
        assert_eq!(
            parts(clear_history(state(), visitor()).await).await,
            unauthorized
        );
        assert_eq!(
            parts(pin(state(), visitor(), repo()).await).await,
            unauthorized
        );
        assert_eq!(
            parts(unpin(state(), visitor(), repo()).await).await,
            unauthorized
        );
        assert_eq!(
            parts(reorder(state(), visitor(), Json(json!({ "pins": [] }))).await).await,
            unauthorized
        );
    }

    #[tokio::test]
    async fn the_ui_records_views_and_pins_for_the_signed_in_user() {
        let (shortcuts, mona, _) = setup().await;
        let shortcuts = Arc::new(shortcuts);
        let state = || State(shortcuts.clone());
        let repo = || path(&[("owner", "Owner"), ("repo", "repo")]);
        let org = || path(&[("org", "acme")]);

        assert_eq!(
            parts(list(state(), signed_in(mona)).await).await,
            (StatusCode::OK, json!({ "pins": [], "recent": [] }))
        );
        for params in [repo(), org()] {
            assert_eq!(
                parts(view(state(), signed_in(mona), params).await).await,
                (StatusCode::NO_CONTENT, Value::Null)
            );
        }
        assert_eq!(
            parts(pin(state(), signed_in(mona), org()).await).await,
            (
                StatusCode::OK,
                json!({ "pins": [{ "kind": "organization", "name": "acme" }] })
            )
        );
        assert_eq!(
            parts(pin(state(), signed_in(mona), repo()).await).await.1,
            json!({ "pins": [
                { "kind": "organization", "name": "acme" },
                { "kind": "repository", "name": "Owner/repo" },
            ] })
        );
        let order = json!({ "pins": [{ "kind": "repository", "name": "owner/repo" }] });
        assert_eq!(
            parts(reorder(state(), signed_in(mona), Json(order)).await).await,
            (
                StatusCode::OK,
                json!({ "pins": [
                    { "kind": "repository", "name": "Owner/repo" },
                    { "kind": "organization", "name": "acme" },
                ] })
            )
        );
        let (status, body) = parts(list(state(), signed_in(mona)).await).await;
        assert_eq!(status, StatusCode::OK);
        let viewed: Vec<String> = shortcuts
            .recent(mona)
            .await
            .unwrap()
            .iter()
            .map(|entry| {
                entry
                    .last_viewed_at
                    .to_rfc3339_opts(SecondsFormat::Millis, true)
            })
            .collect();
        assert_eq!(
            body["recent"],
            json!([
                { "kind": "organization", "name": "acme", "viewed_at": viewed[0] },
                { "kind": "repository", "name": "Owner/repo", "viewed_at": viewed[1] },
            ])
        );
        assert_eq!(
            parts(unpin(state(), signed_in(mona), org()).await).await,
            (
                StatusCode::OK,
                json!({ "pins": [{ "kind": "repository", "name": "Owner/repo" }] })
            )
        );
        assert_eq!(
            parts(clear_history(state(), signed_in(mona)).await).await,
            (StatusCode::NO_CONTENT, Value::Null)
        );
        assert_eq!(
            parts(list(state(), signed_in(mona)).await).await.1["recent"],
            json!([])
        );
    }

    #[tokio::test]
    async fn the_ui_is_told_when_each_recent_dashboard_was_viewed() {
        let (shortcuts, mona, _) = setup().await;
        shortcuts
            .record_at(mona, &repository("owner/repo"), at(3))
            .await
            .unwrap();
        shortcuts
            .record_at(mona, &organization("acme"), at(5))
            .await
            .unwrap();
        shortcuts.pin(mona, &organization("acme")).await.unwrap();
        assert_eq!(
            parts(list(State(Arc::new(shortcuts)), signed_in(mona)).await).await,
            (
                StatusCode::OK,
                json!({
                    // Pins do not tell it.
                    "pins": [{ "kind": "organization", "name": "acme" }],
                    // As the UI is told times.
                    "recent": [
                        {
                            "kind": "organization",
                            "name": "acme",
                            "viewed_at": "2026-10-20T12:05:00.000Z",
                        },
                        {
                            "kind": "repository",
                            "name": "owner/repo",
                            "viewed_at": "2026-10-20T12:03:00.000Z",
                        },
                    ],
                })
            )
        );
    }

    #[tokio::test]
    async fn the_ui_is_told_what_it_cannot_do() {
        let (shortcuts, mona, _) = setup().await;
        let shortcuts = Arc::new(shortcuts);
        let state = || State(shortcuts.clone());

        // Names that cannot be GitHub's, whoever asks.
        let bad = || path(&[("owner", "owner"), ("repo", "..")]);
        for viewer in [visitor(), signed_in(mona)] {
            assert_eq!(
                parts(view(state(), viewer.clone(), bad()).await).await,
                (StatusCode::BAD_REQUEST, Value::Null)
            );
            assert_eq!(
                parts(pin(state(), viewer.clone(), bad()).await).await,
                (StatusCode::BAD_REQUEST, Value::Null)
            );
            assert_eq!(
                parts(unpin(state(), viewer, bad()).await).await,
                (StatusCode::BAD_REQUEST, Value::Null)
            );
        }
        for body in [
            json!({}),
            json!({ "pins": "acme" }),
            json!({ "pins": [{ "kind": "organization", "name": "-acme" }] }),
            json!([{ "kind": "organization", "name": "acme" }]),
        ] {
            assert_eq!(
                parts(reorder(state(), signed_in(mona), Json(body.clone())).await).await,
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    json!({ "error": "invalid_pins" })
                ),
                "{body}"
            );
        }

        for i in 0..12 {
            let org = format!("org-{i}");
            pin(state(), signed_in(mona), path(&[("org", &org)])).await;
        }
        assert_eq!(
            parts(pin(state(), signed_in(mona), path(&[("org", "org-12")])).await).await,
            (StatusCode::CONFLICT, json!({ "error": "too_many_pins" }))
        );
    }
}
