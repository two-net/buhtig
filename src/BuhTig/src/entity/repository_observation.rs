//! What a repository's stat cards showed when BuhTig read them from GitHub, kept so that its
//! dashboard can tell how they changed (FR-DATA-13, FR-REPO-17). Observations are made only
//! as dashboards are opened, never by crawling GitHub, so they are as sparse as the views.
//!
//! An observation belongs to a cache scope as the data it was made of does (FR-DATA-04): the
//! shared one, or one user's, with the PAT that read it, which it goes with (FR-PAT-05).

use sea_orm::entity::prelude::*;

/// How long observations are kept: those made longer ago are deleted by housekeeping
/// (FR-DB-08). The longest period a dashboard compares is as long (FR-REPO-17).
pub const KEPT_DAYS: i64 = 90;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "repository_observations")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    /// [`super::cache_entry::Scope::key`], as for cache entries.
    #[sea_orm(unique_key = "observation")]
    pub scope: String,
    /// The repository's ID on GitHub, which it keeps when it is renamed or transferred, and
    /// whatever case its name is asked for in. A repository deleted and made again has a new
    /// one, so its observations start again.
    #[sea_orm(unique_key = "observation")]
    pub repository_id: i64,
    /// The UTC day of `observed_at`: a scope keeps one observation of a repository a day,
    /// the latest.
    #[sea_orm(unique_key = "observation")]
    pub day: Date,
    /// The user whose PAT read the figures, or none for the shared scope. Indexed, as is
    /// `credential_id`, for the cascades that delete a user's data with them (DR-04).
    #[sea_orm(indexed)]
    pub user_id: Option<i64>,
    #[sea_orm(belongs_to, from = "user_id", to = "id", on_delete = "Cascade")]
    pub user: BelongsTo<Option<super::user::Entity>>,
    /// The PAT that read the figures, or none for the shared scope. Removing or replacing
    /// it deletes its row, and so its observations (FR-PAT-05).
    #[sea_orm(indexed)]
    pub credential_id: Option<i64>,
    #[sea_orm(belongs_to, from = "credential_id", to = "id", on_delete = "Cascade")]
    pub credential: BelongsTo<Option<super::credential::Entity>>,
    /// When GitHub gave or confirmed the repository, whose stars, forks and open issues these
    /// are. Housekeeping deletes observations by it.
    #[sea_orm(indexed)]
    pub observed_at: DateTimeUtc,
    /// When GitHub gave or confirmed the count of open pull requests, which it searches for
    /// apart from the repository: within `cache.ttl` of `observed_at`.
    pub pull_requests_observed_at: DateTimeUtc,
    pub stars: i64,
    pub forks: i64,
    /// Without the open pull requests, which GitHub counts as open issues too (FR-REPO-02).
    pub open_issues: i64,
    pub open_pull_requests: i64,
}

impl ActiveModelBehavior for ActiveModel {}
