//! How often each client may try something that would let it guess at a secret, such as
//! whether a token is valid (NFR-SEC-08).
//!
//! Clients are told apart as visitors are, by IP address. The counters are held in memory
//! alone (NFR-REL-02), and they keep hashes rather than addresses (NFR-PRIV-02).

use std::collections::HashMap;
use std::hash::{BuildHasher, RandomState};
use std::sync::{Mutex, MutexGuard, PoisonError};

use sea_orm::entity::prelude::DateTimeUtc;
use sea_orm::sea_query::prelude::chrono::TimeDelta;

use crate::visitors::Visitor;

/// At most so many attempts per client in any window of time.
pub struct Throttle {
    limit: usize,
    window: TimeDelta,
    /// Each client's attempts in the past window, by hashed address.
    attempts: Mutex<HashMap<u64, Vec<DateTimeUtc>>>,
    /// Hashes addresses, so that the counters keep none.
    hasher: RandomState,
}

impl Throttle {
    pub fn new(limit: usize, window: TimeDelta) -> Throttle {
        Throttle {
            limit,
            window,
            attempts: Mutex::default(),
            hasher: RandomState::new(),
        }
    }

    /// Counts an attempt by `client` at `now`, or refuses it, with when the client may
    /// try again.
    pub fn admit(&self, client: &Visitor, now: DateTimeUtc) -> Result<(), DateTimeUtc> {
        let key = self.hasher.hash_one(client);
        let since = now - self.window;
        let mut attempts = self.attempts();
        if !attempts.contains_key(&key) {
            // Adding a client first drops those with nothing left to count, so that only
            // current counters stay in memory.
            attempts.retain(|_, times| times.iter().any(|at| *at > since));
        }
        let times = attempts.entry(key).or_default();
        times.retain(|at| *at > since);
        if times.len() >= self.limit {
            let oldest = times.iter().min().copied().unwrap_or(now);
            return Err(oldest + self.window);
        }
        times.push(now);
        Ok(())
    }

    /// The counters, even if a thread panicked while it held them: every change to them
    /// leaves them consistent.
    fn attempts(&self) -> MutexGuard<'_, HashMap<u64, Vec<DateTimeUtc>>> {
        self.attempts.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderMap;

    use super::*;

    /// `seconds` after a fixed time.
    fn at(seconds: i64) -> DateTimeUtc {
        "2026-10-26T12:00:00Z".parse::<DateTimeUtc>().unwrap() + TimeDelta::seconds(seconds)
    }

    fn client(address: &str) -> Visitor {
        Visitor::of(address.parse().unwrap(), &HeaderMap::new())
    }

    #[test]
    fn each_client_may_try_so_often_in_a_window() {
        let throttle = Throttle::new(2, TimeDelta::minutes(1));
        let alice = client("203.0.113.1");
        assert_eq!(throttle.admit(&alice, at(0)), Ok(()));
        assert_eq!(throttle.admit(&alice, at(10)), Ok(()));
        assert_eq!(throttle.admit(&alice, at(20)), Err(at(60)));
        // Refused attempts do not count.
        assert_eq!(throttle.admit(&alice, at(59)), Err(at(60)));
        // Another client has a limit of their own.
        assert_eq!(throttle.admit(&client("203.0.113.2"), at(20)), Ok(()));

        // An attempt counts for the window alone.
        assert_eq!(throttle.admit(&alice, at(60)), Ok(()));
        assert_eq!(throttle.admit(&alice, at(65)), Err(at(70)));
    }

    #[test]
    fn clients_with_nothing_left_to_count_are_forgotten() {
        let throttle = Throttle::new(1, TimeDelta::minutes(1));
        assert_eq!(throttle.admit(&client("203.0.113.1"), at(0)), Ok(()));
        assert_eq!(throttle.admit(&client("203.0.113.2"), at(30)), Ok(()));
        assert_eq!(throttle.admit(&client("203.0.113.3"), at(61)), Ok(()));
        assert_eq!(throttle.attempts().len(), 2);
    }
}
