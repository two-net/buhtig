//! The one PostgreSQL database that holds all persistent state (CON-02, FR-DB-01), and
//! its automatic migration at startup (SRS §4.12).

use std::cmp::Ordering;
use std::fmt;
use std::str::FromStr;
use std::time::Duration;

use sea_orm::entity::prelude::ChronoUtc;
use sea_orm::sea_query::{Func, Query};
use sea_orm::sqlx::Connection;
use sea_orm::sqlx::postgres::{PgConnectOptions, PgConnection, PgPoolOptions};
use sea_orm::{
    ActiveModelTrait, ConnectionTrait, DatabaseConnection, DatabaseTransaction, DbErr, EntityTrait,
    IsolationLevel, Set, SqlxPostgresConnector, TransactionTrait,
};
use semver::Version;
use tracing::info;

use crate::config::DatabaseConfig;
use crate::entity::{self, schema_version};

/// OI-04: PostgreSQL 15, the oldest major version the PostgreSQL project still supports
/// at release, in the server's `server_version_num` form.
const MIN_SERVER_VERSION: u32 = 150000;

/// The advisory lock that lets only one BuhTig process migrate at a time (FR-DB-06).
/// The key is "BuhTig" in ASCII.
const MIGRATION_LOCK: i64 = 0x4275_6854_6967;

/// The advisory lock that lets only one BuhTig process do housekeeping at a time
/// (A-07). The key is "BuhTigH" in ASCII.
pub(crate) const HOUSEKEEPING_LOCK: i64 = 0x42_7568_5469_6748;

/// How long a request waits for a database connection. While the database is
/// unreachable, requests thus fail within seconds rather than sqlx's default 30 (FR-DB-09).
pub const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(5);

/// Why BuhTig cannot use the database. No message contains the connection string.
#[derive(Debug)]
pub enum Error {
    Connect(sea_orm::sqlx::Error),
    UnsupportedServer(Option<u32>),
    NewerSchema { database: Version, app: Version },
    UnknownSchemaVersion(String),
    Migrate(DbErr),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Connect(error) => {
                write!(f, "cannot connect to the database (database.url): {error}")
            }
            Error::UnsupportedServer(Some(version)) => write!(
                f,
                "PostgreSQL {} is not supported; BuhTig needs PostgreSQL 15 or newer",
                server_version(*version)
            ),
            Error::UnsupportedServer(None) => f.write_str(
                "the database server does not report its PostgreSQL version; \
                 BuhTig needs PostgreSQL 15 or newer",
            ),
            Error::NewerSchema { database, app } => write!(
                f,
                "the database schema is from BuhTig {database}, newer than this BuhTig \
                 {app}; downgrades are not supported"
            ),
            Error::UnknownSchemaVersion(version) => write!(
                f,
                "the database schema records BuhTig version {version:?}, which is not a \
                 version number"
            ),
            Error::Migrate(error) => write!(f, "database migration failed: {error}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<DbErr> for Error {
    fn from(error: DbErr) -> Self {
        Error::Migrate(error)
    }
}

/// What migration did to the schema, for the startup log (FR-OPS-04).
#[derive(Debug, PartialEq)]
pub enum Migration {
    Created { version: Version },
    Upgraded { from: Version, to: Version },
    UpToDate { version: Version },
}

impl fmt::Display for Migration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Migration::Created { version } => {
                write!(f, "created the database schema for BuhTig {version}")
            }
            Migration::Upgraded { from, to } => {
                write!(f, "upgraded the database schema from BuhTig {from} to {to}")
            }
            Migration::UpToDate { version } => {
                write!(f, "the database schema is up to date for BuhTig {version}")
            }
        }
    }
}

/// Connects to the database in `database.url`, which must run PostgreSQL 15 or newer.
///
/// The config file has already normalized the URL, so that it says everything sqlx
/// needs: TLS for a remote database, and a password, empty if need be.
pub async fn connect(config: &DatabaseConfig) -> Result<DatabaseConnection, Error> {
    let options = PgConnectOptions::from_str(config.url.expose().as_str())
        .map_err(Error::Connect)?
        .application_name("BuhTig")
        // DR-06: the session works in UTC, whatever the server's default.
        .options([("TimeZone", "UTC")]);

    // One plain connection first. The pool would retry a refused connection until it
    // times out, and then report only the timeout rather than why.
    let connection = PgConnection::connect_with(&options)
        .await
        .map_err(Error::Connect)?;
    let version = connection.server_version_num();
    connection.close().await.map_err(Error::Connect)?;
    check_server_version(version)?;
    if let Some(version) = version {
        info!("connected to PostgreSQL {}", server_version(version));
    }

    let pool = PgPoolOptions::new()
        .max_connections(config.max_connections)
        .acquire_timeout(ACQUIRE_TIMEOUT)
        .connect_with(options)
        .await
        .map_err(Error::Connect)?;
    Ok(SqlxPostgresConnector::from_sqlx_postgres_pool(pool))
}

/// Brings the schema in line with the entities (FR-DB-02). It runs in one transaction,
/// so a failure leaves the schema as it was (FR-DB-05).
///
/// Schema sync adds the tables, columns, indexes and foreign keys that are missing, and
/// never drops or alters a table or column. So running it on an up-to-date schema
/// changes nothing (FR-DB-03), and it keeps all data (FR-DB-04). It does drop unique
/// keys that the entities no longer declare; see [`entity`] for what that means for
/// changes to them.
pub async fn migrate(db: &DatabaseConnection) -> Result<Migration, Error> {
    let app = app_version();
    // READ COMMITTED, whatever the database's default: a process that waited for the
    // lock must then see the schema that the other one committed.
    let txn = db
        .begin_with_config(Some(IsolationLevel::ReadCommitted), None)
        .await?;
    lock(&txn).await?;

    // The bookkeeping table first, so that its versions can be checked before the rest
    // of the schema is touched.
    db.get_schema_builder()
        .register(schema_version::Entity)
        .sync(&txn)
        .await?;
    let recorded = schema_version::Entity::find().all(&txn).await?;
    let migration = plan(recorded.iter().map(|row| row.version.as_str()), &app)?;

    entity::schema(db.get_schema_builder()).sync(&txn).await?;
    if !matches!(migration, Migration::UpToDate { .. }) {
        schema_version::ActiveModel {
            version: Set(app.to_string()),
            applied_at: Set(ChronoUtc::now()),
        }
        .insert(&txn)
        .await?;
    }
    txn.commit().await?;
    Ok(migration)
}

/// Holds the migration lock until `txn` ends. A second BuhTig process waits here until
/// the first has committed its migration (FR-DB-06).
async fn lock(txn: &DatabaseTransaction) -> Result<(), DbErr> {
    if !try_lock(txn, MIGRATION_LOCK).await? {
        info!("waiting for another BuhTig process to finish migrating the database");
        txn.execute(Query::select().expr(Func::cust("pg_advisory_xact_lock").arg(MIGRATION_LOCK)))
            .await?;
    }
    Ok(())
}

/// Takes the advisory lock `key` until `txn` ends, unless another process holds it, in
/// which case this returns false at once.
///
/// CON-03 exception: the ORM has no API for advisory locks, so this and [`lock`] call
/// PostgreSQL's lock functions, through the ORM's query builder.
pub(crate) async fn try_lock(txn: &DatabaseTransaction, key: i64) -> Result<bool, DbErr> {
    txn.query_one(Query::select().expr(Func::cust("pg_try_advisory_xact_lock").arg(key)))
        .await?
        .ok_or_else(|| DbErr::RecordNotFound("pg_try_advisory_xact_lock".to_owned()))?
        .try_get_by_index(0)
}

/// Decides what migration does from the versions recorded in the database. A database
/// that a newer BuhTig has migrated is refused (FR-DB-07).
///
/// Versions are compared by semver precedence, which ignores build metadata.
fn plan<'a>(
    recorded: impl IntoIterator<Item = &'a str>,
    app: &Version,
) -> Result<Migration, Error> {
    let mut newest: Option<Version> = None;
    for version in recorded {
        let version =
            Version::parse(version).map_err(|_| Error::UnknownSchemaVersion(version.to_owned()))?;
        if newest
            .as_ref()
            .is_none_or(|newest| version.cmp_precedence(newest).is_gt())
        {
            newest = Some(version);
        }
    }
    let app = app.clone();
    let Some(newest) = newest else {
        return Ok(Migration::Created { version: app });
    };
    match newest.cmp_precedence(&app) {
        Ordering::Less => Ok(Migration::Upgraded {
            from: newest,
            to: app,
        }),
        Ordering::Equal => Ok(Migration::UpToDate { version: app }),
        Ordering::Greater => Err(Error::NewerSchema {
            database: newest,
            app,
        }),
    }
}

fn app_version() -> Version {
    Version::parse(env!("CARGO_PKG_VERSION")).expect("Cargo package versions are semver")
}

fn check_server_version(version: Option<u32>) -> Result<(), Error> {
    match version {
        Some(version) if version >= MIN_SERVER_VERSION => Ok(()),
        _ => Err(Error::UnsupportedServer(version)),
    }
}

/// Formats a `server_version_num` such as 150004 as "15.4", or 90624 as "9.6".
fn server_version(number: u32) -> String {
    let major = number / 10000;
    if major >= 10 {
        format!("{major}.{}", number % 10000)
    } else {
        format!("{major}.{}", number / 100 % 100)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(text: &str) -> Version {
        Version::parse(text).unwrap()
    }

    #[test]
    fn an_empty_database_is_created() {
        assert_eq!(
            plan([], &version("0.1.0")).unwrap(),
            Migration::Created {
                version: version("0.1.0")
            }
        );
    }

    #[test]
    fn an_older_schema_is_upgraded_from_its_newest_version() {
        assert_eq!(
            plan(["0.1.0", "0.2.0-rc.1", "0.1.1"], &version("0.2.0")).unwrap(),
            Migration::Upgraded {
                from: version("0.2.0-rc.1"),
                to: version("0.2.0")
            }
        );
    }

    #[test]
    fn the_same_version_is_up_to_date() {
        assert_eq!(
            plan(["0.1.0", "0.2.0"], &version("0.2.0")).unwrap(),
            Migration::UpToDate {
                version: version("0.2.0")
            }
        );
    }

    #[test]
    fn a_newer_schema_is_refused() {
        let error = plan(["0.1.0", "0.3.0"], &version("0.2.0")).unwrap_err();
        assert_eq!(
            error.to_string(),
            "the database schema is from BuhTig 0.3.0, newer than this BuhTig 0.2.0; \
             downgrades are not supported"
        );
        assert!(matches!(
            plan(["0.2.0"], &version("0.2.0-rc.1")),
            Err(Error::NewerSchema { .. })
        ));
    }

    #[test]
    fn build_metadata_does_not_count() {
        assert_eq!(
            plan(["0.2.0+abc"], &version("0.2.0")).unwrap(),
            Migration::UpToDate {
                version: version("0.2.0")
            }
        );
        assert!(matches!(
            plan(["0.1.0+zzz"], &version("0.2.0+aaa")),
            Ok(Migration::Upgraded { .. })
        ));
    }

    #[test]
    fn an_unknown_schema_version_is_refused() {
        assert!(matches!(
            plan(["0.1.0", "next"], &version("0.2.0")),
            Err(Error::UnknownSchemaVersion(version)) if version == "next"
        ));
    }

    #[test]
    fn postgresql_15_is_the_oldest_supported_server() {
        assert!(check_server_version(Some(150000)).is_ok());
        assert!(check_server_version(Some(160014)).is_ok());
        assert_eq!(
            check_server_version(Some(140019)).unwrap_err().to_string(),
            "PostgreSQL 14.19 is not supported; BuhTig needs PostgreSQL 15 or newer"
        );
        assert!(check_server_version(None).is_err());
    }

    #[test]
    fn server_versions_are_formatted_as_major_and_minor() {
        assert_eq!(server_version(150004), "15.4");
        assert_eq!(server_version(160014), "16.14");
        assert_eq!(server_version(90624), "9.6");
    }
}
