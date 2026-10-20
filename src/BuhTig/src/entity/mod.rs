//! The data model (SRS §5.1). These entities are the single source of truth for the
//! schema (CON-03): at every start, `db::migrate` adds whatever tables, columns, indexes
//! and foreign keys they define but the database lacks (§4.12).
//!
//! Schema sync never drops or alters a table or column, so a change here must be safe
//! to apply to a database that already holds data, on every table:
//!
//! - Only add fields. Never remove, rename (`renamed_from` included) or retype one: the
//!   old column would stay behind, and new rows might not satisfy it. FR-DB-04 forbids
//!   dropping user data in any case. A changed type or constraint on an existing column
//!   is not applied; sync only logs a warning about it.
//! - A new field must be an `Option` or have a `default_value`, because existing rows
//!   need a value for it.
//! - Only add unique keys (`unique`, `unique_key`), under a new name; never change or
//!   remove one. Sync drops a unique key that the entities no longer declare, using
//!   `DROP CONSTRAINT`. That fails for the unique indexes that `unique_key` creates, so
//!   BuhTig would no longer start. The same happens to a unique index that someone adds
//!   to these tables by hand.
//! - Enums are stored as text rather than PostgreSQL enum types, which sync cannot
//!   extend with new variants.
//!
//! Every timestamp is a `DateTimeUtc`, stored as `timestamptz` (DR-06). Tables that
//! belong to a user cascade on delete, so deleting the user removes them too (DR-04).

#![allow(
    dead_code,
    reason = "the features that read and write these tables are still to come (#6, #22, #23, #25)"
)]

pub mod cache_entry;
pub mod credential;
pub mod history_entry;
pub mod pin;
pub mod schema_version;
pub mod session;
pub mod user;

use sea_orm::SchemaBuilder;
use sea_orm::entity::prelude::*;

/// Registers every entity, so that migration creates its table.
pub fn schema(builder: SchemaBuilder) -> SchemaBuilder {
    builder
        .register(user::Entity)
        .register(session::Entity)
        .register(credential::Entity)
        .register(cache_entry::Entity)
        .register(history_entry::Entity)
        .register(pin::Entity)
        .register(schema_version::Entity)
}

/// What a dashboard shows, as recorded in history and pins.
#[derive(Clone, Copy, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "Text")]
pub enum ResourceKind {
    #[sea_orm(string_value = "repository")]
    Repository,
    #[sea_orm(string_value = "organization")]
    Organization,
}
