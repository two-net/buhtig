//! A person who has signed in with GitHub.

use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    /// GitHub's numeric user ID, which stays the same when the login changes
    /// (FR-AUTH-04).
    #[sea_orm(unique)]
    pub github_id: i64,
    pub login: String,
    /// The display name, which GitHub users may leave empty.
    pub name: Option<String>,
    pub avatar_url: String,
    pub created_at: DateTimeUtc,
    pub last_sign_in_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}
