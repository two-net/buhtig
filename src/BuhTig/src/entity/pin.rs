//! A dashboard a user pinned (FR-PERS-02). A user has at most 12.

use sea_orm::entity::prelude::*;

use super::ResourceKind;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "pins")]
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
    /// Order among the user's pins, smallest first (FR-PERS-05).
    pub position: i32,
}

impl ActiveModelBehavior for ActiveModel {}
