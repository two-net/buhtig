//! A named list of repositories a user watches together (FR-PERS-06). A user has at most 10,
//! each with a name of their own.

use sea_orm::entity::prelude::*;

/// How many watchlists a user may have.
pub const MAX_PER_USER: u64 = 10;

/// The longest name a watchlist may have, in characters.
pub const MAX_NAME_LENGTH: usize = 50;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "watchlists")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique_key = "name")]
    pub user_id: i64,
    #[sea_orm(belongs_to, from = "user_id", to = "id", on_delete = "Cascade")]
    pub user: BelongsTo<super::user::Entity>,
    /// As the user wrote it, trimmed. No two of a user's differ only in letter case, which
    /// the application, not the database, makes sure of.
    #[sea_orm(unique_key = "name")]
    pub name: String,
    pub created_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}
