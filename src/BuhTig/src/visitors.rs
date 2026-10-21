//! How much visitors may fetch from GitHub (SRS §4.9, A-08).
//!
//! Visitors' requests share one rate limit, BuhTig's OAuth app's (FR-DATA-02), and it bounds
//! how many uncached dashboards they can load. So each visitor may make at most
//! `limits.visitor_fetches_per_hour` dashboard loads an hour that need a fetch from GitHub
//! (FR-DATA-10). And while less than a tenth of that rate limit remains, visitors are
//! served from the cache only, until it resets (FR-DATA-11). Signing in lifts both: a
//! signed-in user's requests count against their own rate limit.
//!
//! Visitors have no cookie (NFR-PRIV-01), so they are told apart by IP address. The
//! counters are held in memory alone (NFR-REL-02), and they keep hashes rather than
//! addresses or dashboards, so that they are no record of who viewed what (NFR-PRIV-02).

#![allow(
    dead_code,
    reason = "the dashboards that identify visitors are still to come (#14, #15)"
)]

use std::collections::HashMap;
use std::fmt;
use std::hash::{BuildHasher, RandomState};
use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::sync::{Mutex, MutexGuard, PoisonError};

use axum::extract::rejection::ExtensionRejection;
use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::HeaderMap;
use axum::http::request::Parts;
use sea_orm::entity::prelude::DateTimeUtc;
use sea_orm::sea_query::prelude::chrono::TimeDelta;
use tracing::warn;

use crate::github::RateLimit;

const X_FORWARDED_FOR: &str = "x-forwarded-for";

const HOUR: TimeDelta = TimeDelta::hours(1);

/// How long one dashboard load goes on fetching: its widgets ask at once, and those whose
/// statistics GitHub is still computing ask again for up to a minute (FR-REPO-10).
/// Fetches for a dashboard this soon after the one that counted are the same load.
const LOAD: TimeDelta = TimeDelta::minutes(2);

/// Who a visitor's request comes from: their IP address, or for IPv6 its /64, which one
/// subscriber usually has to themselves.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Visitor(IpAddr);

impl Visitor {
    /// The visitor that a request from `peer` comes from.
    ///
    /// TLS is terminated in front of BuhTig (A-06), so `peer` is usually a proxy, which
    /// names the address it was reached from at the end of `X-Forwarded-For`. Only a proxy
    /// on this host or a private network is believed, since anyone could write anything
    /// there. The entries are read from the end, past such proxies, to the first public
    /// address, which is the one the nearest of them was reached from.
    pub fn of(peer: IpAddr, headers: &HeaderMap) -> Visitor {
        let mut client = peer.to_canonical();
        if is_internal(client) {
            'entries: for value in headers.get_all(X_FORWARDED_FOR).iter().rev() {
                let Ok(value) = value.to_str() else { break };
                for entry in value.rsplit(',') {
                    // Whoever wrote what cannot be read cannot be believed about the rest.
                    let Some(address) = address(entry) else {
                        break 'entries;
                    };
                    client = address;
                    if !is_internal(client) {
                        break 'entries;
                    }
                }
            }
        }
        Visitor(subscriber(client))
    }
}

/// The visitor a request comes from, which needs the server to have passed on the peer's
/// address, as [`crate::web::serve`] does.
impl<S: Send + Sync> FromRequestParts<S> for Visitor {
    type Rejection = ExtensionRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Visitor, Self::Rejection> {
        let ConnectInfo(peer) = ConnectInfo::<SocketAddr>::from_request_parts(parts, state).await?;
        Ok(Visitor::of(peer.ip(), &parts.headers))
    }
}

/// The address of an `X-Forwarded-For` entry. Some proxies add the port, as in
/// `203.0.113.7:4711` or `[2001:db8::7]:4711`.
fn address(entry: &str) -> Option<IpAddr> {
    let entry = entry.trim();
    let address = entry
        .parse::<IpAddr>()
        .or_else(|_| entry.parse::<SocketAddr>().map(|address| address.ip()))
        .ok()?;
    Some(address.to_canonical())
}

/// Whether a canonical address is on this host or a private network, where a proxy in
/// front of BuhTig would be.
fn is_internal(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let [first, second, ..] = address.octets();
            address.is_loopback()
                || address.is_private()
                || address.is_link_local()
                // 100.64.0.0/10, shared by carrier-grade NAT and some container networks.
                || (first == 100 && second & 0xc0 == 64)
        }
        IpAddr::V6(address) => {
            address.is_loopback() || address.is_unique_local() || address.is_unicast_link_local()
        }
    }
}

/// An IPv6 address's /64.
fn subscriber(address: IpAddr) -> IpAddr {
    match address {
        IpAddr::V6(address) => IpAddr::V6(Ipv6Addr::from_bits(
            address.to_bits() & !u128::from(u64::MAX),
        )),
        address => address,
    }
}

/// Why a visitor's request may not go to GitHub now. Signing in lifts it: a signed-in
/// user's requests count against their own rate limit (FR-DATA-02).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Held {
    /// The visitor has made `limits.visitor_fetches_per_hour` dashboard loads that needed
    /// GitHub in the past hour (FR-DATA-10). They may make another from `until`, or never
    /// when the limit is 0.
    Quota { until: Option<DateTimeUtc> },
    /// Less than a tenth of the rate limit that visitors share remains, until it resets at
    /// `until` (FR-DATA-11).
    Reserve { until: DateTimeUtc },
}

impl fmt::Display for Held {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Held::Quota { until: Some(until) } => write!(
                f,
                "the visitor may make no more dashboard loads from GitHub until {until}"
            ),
            Held::Quota { until: None } => {
                f.write_str("visitors may make no dashboard loads from GitHub")
            }
            Held::Reserve { until } => write!(
                f,
                "less than 10% of visitors' GitHub rate limit remains until {until}"
            ),
        }
    }
}

/// What visitors may still fetch from GitHub.
pub struct Visitors {
    fetches_per_hour: usize,
    counters: Mutex<Counters>,
    /// Hashes addresses and dashboards, so that the counters keep neither.
    hasher: RandomState,
}

#[derive(Default)]
struct Counters {
    /// Each visitor's dashboard loads in the past hour, by hashed address.
    loads: HashMap<u64, Vec<Load>>,
    /// The reset that the reserve was last logged for, so that each is logged once.
    reserve_logged: Option<DateTimeUtc>,
}

/// One dashboard load that needed GitHub.
struct Load {
    /// The hashed dashboard.
    dashboard: u64,
    at: DateTimeUtc,
}

impl Visitors {
    /// Visitors who may each make `fetches_per_hour` dashboard loads an hour that need
    /// GitHub, as `limits.visitor_fetches_per_hour` says.
    pub fn new(fetches_per_hour: u32) -> Visitors {
        Visitors {
            fetches_per_hour: usize::try_from(fetches_per_hour).unwrap_or(usize::MAX),
            counters: Mutex::default(),
            hasher: RandomState::new(),
        }
    }

    /// Lets `visitor` fetch from GitHub at `now` for `dashboard`, such as `/owner/repo`, or
    /// says why not. `reading` is the latest reading of the rate limit that visitors share,
    /// as [`crate::github::Client::visitor_rate_limit`] gives it.
    ///
    /// The fetch that starts a dashboard load counts towards the visitor's limit, and the
    /// others of the same load do not.
    pub fn admit(
        &self,
        visitor: &Visitor,
        dashboard: &str,
        reading: Option<RateLimit>,
        now: DateTimeUtc,
    ) -> Result<(), Held> {
        let mut counters = self.counters();
        // First, so that a visitor held back for everyone's sake loses none of their own.
        if let Some(reading) =
            reading.filter(|limit| u64::from(limit.remaining) * 10 < u64::from(limit.limit))
        {
            let until = reading.reset;
            if counters.reserve_logged.replace(until) != Some(until) {
                warn!(
                    %until,
                    "less than 10% of visitors' GitHub rate limit remains; until it resets, \
                     visitors are served from the cache only"
                );
            }
            return Err(Held::Reserve { until });
        }

        let key = self.hasher.hash_one(visitor.0);
        // GitHub's names ignore case.
        let dashboard = self.hasher.hash_one(dashboard.to_ascii_lowercase());
        let hour_ago = now - HOUR;
        if !counters.loads.contains_key(&key) {
            // Adding a visitor first drops those with nothing left to count, so that only
            // current counters stay in memory.
            counters
                .loads
                .retain(|_, loads| loads.iter().any(|load| load.at > hour_ago));
        }
        let loads = counters.loads.entry(key).or_default();
        loads.retain(|load| load.at > hour_ago);
        if loads
            .iter()
            .any(|load| load.dashboard == dashboard && load.at > now - LOAD)
        {
            return Ok(());
        }
        if loads.len() >= self.fetches_per_hour {
            let until = loads.iter().map(|load| load.at + HOUR).min();
            return Err(Held::Quota { until });
        }
        loads.push(Load { dashboard, at: now });
        Ok(())
    }

    /// The counters, even if a thread panicked while it held them: every change to them
    /// leaves them consistent.
    fn counters(&self) -> MutexGuard<'_, Counters> {
        self.counters.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::*;
    use crate::test_log::capture_log;

    /// `minutes` after a fixed time.
    fn at(minutes: i64) -> DateTimeUtc {
        "2026-10-21T12:00:00Z".parse::<DateTimeUtc>().unwrap() + TimeDelta::minutes(minutes)
    }

    fn visitor(address: &str) -> Visitor {
        Visitor(address.parse().unwrap())
    }

    /// A reading of visitors' rate limit, which resets at `at(60)`.
    fn remaining(remaining: u32) -> Option<RateLimit> {
        Some(RateLimit {
            limit: 5000,
            remaining,
            reset: at(60),
        })
    }

    #[test]
    fn each_visitor_may_make_so_many_dashboard_loads_an_hour() {
        let visitors = Visitors::new(2);
        let alice = visitor("203.0.113.1");
        assert_eq!(visitors.admit(&alice, "/owner/a", None, at(0)), Ok(()));
        // The other fetches of the same load are free, whatever the case of its name.
        assert_eq!(visitors.admit(&alice, "/Owner/A", None, at(1)), Ok(()));
        assert_eq!(visitors.admit(&alice, "/owner/b", None, at(10)), Ok(()));

        let held = Err(Held::Quota {
            until: Some(at(60)),
        });
        assert_eq!(visitors.admit(&alice, "/owner/c", None, at(20)), held);
        // Loading a dashboard again later is another load.
        assert_eq!(visitors.admit(&alice, "/owner/a", None, at(30)), held);
        // Another visitor has a limit of their own.
        let bob = visitor("203.0.113.2");
        assert_eq!(visitors.admit(&bob, "/owner/c", None, at(20)), Ok(()));

        // A load counts for an hour.
        assert_eq!(visitors.admit(&alice, "/owner/c", None, at(60)), Ok(()));
        assert_eq!(
            visitors.admit(&alice, "/owner/d", None, at(65)),
            Err(Held::Quota {
                until: Some(at(70))
            })
        );
    }

    #[test]
    fn a_load_lasts_two_minutes() {
        let visitors = Visitors::new(1);
        let alice = visitor("203.0.113.1");
        let start = at(0);
        assert_eq!(visitors.admit(&alice, "/owner/a", None, start), Ok(()));
        let later = start + LOAD - TimeDelta::seconds(1);
        assert_eq!(visitors.admit(&alice, "/owner/a", None, later), Ok(()));
        assert_eq!(
            visitors.admit(&alice, "/owner/a", None, start + LOAD),
            Err(Held::Quota {
                until: Some(at(60))
            })
        );
    }

    #[test]
    fn a_limit_of_zero_serves_visitors_from_the_cache_only() {
        let visitors = Visitors::new(0);
        assert_eq!(
            visitors.admit(&visitor("203.0.113.1"), "/owner/a", None, at(0)),
            Err(Held::Quota { until: None })
        );
    }

    #[test]
    fn visitors_keep_off_the_last_tenth_of_their_rate_limit() {
        let (log, _guard) = capture_log();
        let visitors = Visitors::new(1);
        let alice = visitor("203.0.113.1");
        let reserve = Err(Held::Reserve { until: at(60) });
        assert_eq!(
            visitors.admit(&alice, "/owner/a", remaining(499), at(0)),
            reserve
        );
        let bob = visitor("203.0.113.2");
        assert_eq!(
            visitors.admit(&bob, "/owner/a", remaining(0), at(1)),
            reserve
        );

        // Exactly a tenth is not less, and the reserve took nothing from Alice's own limit.
        assert_eq!(
            visitors.admit(&alice, "/owner/a", remaining(500), at(2)),
            Ok(())
        );
        assert_eq!(
            visitors.admit(&alice, "/owner/b", None, at(3)),
            Err(Held::Quota {
                until: Some(at(62))
            })
        );

        // Each reset is logged once.
        let next = Some(RateLimit {
            limit: 5000,
            remaining: 1,
            reset: at(120),
        });
        assert_eq!(
            visitors.admit(&alice, "/owner/a", next, at(61)),
            Err(Held::Reserve { until: at(120) })
        );
        let log = String::from_utf8(log.lock().unwrap().clone()).unwrap();
        assert_eq!(
            log.matches("less than 10% of visitors' GitHub rate limit remains")
                .count(),
            2,
            "{log}"
        );
    }

    #[test]
    fn visitors_are_forgotten_an_hour_after_their_last_load() {
        let visitors = Visitors::new(30);
        for n in 0..5 {
            let visitor = visitor(&format!("203.0.113.{n}"));
            visitors.admit(&visitor, "/owner/a", None, at(n)).unwrap();
        }
        assert_eq!(visitors.counters().loads.len(), 5);
        visitors
            .admit(&visitor("203.0.113.9"), "/owner/a", None, at(62))
            .unwrap();
        assert_eq!(visitors.counters().loads.len(), 3);
    }

    fn of(peer: &str, forwarded: &[&str]) -> Visitor {
        let mut headers = HeaderMap::new();
        for value in forwarded {
            headers.append(X_FORWARDED_FOR, HeaderValue::from_str(value).unwrap());
        }
        Visitor::of(peer.parse().unwrap(), &headers)
    }

    #[test]
    fn a_visitor_is_where_the_nearest_proxy_was_reached_from() {
        #[rustfmt::skip]
        let cases: [(&str, &[&str], &str); 25] = [
            ("203.0.113.7", &[], "203.0.113.7"),
            // Anyone could have written the header of a request that no proxy forwarded.
            ("198.51.100.1", &["203.0.113.7"], "198.51.100.1"),
            ("100.63.0.2", &["203.0.113.7"], "100.63.0.2"),
            ("127.0.0.1", &[], "127.0.0.1"),
            ("127.0.0.1", &["203.0.113.7"], "203.0.113.7"),
            // The visitor may have written entries of their own before the proxy's.
            ("127.0.0.1", &["198.51.100.1, 203.0.113.7"], "203.0.113.7"),
            // Proxies on a private network are passed.
            ("10.0.0.2", &["203.0.113.7, 10.0.0.3"], "203.0.113.7"),
            ("10.0.0.2", &["198.51.100.1, 203.0.113.7", "10.0.0.3"], "203.0.113.7"),
            ("127.0.0.1", &["10.0.0.3"], "10.0.0.3"),
            ("172.16.0.2", &["203.0.113.7:4711"], "203.0.113.7"),
            ("192.168.0.2", &["[2001:db8::7]:4711"], "2001:db8::"),
            ("169.254.0.2", &["203.0.113.7"], "203.0.113.7"),
            ("100.64.0.2", &["203.0.113.7"], "203.0.113.7"),
            ("::1", &["203.0.113.7"], "203.0.113.7"),
            ("fd00::1", &["203.0.113.7"], "203.0.113.7"),
            ("fe80::1", &["203.0.113.7"], "203.0.113.7"),
            // As a dual-stack listener gives IPv4 peers.
            ("::ffff:127.0.0.1", &["203.0.113.7"], "203.0.113.7"),
            ("::ffff:203.0.113.7", &[], "203.0.113.7"),
            ("127.0.0.1", &["::ffff:203.0.113.7"], "203.0.113.7"),
            // An entry that is no address ends the walk at the proxy after it.
            ("127.0.0.1", &["203.0.113.7, unknown"], "127.0.0.1"),
            ("127.0.0.1", &["203.0.113.7, unknown, 10.0.0.3"], "10.0.0.3"),
            ("127.0.0.1", &["203.0.113.7, "], "127.0.0.1"),
            // IPv6 visitors by their /64.
            ("2001:db8::1", &[], "2001:db8::"),
            ("2001:db8::ffff:1:2", &[], "2001:db8::"),
            ("2001:db8:0:1::1", &[], "2001:db8:0:1::"),
        ];
        for (peer, forwarded, expected) in cases {
            assert_eq!(
                of(peer, forwarded),
                visitor(expected),
                "{peer} {forwarded:?}"
            );
        }

        let mut headers = HeaderMap::new();
        headers.append(X_FORWARDED_FOR, HeaderValue::from_static("203.0.113.7"));
        headers.append(X_FORWARDED_FOR, HeaderValue::from_bytes(b"\xff").unwrap());
        assert_eq!(
            Visitor::of("127.0.0.1".parse().unwrap(), &headers),
            visitor("127.0.0.1")
        );
    }
}
