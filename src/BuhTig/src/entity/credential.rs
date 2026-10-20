//! GitHub access for a user: the sign-in credential, and an optional personal access
//! token. A user has at most one of each.

use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "credentials")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique_key = "kind")]
    pub user_id: i64,
    #[sea_orm(belongs_to, from = "user_id", to = "id", on_delete = "Cascade")]
    pub user: BelongsTo<super::user::Entity>,
    #[sea_orm(unique_key = "kind")]
    pub kind: Kind,
    /// Encrypted with `security.encryption_key` (DR-03).
    pub encrypted_value: Vec<u8>,

    // What Settings may show about a PAT (FR-PAT-04). These are empty for the sign-in
    // credential.
    pub pat_type: Option<PatType>,
    pub last_four: Option<String>,
    /// Scopes or permissions, as GitHub reports them.
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub scopes: Option<Json>,
    pub expires_at: Option<DateTimeUtc>,
    pub status: Option<PatStatus>,
    pub last_validated_at: Option<DateTimeUtc>,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "Text")]
pub enum Kind {
    /// The access token GitHub issued when the user signed in.
    #[sea_orm(string_value = "sign_in")]
    SignIn,
    #[sea_orm(string_value = "pat")]
    Pat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "Text")]
pub enum PatType {
    #[sea_orm(string_value = "classic")]
    Classic,
    #[sea_orm(string_value = "fine_grained")]
    FineGrained,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "Text")]
pub enum PatStatus {
    #[sea_orm(string_value = "valid")]
    Valid,
    /// GitHub rejected it, for example because it was revoked or expired (FR-PAT-07).
    #[sea_orm(string_value = "invalid")]
    Invalid,
}
