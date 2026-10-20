//! A dashboard a user viewed recently (FR-PERS-01). Housekeeping keeps the 20 newest
//! per user.

use sea_orm::entity::prelude::*;

use super::ResourceKind;

/// How many entries housekeeping keeps per user, the newest by `last_viewed_at`. A user
/// may have more until the next pass, so reads must limit themselves too.
pub const KEPT_PER_USER: u64 = 20;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "history_entries")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique_key = "resource")]
    pub user_id: i64,
    #[sea_orm(belongs_to, from = "user_id", to = "id", on_delete = "Cascade")]
    pub user: BelongsTo<super::user::Entity>,
    #[sea_orm(unique_key = "resource")]
    pub resource_kind: ResourceKind,
    /// `owner/repo` or `org`, as GitHub spells it.
    #[sea_orm(unique_key = "resource")]
    pub resource_name: String,
    pub last_viewed_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}
