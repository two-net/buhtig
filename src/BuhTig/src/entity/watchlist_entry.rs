//! A repository in a watchlist (FR-PERS-07). A watchlist has at most 25. Of the repository
//! itself, only the name is kept: what the watchlist shows of it is read for the viewer each
//! time, as its dashboard reads it (FR-PERS-09), so that nothing GitHub said of it outlives
//! the cache.
//!
//! What the entry's row last showed its user is kept too, for the row to mark what is new
//! since (FR-PERS-11): the latest release's tag, whether the latest workflow run passed or
//! failed, and when the repository was last pushed to, each with when it was shown. It is
//! the entry's user's alone, and goes with the entry, its watchlist, or its user.

use sea_orm::entity::prelude::*;

/// How many repositories a watchlist may have.
pub const MAX_PER_WATCHLIST: u64 = 25;

/// The longest tag that a row remembers, in characters, so that what it is sent stays small.
pub const MAX_TAG_LENGTH: usize = 1024;

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
    /// When the row last showed the repository's latest release, or that it had none.
    pub release_seen_at: Option<DateTimeUtc>,
    /// The tag of that release, `None` if it had none.
    pub release_tag: Option<String>,
    /// When the row last showed a latest workflow run that passed or failed (FR-REPO-14).
    pub run_seen_at: Option<DateTimeUtc>,
    /// `passed` or `failed`, as that run did.
    pub run_outcome: Option<String>,
    /// When the row last showed when the repository was pushed to.
    pub push_seen_at: Option<DateTimeUtc>,
    /// When it showed that the repository was last pushed to.
    pub pushed_at: Option<DateTimeUtc>,
}

impl ActiveModelBehavior for ActiveModel {}
