//! Whether BuhTig can reach its database: for the health check (FR-OPS-01), and for the
//! friendly page it shows while it cannot (FR-DB-09).
//!
//! Nothing here reconnects. The pool checks a connection before handing it out and opens
//! a new one in place of a broken one, so BuhTig recovers on its own once the database
//! is back.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use sea_orm::DatabaseConnection;
use tracing::{error, info};

use crate::db;

pub struct Health {
    db: DatabaseConnection,
    /// What the last check found, so that only changes are logged.
    reachable: AtomicBool,
}

impl Health {
    /// Starts out reachable: BuhTig has just connected and migrated.
    pub fn new(db: DatabaseConnection) -> Self {
        Health {
            db,
            reachable: AtomicBool::new(true),
        }
    }

    /// Asks the database for an answer. An outage is logged once as it begins and once
    /// as it ends, however often this is called in between.
    pub async fn database_reachable(&self) -> bool {
        let result = match tokio::time::timeout(db::ACQUIRE_TIMEOUT, self.db.ping()).await {
            Ok(result) => result.map_err(|error| error.to_string()),
            Err(_) => Err(format!("no answer within {:?}", db::ACQUIRE_TIMEOUT)),
        };
        let reachable = result.is_ok();
        if self.reachable.swap(reachable, Ordering::Relaxed) != reachable {
            match result {
                Ok(()) => info!("the database is reachable again"),
                Err(error) => error!("the database is unreachable: {error}"),
            }
        }
        reachable
    }
}

/// `/-/health`: 200 while the database answers, 503 otherwise. The body says only that,
/// with no version, configuration or error (FR-OPS-01).
pub async fn check(State(health): State<Arc<Health>>) -> Response {
    let (status, body) = if health.database_reachable().await {
        (StatusCode::OK, "ok\n")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "unavailable\n")
    };
    (status, [(header::CACHE_CONTROL, "no-store")], body).into_response()
}
