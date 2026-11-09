//! A repository in a watchlist (FR-PERS-07). A watchlist has at most 25. Only the name is
//! kept: what the watchlist shows of the repository is read for the viewer each time, as its
//! dashboard reads it (FR-PERS-09), so that nothing GitHub said of it outlives the cache.

use sea_orm::entity::prelude::*;

/// How many repositories a watchlist may have.
pub const MAX_PER_WATCHLIST: u64 = 25;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "watchlist_entries")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique_key = "repository")]
    pub watchlist_id: i64,
    #[sea_orm(belongs_to, from = "watchlist_id", to = "id", on_delete = "Cascade")]
    pub watchlist: BelongsTo<super::watchlist::Entity>,
    /// `owner/repo`, as the user gave it. No two of a watchlist's differ only in letter case,
    /// which the application, not the database, makes sure of.
    #[sea_orm(unique_key = "repository")]
    pub repository_name: String,
    /// Order in the watchlist, smallest first (FR-PERS-07).
    pub position: i32,
}

impl ActiveModelBehavior for ActiveModel {}
