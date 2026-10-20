//! Migration bookkeeping: each BuhTig version that has migrated this database, so that
//! an older one can refuse to start (FR-DB-07).

use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "schema_versions")]
pub struct Model {
    /// BuhTig's version, such as `0.1.0`.
    #[sea_orm(primary_key, auto_increment = false)]
    pub version: String,
    pub applied_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}
