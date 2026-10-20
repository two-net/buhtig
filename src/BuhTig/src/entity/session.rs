//! A signed-in browser.

use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "sessions")]
pub struct Model {
    /// A hash of the session ID; the ID itself is never stored (DR-02).
    #[sea_orm(primary_key, auto_increment = false)]
    pub id_hash: Vec<u8>,
    pub user_id: i64,
    #[sea_orm(belongs_to, from = "user_id", to = "id", on_delete = "Cascade")]
    pub user: BelongsTo<super::user::Entity>,
    pub created_at: DateTimeUtc,
    pub last_used_at: DateTimeUtc,
    pub expires_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}
