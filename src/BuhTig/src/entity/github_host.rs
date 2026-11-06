//! The GitHub host that the database holds data from (FR-DB-11). GitHub's user IDs, and
//! so BuhTig's users with their credentials, private cache, history and pins, mean
//! something on that host alone, as do the names in the cache.

use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "github_hosts")]
pub struct Model {
    /// `github.host` when the database was first migrated, or `github.com` for a database
    /// that an earlier release migrated, as those read from github.com alone.
    #[sea_orm(primary_key, auto_increment = false)]
    pub host: String,
    pub recorded_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}
