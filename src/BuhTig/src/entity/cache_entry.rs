//! Cached GitHub data, either shared or private to one user (FR-DATA-03, FR-DATA-04).

use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "cache_entries")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    /// [`Scope::key`]. A shared entry has no user, and PostgreSQL treats NULLs as
    /// distinct in a unique key, so `user_id` alone could not keep shared entries
    /// unique.
    #[sea_orm(unique_key = "scope")]
    pub scope: String,
    #[sea_orm(unique_key = "scope")]
    pub resource_key: String,
    /// The user whose PAT fetched the data, or none for the shared cache.
    pub user_id: Option<i64>,
    #[sea_orm(belongs_to, from = "user_id", to = "id", on_delete = "Cascade")]
    pub user: BelongsTo<Option<super::user::Entity>>,
    #[sea_orm(column_type = "JsonBinary")]
    pub data: Json,
    /// Also updated when GitHub confirms that the data is unchanged (FR-DATA-09):
    /// housekeeping deletes entries fetched more than `cache.retention` ago by this
    /// column, never by `expires_at` (FR-DATA-05, FR-DATA-12).
    pub fetched_at: DateTimeUtc,
    pub expires_at: DateTimeUtc,
    /// GitHub's validator, for conditional requests (FR-DATA-09).
    pub etag: Option<String>,
}

impl ActiveModelBehavior for ActiveModel {}

/// Who a cache entry may be served to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Scope {
    /// Public data fetched without a PAT, which anyone may see.
    Shared,
    /// Data fetched with this user's PAT, which only they may see.
    User(i64),
}

impl Scope {
    /// The `scope` column. Set it and `user_id` only from a `Scope`, so they agree.
    pub fn key(self) -> String {
        match self {
            Scope::Shared => "shared".to_owned(),
            Scope::User(id) => format!("user:{id}"),
        }
    }

    /// The `user_id` column.
    pub fn user_id(self) -> Option<i64> {
        match self {
            Scope::Shared => None,
            Scope::User(id) => Some(id),
        }
    }
}
