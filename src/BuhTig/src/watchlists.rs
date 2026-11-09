//! Watchlists (SRS §4.8): named lists of repositories, of any owners, that a signed-in user
//! watches together (FR-PERS-06, FR-PERS-07). Their overview shows each repository as its
//! dashboard reads it (FR-PERS-08, FR-PERS-09).
//!
//! A watchlist keeps only its name and its repositories' names, as the user gave them. BuhTig
//! asks GitHub nothing to add a repository, and keeps nothing here of what GitHub says of it.
//! The overview reads each repository for the viewer, with their own credentials, through
//! [`crate::repositories::glance`], so that one who may not see a repository is told nothing of
//! it, whatever watchlist it is in (FR-ACC-06, FR-ACC-07).
//!
//! A user has at most 10 watchlists, of at most 25 repositories each. No two of their
//! watchlists have names that differ only in letter case, and no watchlist has a repository
//! twice, whatever the case of its name, since GitHub's names ignore it. Each change holds the
//! user's row, as pins do, so that two at once can neither go past a limit nor give two
//! repositories one place.
//!
//! A watchlist is its user's alone: another's is 404, as one that does not exist is, whatever
//! is asked of it. All of it is for signed-in users (FR-ACC-02). What changes state is no
//! GET, and other origins' pages cannot send it ([`crate::security`], NFR-SEC-02).

use std::collections::HashSet;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
use sea_orm::sea_query::Expr;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DatabaseTransaction, DbErr, EntityTrait,
    QueryFilter, QueryOrder, Set, TransactionTrait,
};
use serde_json::{Value, json};

use crate::cache::Viewer;
use crate::entity::{watchlist, watchlist_entry};
use crate::repositories;
use crate::shortcuts::{answer, lock, status, unavailable};

/// A watchlist, with its repositories in its order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Watchlist {
    pub id: i64,
    pub name: String,
    /// `owner/repo`, as the user gave it.
    pub repositories: Vec<String>,
}

/// Why a watchlist was not changed.
#[derive(Debug)]
pub enum Refused {
    /// The user has no watchlist of that ID: there is none, or it is another user's.
    NotFound,
    /// The user has as many watchlists as they may (FR-PERS-06).
    TooManyWatchlists,
    /// Another of the user's watchlists has that name, whatever its letter case (FR-PERS-06).
    NameTaken,
    /// The watchlist would hold more repositories than it may (FR-PERS-07).
    TooManyRepositories,
    Database(DbErr),
}

impl From<DbErr> for Refused {
    fn from(error: DbErr) -> Refused {
        Refused::Database(error)
    }
}

pub struct Watchlists {
    db: DatabaseConnection,
}

impl Watchlists {
    pub fn new(db: DatabaseConnection) -> Watchlists {
        Watchlists { db }
    }

    /// The watchlists of the user `user_id`, in the order they were made.
    pub async fn of(&self, user_id: i64) -> Result<Vec<Watchlist>, DbErr> {
        watchlists_of(&self.db, user_id).await
    }

    /// Makes a watchlist named `name` for the user `user_id` at `now`, with `repositories` in
    /// their order, each once whatever its case, the first spelling kept (FR-PERS-06). Answers
    /// its ID and the user's watchlists.
    pub async fn create_at(
        &self,
        user_id: i64,
        name: &str,
        repositories: &[String],
        now: DateTimeUtc,
    ) -> Result<(i64, Vec<Watchlist>), Refused> {
        let repositories = distinct(repositories);
        if repositories.len() as u64 > watchlist_entry::MAX_PER_WATCHLIST {
            return Err(Refused::TooManyRepositories);
        }
        let txn = self.db.begin().await?;
        lock(&txn, user_id).await?;
        let lists = lists_of(&txn, user_id).await?;
        if lists.len() as u64 >= watchlist::MAX_PER_USER {
            return Err(Refused::TooManyWatchlists);
        }
        if lists.iter().any(|list| same_name(&list.name, name)) {
            return Err(Refused::NameTaken);
        }
        let new = watchlist::ActiveModel {
            user_id: Set(user_id),
            name: Set(name.to_owned()),
            created_at: Set(now),
            ..Default::default()
        };
        let id = watchlist::Entity::insert(new)
            .exec(&txn)
            .await?
            .last_insert_id;
        insert(&txn, id, 0, &repositories).await?;
        let watchlists = watchlists_of(&txn, user_id).await?;
        txn.commit().await?;
        Ok((id, watchlists))
    }

    /// Names the watchlist `id` of the user `user_id` `name` (FR-PERS-06). Answers their
    /// watchlists.
    pub async fn rename(
        &self,
        user_id: i64,
        id: i64,
        name: &str,
    ) -> Result<Vec<Watchlist>, Refused> {
        let txn = self.db.begin().await?;
        lock(&txn, user_id).await?;
        let lists = lists_of(&txn, user_id).await?;
        let Some(list) = lists.iter().find(|list| list.id == id) else {
            return Err(Refused::NotFound);
        };
        if lists
            .iter()
            .any(|other| other.id != id && same_name(&other.name, name))
        {
            return Err(Refused::NameTaken);
        }
        if list.name != name {
            watchlist::Entity::update_many()
                .col_expr(watchlist::Column::Name, Expr::value(name))
                .filter(watchlist::Column::Id.eq(id))
                .exec(&txn)
                .await?;
        }
        let watchlists = watchlists_of(&txn, user_id).await?;
        txn.commit().await?;
        Ok(watchlists)
    }

    /// Deletes the watchlist `id` of the user `user_id`, with its repositories (FR-PERS-06).
    /// Answers their watchlists.
    pub async fn delete(&self, user_id: i64, id: i64) -> Result<Vec<Watchlist>, Refused> {
        use watchlist::Column;

        let txn = self.db.begin().await?;
        lock(&txn, user_id).await?;
        let deleted = watchlist::Entity::delete_many()
            .filter(Column::Id.eq(id))
            .filter(Column::UserId.eq(user_id))
            .exec(&txn)
            .await?
            .rows_affected;
        if deleted == 0 {
            return Err(Refused::NotFound);
        }
        let watchlists = watchlists_of(&txn, user_id).await?;
        txn.commit().await?;
        Ok(watchlists)
    }

    /// Adds `repositories` to the watchlist `id` of the user `user_id`, after those it has, in
    /// their order (FR-PERS-07). One it has already, whatever its case, keeps its place, with
    /// its name spelled as now. If they would be more than it may hold, none is added. Answers
    /// the user's watchlists.
    pub async fn add(
        &self,
        user_id: i64,
        id: i64,
        repositories: &[String],
    ) -> Result<Vec<Watchlist>, Refused> {
        use watchlist_entry::Column;

        let txn = self.db.begin().await?;
        lock(&txn, user_id).await?;
        own(&txn, user_id, id).await?;
        let entries = entries_of(&txn, &[id]).await?;
        let mut new = Vec::new();
        let mut respelt = Vec::new();
        for name in distinct(repositories) {
            match entries
                .iter()
                .find(|entry| entry.repository_name.eq_ignore_ascii_case(&name))
            {
                Some(entry) if entry.repository_name == name => {}
                Some(entry) => respelt.push((entry.id, name)),
                None => new.push(name),
            }
        }
        if (entries.len() + new.len()) as u64 > watchlist_entry::MAX_PER_WATCHLIST {
            return Err(Refused::TooManyRepositories);
        }
        for (entry, name) in respelt {
            watchlist_entry::Entity::update_many()
                .col_expr(Column::RepositoryName, Expr::value(name))
                .filter(Column::Id.eq(entry))
                .exec(&txn)
                .await?;
        }
        let next = entries
            .iter()
            .map(|entry| entry.position)
            .max()
            .map_or(0, |last| last + 1);
        insert(&txn, id, next, &new).await?;
        let watchlists = watchlists_of(&txn, user_id).await?;
        txn.commit().await?;
        Ok(watchlists)
    }

    /// Removes `repository` from the watchlist `id` of the user `user_id`, whatever the case of
    /// its name, if it has it (FR-PERS-07). Answers the user's watchlists.
    pub async fn remove(
        &self,
        user_id: i64,
        id: i64,
        repository: &str,
    ) -> Result<Vec<Watchlist>, Refused> {
        let txn = self.db.begin().await?;
        lock(&txn, user_id).await?;
        own(&txn, user_id, id).await?;
        let gone: Vec<i64> = entries_of(&txn, &[id])
            .await?
            .into_iter()
            .filter(|entry| entry.repository_name.eq_ignore_ascii_case(repository))
            .map(|entry| entry.id)
            .collect();
        if !gone.is_empty() {
            watchlist_entry::Entity::delete_many()
                .filter(watchlist_entry::Column::Id.is_in(gone))
                .exec(&txn)
                .await?;
        }
        let watchlists = watchlists_of(&txn, user_id).await?;
        txn.commit().await?;
        Ok(watchlists)
    }

    /// Puts the repositories of the watchlist `id` of the user `user_id` in the order of
    /// `order` (FR-PERS-07), as pins are put (FR-PERS-05): those it leaves out follow, in the
    /// order they had, and what it names that the watchlist lacks is passed over, so that a
    /// change made elsewhere since the UI last asked is not undone. Answers the user's
    /// watchlists.
    pub async fn reorder(
        &self,
        user_id: i64,
        id: i64,
        order: &[String],
    ) -> Result<Vec<Watchlist>, Refused> {
        let txn = self.db.begin().await?;
        lock(&txn, user_id).await?;
        own(&txn, user_id, id).await?;
        let mut rest = entries_of(&txn, &[id]).await?;
        let mut ordered = Vec::with_capacity(rest.len());
        for name in order {
            if let Some(at) = rest
                .iter()
                .position(|entry| entry.repository_name.eq_ignore_ascii_case(name))
            {
                ordered.push(rest.remove(at));
            }
        }
        ordered.append(&mut rest);
        for (position, entry) in (0..).zip(&ordered) {
            if entry.position != position {
                watchlist_entry::Entity::update_many()
                    .col_expr(watchlist_entry::Column::Position, Expr::value(position))
                    .filter(watchlist_entry::Column::Id.eq(entry.id))
                    .exec(&txn)
                    .await?;
            }
        }
        let watchlists = watchlists_of(&txn, user_id).await?;
        txn.commit().await?;
        Ok(watchlists)
    }
}

/// The watchlists of the user `user_id`, in the order they were made, with their
/// repositories in theirs.
async fn watchlists_of(db: &impl ConnectionTrait, user_id: i64) -> Result<Vec<Watchlist>, DbErr> {
    let lists = lists_of(db, user_id).await?;
    let ids: Vec<i64> = lists.iter().map(|list| list.id).collect();
    let entries = entries_of(db, &ids).await?;
    Ok(lists
        .into_iter()
        .map(|list| Watchlist {
            id: list.id,
            repositories: entries
                .iter()
                .filter(|entry| entry.watchlist_id == list.id)
                .map(|entry| entry.repository_name.clone())
                .collect(),
            name: list.name,
        })
        .collect())
}

/// The rows of the watchlists of the user `user_id`, in the order they were made.
async fn lists_of(db: &impl ConnectionTrait, user_id: i64) -> Result<Vec<watchlist::Model>, DbErr> {
    watchlist::Entity::find()
        .filter(watchlist::Column::UserId.eq(user_id))
        .order_by_asc(watchlist::Column::Id)
        .all(db)
        .await
}

/// The repositories of the watchlists `ids`, each watchlist's in its order.
async fn entries_of(
    db: &impl ConnectionTrait,
    ids: &[i64],
) -> Result<Vec<watchlist_entry::Model>, DbErr> {
    use watchlist_entry::Column;

    if ids.is_empty() {
        return Ok(Vec::new());
    }
    watchlist_entry::Entity::find()
        .filter(Column::WatchlistId.is_in(ids.iter().copied()))
        .order_by_asc(Column::Position)
        .order_by_asc(Column::Id)
        .all(db)
        .await
}

/// Whether the watchlist `id` is the user `user_id`'s: [`Refused::NotFound`] if not, as if
/// there were no such watchlist.
async fn own(txn: &DatabaseTransaction, user_id: i64, id: i64) -> Result<(), Refused> {
    use watchlist::Column;

    watchlist::Entity::find()
        .filter(Column::Id.eq(id))
        .filter(Column::UserId.eq(user_id))
        .one(txn)
        .await?
        .map(|_| ())
        .ok_or(Refused::NotFound)
}

/// Adds `names` to the watchlist `id`, in their order, from `position` on.
async fn insert(
    txn: &DatabaseTransaction,
    id: i64,
    position: i32,
    names: &[String],
) -> Result<(), DbErr> {
    if names.is_empty() {
        return Ok(());
    }
    let entries = (position..)
        .zip(names)
        .map(|(position, name)| watchlist_entry::ActiveModel {
            watchlist_id: Set(id),
            repository_name: Set(name.clone()),
            position: Set(position),
            ..Default::default()
        });
    watchlist_entry::Entity::insert_many(entries)
        .exec_without_returning(txn)
        .await?;
    Ok(())
}

/// `names`, each once whatever its letter case, as first spelled, in their order.
fn distinct(names: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    names
        .iter()
        .filter(|name| seen.insert(name.to_ascii_lowercase()))
        .cloned()
        .collect()
}

/// Whether two watchlists' names are the same, whatever their letter case.
fn same_name(one: &str, other: &str) -> bool {
    one.to_lowercase() == other.to_lowercase()
}

/// The watchlist name in `body`'s `name`, trimmed, if it may be one: 1 to 50 characters, none
/// of them a control character (FR-PERS-06).
fn name_in(body: &Value) -> Option<String> {
    let name = body.get("name")?.as_str()?.trim();
    let length = name.chars().count();
    let valid =
        (1..=watchlist::MAX_NAME_LENGTH).contains(&length) && !name.chars().any(char::is_control);
    valid.then(|| name.to_owned())
}

/// The repositories that `value` lists, if it is a list of `owner/repo` names that can be
/// GitHub's (FR-SRCH-04).
fn repositories_in(value: &Value) -> Option<Vec<String>> {
    value
        .as_array()?
        .iter()
        .map(|name| {
            let name = name.as_str()?;
            repositories::names(name).map(|_| name.to_owned())
        })
        .collect()
}

/// The ID of a watchlist in a path, if it can be one.
fn id_of(raw: &str) -> Option<i64> {
    let digits = !raw.is_empty() && raw.len() <= 18 && raw.bytes().all(|b| b.is_ascii_digit());
    digits.then(|| raw.parse().ok()).flatten()
}

/// `GET /-/api/watchlists`: `{"watchlists": [{"id": …, "name": …, "repositories":
/// ["owner/repo", …]}, …]}`, the signed-in user's watchlists in the order they were made,
/// with their repositories in theirs. 401 for a visitor, who has none (FR-ACC-02).
pub async fn list(State(watchlists): State<Arc<Watchlists>>, viewer: Viewer) -> Response {
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    match watchlists.of(user_id).await {
        Ok(lists) => answered(&lists),
        Err(error) => unavailable("read the watchlists", error),
    }
}

/// `POST /-/api/watchlists` of `{"name": …, "repositories": ["owner/repo", …]}`, the
/// repositories optional: makes the signed-in user a watchlist (FR-PERS-06), as
/// [`Watchlists::create_at`] does. 201 with `{"id": …, "watchlists": […]}`, the new
/// watchlist's ID and the user's watchlists, as [`list`] has them. 422 with `{"error":
/// "invalid_name"}` or `{"error": "invalid_repositories"}` for a body that names neither, and
/// 409 with `{"error": …}` for what the user may not have, as [`refused`] tells it. 401 for a
/// visitor.
pub async fn create(
    State(watchlists): State<Arc<Watchlists>>,
    viewer: Viewer,
    Json(body): Json<Value>,
) -> Response {
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    let Some(name) = name_in(&body) else {
        return invalid("invalid_name");
    };
    let repositories = match body.get("repositories") {
        None | Some(Value::Null) => Vec::new(),
        Some(value) => match repositories_in(value) {
            Some(repositories) => repositories,
            None => return invalid("invalid_repositories"),
        },
    };
    match watchlists
        .create_at(user_id, &name, &repositories, ChronoUtc::now())
        .await
    {
        Ok((id, lists)) => answer(
            StatusCode::CREATED,
            json!({ "id": id, "watchlists": listed(&lists) }),
        ),
        Err(refusal) => refused("create a watchlist", refusal),
    }
}

/// `PUT /-/api/watchlists/{id}` of `{"name": …}`: renames the signed-in user's watchlist
/// (FR-PERS-06), and answers `{"watchlists": […]}`, as [`list`] has them. 404 if they have
/// no watchlist of that ID, 400 for an ID that cannot be one, and otherwise as [`create`].
pub async fn rename(
    State(watchlists): State<Arc<Watchlists>>,
    viewer: Viewer,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let Some(id) = id_of(&id) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    let Some(name) = name_in(&body) else {
        return invalid("invalid_name");
    };
    match watchlists.rename(user_id, id, &name).await {
        Ok(lists) => answered(&lists),
        Err(refusal) => refused("rename a watchlist", refusal),
    }
}

/// `DELETE /-/api/watchlists/{id}`: deletes the signed-in user's watchlist (FR-PERS-06), and
/// answers `{"watchlists": […]}`, as [`list`] has them. 404 if they have no watchlist of that
/// ID, 400 for an ID that cannot be one, and 401 for a visitor.
pub async fn delete(
    State(watchlists): State<Arc<Watchlists>>,
    viewer: Viewer,
    Path(id): Path<String>,
) -> Response {
    let Some(id) = id_of(&id) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    match watchlists.delete(user_id, id).await {
        Ok(lists) => answered(&lists),
        Err(refusal) => refused("delete a watchlist", refusal),
    }
}

/// `POST /-/api/watchlists/{id}/repositories` of `{"repositories": ["owner/repo", …]}`: adds
/// them to the signed-in user's watchlist (FR-PERS-07), as [`Watchlists::add`] does, and
/// answers `{"watchlists": […]}`, as [`list`] has them. 422 with `{"error":
/// "invalid_repositories"}` for a body that names none, and otherwise as [`rename`].
pub async fn add(
    State(watchlists): State<Arc<Watchlists>>,
    viewer: Viewer,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let Some(id) = id_of(&id) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    let Some(repositories) = body.get("repositories").and_then(repositories_in) else {
        return invalid("invalid_repositories");
    };
    match watchlists.add(user_id, id, &repositories).await {
        Ok(lists) => answered(&lists),
        Err(refusal) => refused("add to a watchlist", refusal),
    }
}

/// `DELETE /-/api/watchlists/{id}/repositories/{owner}/{repo}`: removes the repository from
/// the signed-in user's watchlist, if it has it (FR-PERS-07), and answers `{"watchlists":
/// […]}`, as [`list`] has them. 400 for names that cannot be GitHub's, and otherwise as
/// [`delete`].
pub async fn remove(
    State(watchlists): State<Arc<Watchlists>>,
    viewer: Viewer,
    Path((id, owner, repo)): Path<(String, String, String)>,
) -> Response {
    let repository = format!("{owner}/{repo}");
    let (Some(id), Some(_)) = (id_of(&id), repositories::names(&repository)) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    match watchlists.remove(user_id, id, &repository).await {
        Ok(lists) => answered(&lists),
        Err(refusal) => refused("remove from a watchlist", refusal),
    }
}

/// `PUT /-/api/watchlists/{id}/repositories` of `{"repositories": ["owner/repo", …]}`: puts
/// the signed-in user's watchlist in that order (FR-PERS-07), as [`Watchlists::reorder`] does,
/// and answers `{"watchlists": […]}`, as [`list`] has them. Otherwise as [`add`].
pub async fn reorder(
    State(watchlists): State<Arc<Watchlists>>,
    viewer: Viewer,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let Some(id) = id_of(&id) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    let Some(order) = body.get("repositories").and_then(repositories_in) else {
        return invalid("invalid_repositories");
    };
    match watchlists.reorder(user_id, id, &order).await {
        Ok(lists) => answered(&lists),
        Err(refusal) => refused("reorder a watchlist", refusal),
    }
}

/// `{"watchlists": […]}`, as [`list`] answers.
fn answered(lists: &[Watchlist]) -> Response {
    answer(StatusCode::OK, json!({ "watchlists": listed(lists) }))
}

fn listed(lists: &[Watchlist]) -> Vec<Value> {
    lists
        .iter()
        .map(|list| {
            json!({
                "id": list.id,
                "name": list.name,
                "repositories": list.repositories,
            })
        })
        .collect()
}

/// 422 with `{"error": error}`, for a body that does not say what it must.
fn invalid(error: &str) -> Response {
    answer(StatusCode::UNPROCESSABLE_ENTITY, json!({ "error": error }))
}

/// The response to a change refused as `refusal`, which the user tried `doing`: 404 for a
/// watchlist that is not theirs, and 409 with `{"error": "too_many_watchlists" | "name_taken"
/// | "too_many_repositories"}` for what they may not have.
fn refused(doing: &str, refusal: Refused) -> Response {
    let error = match refusal {
        Refused::NotFound => return status(StatusCode::NOT_FOUND),
        Refused::TooManyWatchlists => "too_many_watchlists",
        Refused::NameTaken => "name_taken",
        Refused::TooManyRepositories => "too_many_repositories",
        Refused::Database(error) => return unavailable(doing, error),
    };
    answer(StatusCode::CONFLICT, json!({ "error": error }))
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, header};
    use sea_orm::sea_query::prelude::chrono::TimeDelta;
    use url::Url;

    use super::*;
    use crate::config::{DatabaseConfig, Secret};
    use crate::db;
    use crate::entity::user;
    use crate::test_cluster::cluster;
    use crate::visitors::Visitor;

    /// `minutes` after the first watchlist of these tests.
    fn at(minutes: i64) -> DateTimeUtc {
        "2026-11-09T12:00:00Z".parse::<DateTimeUtc>().unwrap() + TimeDelta::minutes(minutes)
    }

    fn names(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    /// Watchlists kept in a database of their own, and the IDs of its two users, Mona and
    /// Hubot.
    async fn setup() -> (Watchlists, i64, i64) {
        let cluster = cluster();
        let database = cluster.create_database();
        let db = db::connect(&DatabaseConfig {
            url: Secret::new(Url::parse(&cluster.url(&database)).unwrap()),
            max_connections: 5,
        })
        .await
        .unwrap();
        db::migrate(&db, crate::config::GITHUB_COM).await.unwrap();
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
        (Watchlists::new(db), ids[0], ids[1])
    }

    /// Makes the user `user_id` a watchlist named `name` with `repositories`, and answers
    /// its ID.
    async fn make(watchlists: &Watchlists, user_id: i64, name: &str, repositories: &[&str]) -> i64 {
        watchlists
            .create_at(user_id, name, &names(repositories), at(0))
            .await
            .unwrap()
            .0
    }

    /// The user `user_id`'s watchlists, as `name: owner/repo owner/repo`.
    async fn shown(watchlists: &Watchlists, user_id: i64) -> Vec<String> {
        listing(&watchlists.of(user_id).await.unwrap())
    }

    fn listing(lists: &[Watchlist]) -> Vec<String> {
        lists
            .iter()
            .map(|list| format!("{}: {}", list.name, list.repositories.join(" ")))
            .collect()
    }

    /// FR-PERS-06, FR-PERS-07.
    #[tokio::test]
    async fn a_user_makes_renames_and_deletes_watchlists() {
        let (watchlists, mona, hubot) = setup().await;
        assert!(watchlists.of(mona).await.unwrap().is_empty());
        let (dependencies, lists) = watchlists
            .create_at(
                mona,
                "Dependencies",
                &names(&["serde-rs/serde", "tokio-rs/tokio", "Serde-RS/Serde"]),
                at(0),
            )
            .await
            .unwrap();
        // The first spelling of each is kept, once.
        assert_eq!(
            listing(&lists),
            ["Dependencies: serde-rs/serde tokio-rs/tokio"]
        );
        let team = make(&watchlists, mona, "Team", &[]).await;
        assert!(team > dependencies);
        assert_eq!(
            shown(&watchlists, mona).await,
            ["Dependencies: serde-rs/serde tokio-rs/tokio", "Team: "]
        );

        let lists = watchlists.rename(mona, team, "Our team").await.unwrap();
        assert_eq!(
            listing(&lists),
            ["Dependencies: serde-rs/serde tokio-rs/tokio", "Our team: "]
        );
        let lists = watchlists.delete(mona, dependencies).await.unwrap();
        assert_eq!(listing(&lists), ["Our team: "]);
        assert!(matches!(
            watchlists.delete(mona, dependencies).await,
            Err(Refused::NotFound)
        ));
        // Hubot has none of Mona's.
        assert!(watchlists.of(hubot).await.unwrap().is_empty());
    }

    /// FR-PERS-06: no two of a user's watchlists have names that differ only in case, but
    /// two users may name theirs alike, and a watchlist may be respelled.
    #[tokio::test]
    async fn names_are_a_users_own_whatever_their_case() {
        let (watchlists, mona, hubot) = setup().await;
        let dependencies = make(&watchlists, mona, "Dependencies", &[]).await;
        let team = make(&watchlists, mona, "Team", &[]).await;
        assert!(matches!(
            watchlists.create_at(mona, "DEPENDENCIES", &[], at(1)).await,
            Err(Refused::NameTaken)
        ));
        assert!(matches!(
            watchlists.rename(mona, team, "dependencies").await,
            Err(Refused::NameTaken)
        ));
        make(&watchlists, hubot, "Dependencies", &[]).await;
        let lists = watchlists
            .rename(mona, dependencies, "DEPENDENCIES")
            .await
            .unwrap();
        assert_eq!(listing(&lists), ["DEPENDENCIES: ", "Team: "]);
        // Non-ASCII letters too.
        make(&watchlists, mona, "Équipe", &[]).await;
        assert!(matches!(
            watchlists.create_at(mona, "ÉQUIPE", &[], at(2)).await,
            Err(Refused::NameTaken)
        ));
    }

    /// FR-PERS-06: a user may have 10 watchlists, however many requests make them at once.
    #[tokio::test]
    async fn a_user_may_have_10_watchlists() {
        let (watchlists, mona, hubot) = setup().await;
        for i in 0..9 {
            make(&watchlists, mona, &format!("List {i}"), &[]).await;
        }
        let (first, second) = tokio::join!(
            watchlists.create_at(mona, "First", &[], at(1)),
            watchlists.create_at(mona, "Second", &[], at(1)),
        );
        assert!(
            matches!(
                (&first, &second),
                (Ok(_), Err(Refused::TooManyWatchlists)) | (Err(Refused::TooManyWatchlists), Ok(_))
            ),
            "{first:?} {second:?}"
        );
        assert_eq!(watchlists.of(mona).await.unwrap().len(), 10);
        // Hubot is not limited by Mona's.
        make(&watchlists, hubot, "Mine", &[]).await;
        // Once she deletes one, she may make another.
        let last = watchlists.of(mona).await.unwrap()[0].id;
        watchlists.delete(mona, last).await.unwrap();
        make(&watchlists, mona, "Another", &[]).await;
    }

    /// FR-PERS-07: a watchlist holds 25 repositories at most. Adding is all or nothing, and
    /// what it has already only respells it, in its place.
    #[tokio::test]
    async fn a_watchlist_holds_25_repositories() {
        let (watchlists, mona, _) = setup().await;
        let too_many: Vec<String> = (0..26).map(|i| format!("owner/repo-{i}")).collect();
        assert!(matches!(
            watchlists.create_at(mona, "Many", &too_many, at(0)).await,
            Err(Refused::TooManyRepositories)
        ));
        assert!(watchlists.of(mona).await.unwrap().is_empty());

        let id = watchlists
            .create_at(mona, "Many", &too_many[..24], at(0))
            .await
            .unwrap()
            .0;
        // Two more would be one too many: neither is added, and nothing is respelled.
        let refused = watchlists
            .add(
                mona,
                id,
                &names(&["OWNER/REPO-0", "owner/repo-24", "owner/repo-25"]),
            )
            .await;
        assert!(matches!(refused, Err(Refused::TooManyRepositories)));
        let list = &watchlists.of(mona).await.unwrap()[0];
        assert_eq!(list.repositories.len(), 24);
        assert_eq!(list.repositories[0], "owner/repo-0");

        let lists = watchlists
            .add(mona, id, &names(&["OWNER/REPO-0", "owner/repo-24"]))
            .await
            .unwrap();
        assert_eq!(lists[0].repositories.len(), 25);
        assert_eq!(lists[0].repositories[0], "OWNER/REPO-0");
        assert_eq!(lists[0].repositories[24], "owner/repo-24");
        // What it has already may be added again, but nothing new.
        watchlists
            .add(mona, id, &names(&["owner/repo-1"]))
            .await
            .unwrap();
        assert!(matches!(
            watchlists.add(mona, id, &names(&["owner/repo-25"])).await,
            Err(Refused::TooManyRepositories)
        ));
    }

    /// FR-PERS-07: two additions at once give neither more than 25 repositories nor two
    /// repositories one place.
    #[tokio::test]
    async fn additions_at_once_do_not_go_past_25() {
        let (watchlists, mona, _) = setup().await;
        let some: Vec<String> = (0..24).map(|i| format!("owner/repo-{i}")).collect();
        let id = watchlists
            .create_at(mona, "Many", &some, at(0))
            .await
            .unwrap()
            .0;
        let (first, second) = (names(&["first/repo"]), names(&["second/repo"]));
        let (first, second) = tokio::join!(
            watchlists.add(mona, id, &first),
            watchlists.add(mona, id, &second),
        );
        assert!(
            matches!(
                (&first, &second),
                (Ok(_), Err(Refused::TooManyRepositories))
                    | (Err(Refused::TooManyRepositories), Ok(_))
            ),
            "{first:?} {second:?}"
        );
        let entries = entries_of(&watchlists.db, &[id]).await.unwrap();
        let positions: Vec<i32> = entries.iter().map(|entry| entry.position).collect();
        assert_eq!(positions, (0..25).collect::<Vec<_>>());
    }

    /// FR-PERS-07: removing ignores case and what the watchlist lacks, and the rest follow
    /// in the order given, as pins do (FR-PERS-05).
    #[tokio::test]
    async fn repositories_are_removed_and_reordered() {
        let (watchlists, mona, _) = setup().await;
        let id = make(&watchlists, mona, "Deps", &["a/a", "b/b", "c/c", "d/d"]).await;
        let lists = watchlists.remove(mona, id, "B/B").await.unwrap();
        assert_eq!(listing(&lists), ["Deps: a/a c/c d/d"]);
        let lists = watchlists.remove(mona, id, "x/x").await.unwrap();
        assert_eq!(listing(&lists), ["Deps: a/a c/c d/d"]);

        let lists = watchlists
            .reorder(mona, id, &names(&["D/D", "gone/repo", "a/a"]))
            .await
            .unwrap();
        assert_eq!(listing(&lists), ["Deps: d/d a/a c/c"]);
        let entries = entries_of(&watchlists.db, &[id]).await.unwrap();
        let positions: Vec<i32> = entries.iter().map(|entry| entry.position).collect();
        assert_eq!(positions, [0, 1, 2]);
        // One added after a removal goes last.
        let lists = watchlists.add(mona, id, &names(&["e/e"])).await.unwrap();
        assert_eq!(listing(&lists), ["Deps: d/d a/a c/c e/e"]);
    }

    /// A watchlist is its user's alone: whatever another asks of it, it is as if there were
    /// none, and it stays as it was.
    #[tokio::test]
    async fn another_users_watchlist_is_not_found() {
        let (watchlists, mona, hubot) = setup().await;
        let id = make(&watchlists, mona, "Mine", &["a/a", "b/b"]).await;
        let other = names(&["c/c"]);
        let refusals = [
            watchlists.rename(hubot, id, "Taken").await,
            watchlists.add(hubot, id, &other).await,
            watchlists.remove(hubot, id, "a/a").await,
            watchlists.reorder(hubot, id, &names(&["b/b", "a/a"])).await,
            watchlists.delete(hubot, id).await,
        ];
        for refusal in refusals {
            assert!(matches!(refusal, Err(Refused::NotFound)), "{refusal:?}");
        }
        assert_eq!(shown(&watchlists, mona).await, ["Mine: a/a b/b"]);
        assert!(watchlists.of(hubot).await.unwrap().is_empty());
    }

    #[test]
    fn names_are_trimmed_and_bounded() {
        let name = |value: Value| name_in(&json!({ "name": value }));
        assert_eq!(
            name(json!("  Dependencies ")).as_deref(),
            Some("Dependencies")
        );
        assert_eq!(
            name(json!("é".repeat(50))).as_deref(),
            Some("é".repeat(50).as_str())
        );
        for invalid in [
            json!(""),
            json!("   "),
            json!("x".repeat(51)),
            json!("a\nb"),
            json!("tab\there"),
            json!(42),
            Value::Null,
        ] {
            assert_eq!(name(invalid.clone()), None, "{invalid}");
        }
        assert_eq!(name_in(&json!({})), None);
    }

    #[test]
    fn ids_and_repositories_are_checked() {
        assert_eq!(id_of("42"), Some(42));
        for invalid in ["", "-1", "+1", "4.2", "x", "1234567890123456789"] {
            assert_eq!(id_of(invalid), None, "{invalid}");
        }
        assert_eq!(
            repositories_in(&json!(["owner/repo", "Owner/Repo.js"])),
            Some(names(&["owner/repo", "Owner/Repo.js"]))
        );
        for invalid in [
            json!(["owner"]),
            json!(["owner/repo/extra"]),
            json!(["-owner/repo"]),
            json!([42]),
            json!("owner/repo"),
        ] {
            assert_eq!(repositories_in(&invalid), None, "{invalid}");
        }
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

    /// What the UI is told, and which statuses it gets for what it may not do.
    #[tokio::test]
    async fn the_ui_is_told_what_it_cannot_do() {
        let (watchlists, mona, hubot) = setup().await;
        let watchlists = Arc::new(watchlists);
        let state = || State(watchlists.clone());
        let id = |id: i64| Path(id.to_string());

        let (status, body) = parts(
            create(
                state(),
                signed_in(mona),
                Json(json!({ "name": " Dependencies ", "repositories": ["a/a", "b/b"] })),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        let created = body["id"].as_i64().unwrap();
        assert_eq!(
            body["watchlists"],
            json!([{ "id": created, "name": "Dependencies", "repositories": ["a/a", "b/b"] }])
        );
        assert_eq!(
            parts(list(state(), signed_in(mona)).await).await,
            (StatusCode::OK, json!({ "watchlists": body["watchlists"] }))
        );

        // Visitors have none, and may make none.
        assert_eq!(
            parts(list(state(), visitor()).await).await,
            (StatusCode::UNAUTHORIZED, Value::Null)
        );
        assert_eq!(
            parts(create(state(), visitor(), Json(json!({ "name": "Mine" }))).await).await,
            (StatusCode::UNAUTHORIZED, Value::Null)
        );
        assert_eq!(
            parts(delete(state(), visitor(), id(created)).await).await,
            (StatusCode::UNAUTHORIZED, Value::Null)
        );

        let invalid = |error: &str| (StatusCode::UNPROCESSABLE_ENTITY, json!({ "error": error }));
        let conflict = |error: &str| (StatusCode::CONFLICT, json!({ "error": error }));
        for body in [
            json!({}),
            json!({ "name": "" }),
            json!({ "name": "x".repeat(51) }),
        ] {
            assert_eq!(
                parts(create(state(), signed_in(mona), Json(body)).await).await,
                invalid("invalid_name")
            );
        }
        assert_eq!(
            parts(
                create(
                    state(),
                    signed_in(mona),
                    Json(json!({ "name": "Other", "repositories": ["nope"] })),
                )
                .await
            )
            .await,
            invalid("invalid_repositories")
        );
        assert_eq!(
            parts(
                create(
                    state(),
                    signed_in(mona),
                    Json(json!({ "name": "DEPENDENCIES" }))
                )
                .await
            )
            .await,
            conflict("name_taken")
        );
        assert_eq!(
            parts(
                add(
                    state(),
                    signed_in(mona),
                    id(created),
                    Json(json!({ "repositories": "a/a" })),
                )
                .await
            )
            .await,
            invalid("invalid_repositories")
        );
        let many: Vec<String> = (0..24).map(|i| format!("owner/repo-{i}")).collect();
        assert_eq!(
            parts(
                add(
                    state(),
                    signed_in(mona),
                    id(created),
                    Json(json!({ "repositories": many })),
                )
                .await
            )
            .await,
            conflict("too_many_repositories")
        );
        for i in 0..9 {
            watchlists
                .create_at(mona, &format!("List {i}"), &[], at(1))
                .await
                .unwrap();
        }
        assert_eq!(
            parts(
                create(
                    state(),
                    signed_in(mona),
                    Json(json!({ "name": "One more" }))
                )
                .await
            )
            .await,
            conflict("too_many_watchlists")
        );

        // Hubot is told of no watchlist of Mona's, and paths that cannot be are 400.
        let not_found = (StatusCode::NOT_FOUND, Value::Null);
        assert_eq!(
            parts(
                rename(
                    state(),
                    signed_in(hubot),
                    id(created),
                    Json(json!({ "name": "Mine" }))
                )
                .await
            )
            .await,
            not_found
        );
        assert_eq!(
            parts(
                remove(
                    state(),
                    signed_in(hubot),
                    Path((created.to_string(), "a".into(), "a".into())),
                )
                .await
            )
            .await,
            not_found
        );
        assert_eq!(
            parts(delete(state(), signed_in(mona), Path("x".into())).await).await,
            (StatusCode::BAD_REQUEST, Value::Null)
        );
        assert_eq!(
            parts(
                remove(
                    state(),
                    signed_in(mona),
                    Path((created.to_string(), "-a".into(), "a".into())),
                )
                .await
            )
            .await,
            (StatusCode::BAD_REQUEST, Value::Null)
        );

        // Mona's own changes answer her watchlists.
        let (status, body) = parts(
            reorder(
                state(),
                signed_in(mona),
                id(created),
                Json(json!({ "repositories": ["b/b", "a/a"] })),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["watchlists"][0]["repositories"], json!(["b/b", "a/a"]));
        let (status, body) = parts(
            remove(
                state(),
                signed_in(mona),
                Path((created.to_string(), "B".into(), "B".into())),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["watchlists"][0]["repositories"], json!(["a/a"]));
        let (status, body) = parts(delete(state(), signed_in(mona), id(created)).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["watchlists"].as_array().unwrap().len(), 9);
    }
}
