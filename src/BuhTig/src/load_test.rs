//! The load test of NFR-PERF-03 and NFR-CAP-01: a hundred users at once, half of them
//! signed in, on the home page and on dashboards served from a fresh cache, with 10,000
//! users registered. BuhTig runs as `main` sets it up, on one worker thread, as it would on
//! a host with one vCPU, over a stand-in for GitHub that answers as much as GitHub would.
//!
//! It takes a few minutes, so it runs only when asked for, from a release build:
//!
//! ```sh
//! cargo test --release load_test -- --ignored --nocapture
//! ```
//!
//! Each user acts as a browser would: it loads a page, its files the first time, and then
//! what the page asks for, at most six requests at a time, as over HTTP/1.1. It then looks
//! at the page for a while before it opens another. Peak memory is the whole test
//! process's, the simulated browsers' and the stand-in's included, so it overstates
//! BuhTig's.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::http::{HeaderMap, Method};
use sea_orm::entity::prelude::ChronoUtc;
use sea_orm::sea_query::prelude::chrono::{SecondsFormat, TimeDelta};
use serde_json::{Map, Value, json};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use url::{Url, form_urlencoded};

use crate::config::{Config, DatabaseConfig, Secret};
use crate::crypto::Sealer;
use crate::github::stub::{Stub, answer, client};
use crate::session::{self, Profile, Sessions};
use crate::test_cluster::cluster;
use crate::{db, web};

/// Users at once (NFR-CAP-01). The first half are signed in.
const USERS: usize = 100;
/// Users registered (NFR-CAP-01), each with a session, a full history and some pins.
const REGISTERED: usize = 10_000;
/// How long users take to arrive, and then how long they are measured for.
const RAMP_UP: Duration = Duration::from_secs(10);
const RUN: Duration = Duration::from_secs(60);
/// How long a user looks at a page before opening another, in milliseconds, at random.
const THINK: (u64, u64) = (2_000, 8_000);
/// How many requests a browser sends to one host at once over HTTP/1.1.
const CONNECTIONS: usize = 6;
/// NFR-PERF-03: how long BuhTig may take to answer, at the 95th percentile.
const BUDGET: Duration = Duration::from_millis(300);
/// NFR-CAP-01: the memory BuhTig may use.
const MEMORY: u64 = 1 << 30;

/// The owner of the repositories that the users open.
const OWNER: &str = "load";
const REPOSITORIES: usize = 20;
/// The organizations that the users open, and how many repositories each has: as many as
/// BuhTig reads of one by default, and fewer.
const ORGANIZATIONS: [(&str, usize); 2] = [("big", 1000), ("mid", 100)];
/// How many of their members show their membership.
const MEMBERS: [(&str, usize); 2] = [("big", 57), ("mid", 10)];

/// What a repository dashboard asks for, besides its summary, and how each is reported.
const REPOSITORY_WIDGETS: [(&str, &str); 7] = [
    ("stats", "repository stats"),
    ("commit-activity", "repository commit-activity"),
    ("languages", "repository languages"),
    ("contributors", "repository contributors"),
    ("issues", "repository issues"),
    ("commits", "repository commits"),
    ("releases", "repository releases"),
];
/// What an organization dashboard asks for, besides its summary.
const ORGANIZATION_WIDGETS: [(&str, &str); 7] = [
    ("stats", "organization stats"),
    ("repositories", "organization repositories"),
    ("languages", "organization languages"),
    ("top-repositories", "organization top-repositories"),
    ("last-push", "organization last-push"),
    ("created-per-year", "organization created-per-year"),
    ("members", "organization members"),
];

#[test]
#[ignore = "takes minutes; run it from a release build, as README.md says"]
fn a_hundred_users_get_fresh_dashboards_within_300_ms() {
    if cfg!(debug_assertions) {
        panic!(
            "a debug build says nothing of how fast BuhTig is: \
             cargo test --release load_test -- --ignored --nocapture"
        );
    }
    allow_open_files();
    let database = cluster().create_database();
    let url = cluster().url(&database);
    let config = Config::parse(&config_file(&url)).expect("the config is valid");

    // BuhTig's own runtime, with one worker thread as on one vCPU, and the browsers'.
    let server = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .unwrap();
    let browsers = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();

    let stub = Stub::new(|request| {
        let query: HashMap<String, String> =
            form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
                .into_owned()
                .collect();
        let (status, link, body) = github(&request.uri().path().to_ascii_lowercase(), &query);
        match link {
            Some(link) => answer(status, &[("link", link.as_str())], &body),
            None => answer(status, &[], &body),
        }
    });
    let address = server.block_on(async {
        let db = db::connect(&config.database).await.unwrap();
        db::migrate(&db).await.unwrap();
        let app = crate::app(&config, &db, Arc::new(client(&stub)));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(web::serve(
            listener,
            app,
            std::future::pending::<()>(),
            Duration::ZERO,
        ));
        address
    });
    let origin = format!("http://{address}");

    let started = Instant::now();
    let cookies = browsers.block_on(register(&config, &url));
    seed_shortcuts(&database);
    println!("registered {REGISTERED} users in {:?}", started.elapsed());

    let assets = browsers.block_on(warm(&origin, &cookies[0]));
    let fetched = stub.requests().len();
    println!("warmed the cache with {fetched} requests to GitHub");

    let (cpu_before, _) = usage();
    let samples = browsers.block_on(run(&origin, &cookies, &assets));
    let (cpu_after, peak) = usage();

    let report = Report::of(&samples);
    report.print(cpu_after - cpu_before, peak);
    let failed: Vec<(u16, &str, &str)> = samples
        .iter()
        .filter(|sample| !sample.ok())
        .map(|sample| (sample.status, sample.path.as_str(), sample.error.as_str()))
        .collect();
    assert!(
        failed.is_empty(),
        "{} requests failed, such as {:?}",
        failed.len(),
        &failed[..failed.len().min(5)]
    );
    assert_eq!(
        stub.requests().len(),
        fetched,
        "everything should have come from a fresh cache"
    );
    for (label, durations) in &report.by_label {
        let p95 = percentile(durations, 0.95);
        assert!(p95 <= BUDGET, "{label}: p95 {p95:?} is over {BUDGET:?}");
    }
    let p95 = percentile(&report.all, 0.95);
    assert!(p95 <= BUDGET, "p95 {p95:?} is over {BUDGET:?}");
    assert!(peak <= MEMORY, "peak memory {peak} B is over {MEMORY} B");
}

/// A config file with the five required keys, and every other key at its default.
fn config_file(database_url: &str) -> String {
    format!(
        r#"
[server]
public_url = "https://buhtig.example.com"

[database]
url = "{database_url}"

[github]
client_id = "Iv1.client-id"
client_secret = "github-client-secret"

[security]
encryption_key = "E9kO4wdc96sDx81yxStONaEoRd/p1+5zlz2JSlcH8Xc="
"#
    )
}

/// Signs in [`REGISTERED`] users, as many at a time as a pool of its own allows, and
/// returns the `Cookie` headers of the first [`USERS`] / 2.
async fn register(config: &Config, url: &str) -> Vec<String> {
    let db = db::connect(&DatabaseConfig {
        url: Secret::new(Url::parse(url).unwrap()),
        max_connections: 16,
    })
    .await
    .unwrap();
    let sessions = Arc::new(Sessions::new(
        db,
        Arc::new(Sealer::new(config.security.encryption_key.expose())),
        session::Settings {
            idle_timeout: config.auth.session_idle_timeout,
            max_age: config.auth.session_max_age,
            allowed_users: BTreeSet::new(),
            secure: true,
        },
    ));
    let mut tasks = JoinSet::new();
    for first in 0..16 {
        let sessions = sessions.clone();
        tasks.spawn(async move {
            let mut cookies = Vec::new();
            for user in (first..REGISTERED).step_by(16) {
                let profile = Profile {
                    github_id: i64::try_from(user).unwrap() + 1,
                    login: format!("user-{user}"),
                    name: Some(format!("User {user}")),
                    avatar_url: format!("https://avatars.githubusercontent.com/u/{user}"),
                };
                let token = Secret::new(format!("gho_load{user}"));
                let cookie = sessions
                    .sign_in(profile, &token, &HeaderMap::new())
                    .await
                    .unwrap();
                if user < USERS / 2 {
                    let cookie = cookie.to_str().unwrap().split(';').next().unwrap();
                    cookies.push((user, cookie.to_owned()));
                }
            }
            cookies
        });
    }
    let mut cookies: Vec<(usize, String)> = tasks.join_all().await.concat();
    cookies.sort();
    cookies.into_iter().map(|(_, cookie)| cookie).collect()
}

/// Gives every registered user a full history and three pins (SRS §5.3).
fn seed_shortcuts(database: &str) {
    cluster().psql(
        database,
        &format!(
            "INSERT INTO history_entries (user_id, resource_kind, resource_name, last_viewed_at) \
             SELECT id, 'repository', '{OWNER}/repo-' || n, now() - make_interval(hours => n) \
             FROM users, generate_series(0, 19) AS n; \
             INSERT INTO pins (user_id, resource_kind, resource_name, position) \
             SELECT id, 'organization', 'org-' || n, n FROM users, generate_series(0, 2) AS n"
        ),
    );
}

/// Asks once for everything the users will, signed in, so that it is cached (a visitor
/// may have only so many dashboards fetched from GitHub an hour). Returns the files that
/// the app's page loads.
async fn warm(origin: &str, cookie: &str) -> Vec<String> {
    let browser = Browser::new(origin, Some(cookie.to_owned()), 0);
    let page = browser.get_text("/").await;
    let mut calls = Vec::new();
    for repository in 0..REPOSITORIES {
        calls.extend(View::Repository(repository).calls(false));
    }
    for (org, _) in ORGANIZATIONS {
        calls.extend(View::Organization(org).calls(false));
    }
    let failed: Vec<(u16, String, String)> = browser
        .all(calls)
        .await
        .into_iter()
        .filter(|sample| !sample.ok())
        .map(|sample| (sample.status, sample.path, sample.error))
        .collect();
    assert!(failed.is_empty(), "warming up failed: {failed:?}");
    files(&page)
}

/// What [`USERS`] users ask for, those sent from when [`RAMP_UP`] ends until [`RUN`] has
/// passed after that.
async fn run(origin: &str, cookies: &[String], assets: &[String]) -> Vec<Sample> {
    let start = Instant::now();
    let measured = start + RAMP_UP;
    let end = measured + RUN;
    let mut users = JoinSet::new();
    for user in 0..USERS {
        let cookie = cookies.get(user).cloned();
        let browser = Browser::new(origin, cookie, user);
        let assets = assets.to_vec();
        users.spawn(async move {
            let mut rng = Rng::new(user);
            tokio::time::sleep(RAMP_UP.mul_f64(rng.unit())).await;
            let signed_in = browser.cookie.is_some();
            let mut samples = Vec::new();
            let mut first = true;
            while Instant::now() < end {
                let view = View::pick(&mut rng);
                samples.push(browser.send(Call::get("page", view.page())).await);
                if first {
                    let files = assets.iter().map(|path| Call::get("asset", path.clone()));
                    samples.extend(browser.all(files.collect()).await);
                    first = false;
                }
                samples.extend(browser.all(view.calls(signed_in)).await);
                let (shortest, longest) = THINK;
                let think = shortest + rng.below(longest - shortest);
                tokio::time::sleep(Duration::from_millis(think)).await;
            }
            samples
        });
    }
    let samples = users.join_all().await.into_iter().flatten();
    samples
        .filter(|sample| sample.sent >= measured && sample.sent < end)
        .collect()
}

/// What a user opens.
#[derive(Clone, Copy)]
enum View {
    Home,
    Repository(usize),
    Organization(&'static str),
}

impl View {
    /// The home page a fifth of the time, a repository's dashboard half of it, and an
    /// organization's for the rest, the larger one twice as often.
    fn pick(rng: &mut Rng) -> View {
        match rng.below(10) {
            0..2 => View::Home,
            2..7 => View::Repository(rng.below(REPOSITORIES as u64) as usize),
            _ if rng.below(3) < 2 => View::Organization(ORGANIZATIONS[0].0),
            _ => View::Organization(ORGANIZATIONS[1].0),
        }
    }

    fn page(self) -> String {
        match self {
            View::Home => "/".to_owned(),
            View::Repository(repository) => format!("/{OWNER}/repo-{repository}"),
            View::Organization(org) => format!("/{org}"),
        }
    }

    /// What the page asks BuhTig for once it has loaded, as the UI does.
    fn calls(self, signed_in: bool) -> Vec<Call> {
        let mut calls = vec![Call::get("session", "/-/api/session".to_owned())];
        let base = match self {
            View::Home => {
                calls.push(Call::get("surprise", "/-/api/surprise".to_owned()));
                if signed_in {
                    calls.push(Call::get("shortcuts", "/-/api/shortcuts".to_owned()));
                }
                return calls;
            }
            View::Repository(repository) => {
                let base = format!("/-/api/repositories/{OWNER}/repo-{repository}");
                calls.push(Call::get("repository", base.clone()));
                for (widget, label) in REPOSITORY_WIDGETS {
                    calls.push(Call::get(label, format!("{base}/{widget}")));
                }
                base
            }
            View::Organization(org) => {
                let base = format!("/-/api/organizations/{org}");
                calls.push(Call::get("organization", base.clone()));
                for (widget, label) in ORGANIZATION_WIDGETS {
                    calls.push(Call::get(label, format!("{base}/{widget}")));
                }
                base
            }
        };
        if signed_in {
            calls.push(Call {
                label: "view",
                method: Method::POST,
                path: format!("{base}/view"),
            });
        }
        calls
    }
}

/// A request a user sends.
struct Call {
    label: &'static str,
    method: Method,
    path: String,
}

impl Call {
    fn get(label: &'static str, path: String) -> Call {
        Call {
            label,
            method: Method::GET,
            path,
        }
    }
}

/// How BuhTig answered one request.
struct Sample {
    label: &'static str,
    path: String,
    sent: Instant,
    took: Duration,
    /// 0 if no answer came.
    status: u16,
    /// The body as it came, compressed if it was.
    bytes: usize,
    /// Why no answer came, if none did.
    error: String,
}

impl Sample {
    fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

/// A simulated browser: a connection pool of its own, and the user's cookie or address.
#[derive(Clone)]
struct Browser {
    client: reqwest::Client,
    origin: Arc<str>,
    cookie: Option<String>,
    /// Told apart by their addresses, as BuhTig tells visitors (FR-DATA-10).
    forwarded: String,
}

impl Browser {
    fn new(origin: &str, cookie: Option<String>, user: usize) -> Browser {
        // TLS is never used, but the client cannot be built without it.
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(rustls::RootCertStore::empty())
        .with_no_client_auth();
        let client = reqwest::Client::builder()
            .no_proxy()
            // So that a compressed body is counted as it came.
            .no_gzip()
            .redirect(reqwest::redirect::Policy::none())
            .pool_max_idle_per_host(CONNECTIONS)
            .tls_backend_preconfigured(tls)
            .build()
            .unwrap();
        Browser {
            client,
            origin: origin.into(),
            cookie,
            forwarded: format!("198.18.{}.{}", user / 250, user % 250 + 1),
        }
    }

    async fn send(&self, call: Call) -> Sample {
        let mut request = self
            .client
            .request(call.method.clone(), format!("{}{}", self.origin, call.path))
            .header("accept-encoding", "gzip, deflate, br, zstd")
            .header("x-forwarded-for", &self.forwarded);
        if let Some(cookie) = &self.cookie {
            request = request.header("cookie", cookie);
        }
        if call.method == Method::POST {
            request = request.header("sec-fetch-site", "same-origin");
        }
        let sent = Instant::now();
        let (status, bytes, error) = match request.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                match response.bytes().await {
                    Ok(body) => (status, body.len(), String::new()),
                    Err(error) => (0, 0, error.to_string()),
                }
            }
            Err(error) => (0, 0, format!("{error:?}")),
        };
        Sample {
            label: call.label,
            path: call.path,
            sent,
            took: sent.elapsed(),
            status,
            bytes,
            error,
        }
    }

    /// Sends `calls`, at most [`CONNECTIONS`] at a time, and waits for every answer.
    async fn all(&self, calls: Vec<Call>) -> Vec<Sample> {
        let connections = Arc::new(Semaphore::new(CONNECTIONS));
        let mut sent = JoinSet::new();
        for call in calls {
            let browser = self.clone();
            let connections = connections.clone();
            sent.spawn(async move {
                let _connection = connections.acquire().await.unwrap();
                browser.send(call).await
            });
        }
        sent.join_all().await
    }

    async fn get_text(&self, path: &str) -> String {
        let response = self
            .client
            .get(format!("{}{path}", self.origin))
            .send()
            .await
            .unwrap();
        response.text().await.unwrap()
    }
}

/// The scripts and styles that the app's `page` loads, as paths.
fn files(page: &str) -> Vec<String> {
    let mut files = Vec::new();
    for attribute in ["src=\"", "href=\""] {
        for (at, _) in page.match_indices(attribute) {
            let rest = &page[at + attribute.len()..];
            let value = &rest[..rest.find('"').unwrap_or(0)];
            if !value.contains(':') && (value.ends_with(".js") || value.ends_with(".css")) {
                files.push(format!("/{}", value.trim_start_matches('/')));
            }
        }
    }
    files
}

/// The samples' durations, by label and in all, each sorted.
struct Report<'a> {
    by_label: BTreeMap<&'static str, Vec<Duration>>,
    all: Vec<Duration>,
    samples: &'a [Sample],
}

impl Report<'_> {
    fn of(samples: &[Sample]) -> Report<'_> {
        let mut by_label: BTreeMap<&'static str, Vec<Duration>> = BTreeMap::new();
        for sample in samples {
            by_label.entry(sample.label).or_default().push(sample.took);
        }
        // The files of the UI come once per user, then from the browser's cache, so
        // they say little of how BuhTig keeps up.
        let mut all: Vec<Duration> = samples
            .iter()
            .filter(|sample| sample.label != "asset")
            .map(|sample| sample.took)
            .collect();
        for durations in by_label.values_mut() {
            durations.sort();
        }
        all.sort();
        Report {
            by_label,
            all,
            samples,
        }
    }

    fn print(&self, cpu: Duration, peak: u64) {
        println!(
            "\n{:<32} {:>6} {:>9} {:>9} {:>9} {:>9}",
            "", "n", "p50", "p95", "max", "KB each"
        );
        let row = |label: &str, durations: &[Duration], bytes: usize| {
            println!(
                "{label:<32} {:>6} {:>9.1?} {:>9.1?} {:>9.1?} {:>9.1}",
                durations.len(),
                percentile(durations, 0.5),
                percentile(durations, 0.95),
                durations.last().copied().unwrap_or_default(),
                bytes as f64 / durations.len().max(1) as f64 / 1000.0,
            );
        };
        let bytes = |label: Option<&str>| -> usize {
            self.samples
                .iter()
                .filter(|sample| label.is_none_or(|label| sample.label == label))
                .map(|sample| sample.bytes)
                .sum()
        };
        for (label, durations) in &self.by_label {
            row(label, durations, bytes(Some(label)));
        }
        row(
            "all but assets",
            &self.all,
            bytes(None) - bytes(Some("asset")),
        );
        let views = self.by_label.get("page").map_or(0, Vec::len);
        println!(
            "\n{views} pages, {:.0} requests a second, {:.0} KB a page, \
             CPU {cpu:.1?} in {RUN:?}, peak memory {:.0} MB{}",
            self.samples.len() as f64 / RUN.as_secs_f64(),
            bytes(None) as f64 / views.max(1) as f64 / 1000.0,
            peak as f64 / 1e6,
            cgroup_peak()
                .map(|peak| format!(" ({:.0} MB in the container)", peak as f64 / 1e6))
                .unwrap_or_default(),
        );
    }
}

/// The `quantile` of sorted `durations`, by the nearest rank.
fn percentile(durations: &[Duration], quantile: f64) -> Duration {
    if durations.is_empty() {
        return Duration::ZERO;
    }
    let rank = (quantile * durations.len() as f64).ceil() as usize;
    durations[rank.clamp(1, durations.len()) - 1]
}

/// Lets this process have as many files open as the system allows it. The simulated
/// browsers' connections are in this process as well as BuhTig's, so they need more than
/// the 1024 that many systems allow by default.
fn allow_open_files() {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: both calls only read or write the struct they are given.
    unsafe {
        assert_eq!(libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit), 0);
        limit.rlim_cur = limit.rlim_max.min(65_536);
        assert_eq!(libc::setrlimit(libc::RLIMIT_NOFILE, &limit), 0);
    }
}

/// The CPU time that this process has used, and its peak resident memory in bytes.
fn usage() -> (Duration, u64) {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: `getrusage` fills in the struct it is given, which is large enough.
    let usage = unsafe {
        assert_eq!(libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()), 0);
        usage.assume_init()
    };
    let time = |time: libc::timeval| {
        Duration::from_secs(time.tv_sec as u64) + Duration::from_micros(time.tv_usec as u64)
    };
    // macOS gives it in bytes, Linux in KiB.
    let unit = if cfg!(target_os = "macos") { 1 } else { 1024 };
    (
        time(usage.ru_utime) + time(usage.ru_stime),
        usage.ru_maxrss as u64 * unit,
    )
}

/// The peak memory of the container this runs in, if it runs in one.
fn cgroup_peak() -> Option<u64> {
    std::fs::read_to_string("/sys/fs/cgroup/memory.peak")
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// A small, seeded pseudo-random generator (xorshift64), so the test needs no crate.
struct Rng(u64);

impl Rng {
    fn new(seed: usize) -> Rng {
        Rng(0x9E37_79B9_7F4A_7C15 ^ (seed as u64 + 1).wrapping_mul(0xBF58_476D_1CE4_E5B9))
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, bound: u64) -> u64 {
        self.next() % bound
    }

    /// A number from 0 to 1.
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// How the stand-in for GitHub answers a GET of `path`, in lowercase: its status, its
/// `Link` header if it has one, and its body, each as large as GitHub's would be.
fn github(path: &str, query: &HashMap<String, String>) -> (u16, Option<String>, String) {
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let ok = |body: Value| (200, None, body.to_string());
    match segments.as_slice() {
        ["repos", owner, name] => ok(repository(owner, name, number(name))),
        ["repos", _, name, "stats", "commit_activity"] => ok(activity(number(name))),
        ["repos", _, _, "languages"] => ok(json!({
            "Rust": 512_345, "TypeScript": 230_100, "HTML": 40_200, "CSS": 21_000,
            "Shell": 9_800, "Dockerfile": 1_200, "Makefile": 900, "JavaScript": 600,
            "Python": 300, "Nix": 120
        })),
        ["repos", _, _, "contributors"] => ok((0..10)
            .map(|n| {
                let mut contributor = account(&format!("contributor-{n}"), 5_000 + n);
                contributor["contributions"] = json!(1_000 / (n + 1));
                contributor
            })
            .collect()),
        ["repos", owner, name, "issues"] => ok((0..10).map(|n| issue(owner, name, n)).collect()),
        ["repos", owner, name, "commits"] => ok((0..10).map(|n| commit(owner, name, n)).collect()),
        ["repos", owner, name, "releases"] => ok((0..5).map(|n| release(owner, name, n)).collect()),
        ["repos", owner, name, "releases", "latest"] => ok(release(owner, name, 0)),
        ["search", "issues"] => ok(json!({
            "total_count": 1_234, "incomplete_results": false, "items": []
        })),
        ["orgs", org] => ok(organization(org)),
        ["orgs", org, "repos"] => {
            let total = ORGANIZATIONS
                .iter()
                .find(|(name, _)| name == org)
                .map_or(0, |(_, total)| *total);
            let page: usize = query
                .get("page")
                .and_then(|page| page.parse().ok())
                .unwrap_or(1);
            let start = (page - 1) * 100;
            let items: Vec<Value> = (start..total.min(start + 100))
                .map(|n| repository(org, &format!("repo-{n}"), n))
                .collect();
            let last = total.div_ceil(100);
            let link = (page < last).then(|| {
                let at = |page: usize| {
                    format!("https://api.github.com/orgs/{org}/repos?sort=pushed&per_page=100&page={page}")
                };
                format!("<{}>; rel=\"next\", <{}>; rel=\"last\"", at(page + 1), at(last))
            });
            (200, link, Value::from(items).to_string())
        }
        ["orgs", org, "public_members"] => {
            let total = MEMBERS
                .iter()
                .find(|(name, _)| name == org)
                .map_or(0, |(_, total)| *total);
            let per_page: usize = query
                .get("per_page")
                .and_then(|per_page| per_page.parse().ok())
                .unwrap_or(30);
            let members: Vec<Value> = (0..total.min(per_page))
                .map(|n| account(&format!("member-{n}"), 9_000 + n))
                .collect();
            let last = total.div_ceil(per_page);
            let link = (last > 1).then(|| {
                let at = |page: usize| {
                    format!("https://api.github.com/orgs/{org}/public_members?per_page={per_page}&page={page}")
                };
                format!("<{}>; rel=\"next\", <{}>; rel=\"last\"", at(2), at(last))
            });
            (200, link, Value::from(members).to_string())
        }
        _ => (404, None, json!({"message": "Not Found"}).to_string()),
    }
}

/// The number at the end of a name such as `repo-7`.
fn number(name: &str) -> usize {
    name.rsplit('-')
        .next()
        .and_then(|n| n.parse().ok())
        .unwrap_or(0)
}

/// `days` ago, as GitHub writes a time.
fn days_ago(days: usize) -> String {
    (ChronoUtc::now() - TimeDelta::days(i64::try_from(days).unwrap()))
        .to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Adds `{name}_url` for each of the `names`, which are apart by spaces, to `object`, under
/// `base`, as GitHub's API links everything.
fn link(mut object: Value, base: &str, names: &str) -> Value {
    let map: &mut Map<String, Value> = object.as_object_mut().unwrap();
    for name in names.split_whitespace() {
        map.insert(format!("{name}_url"), json!(format!("{base}/{name}")));
    }
    object
}

/// The fields of `objects` in one object.
fn merged<const N: usize>(objects: [Value; N]) -> Value {
    let mut merged = Map::new();
    for object in objects {
        if let Value::Object(object) = object {
            merged.extend(object);
        }
    }
    Value::Object(merged)
}

/// A user as GitHub describes one.
fn account(login: &str, id: usize) -> Value {
    link(
        json!({
            "login": login, "id": id, "node_id": format!("MDQ6VXNlcj{id}"),
            "avatar_url": format!("https://avatars.githubusercontent.com/u/{id}?v=4"),
            "gravatar_id": "", "url": format!("https://api.github.com/users/{login}"),
            "html_url": format!("https://github.com/{login}"), "type": "User",
            "user_view_type": "public", "site_admin": false
        }),
        &format!("https://api.github.com/users/{login}"),
        "followers following gists starred subscriptions organizations repos events \
         received_events",
    )
}

/// The `n`th repository, as GitHub describes one: about 6 KB.
fn repository(owner: &str, name: &str, n: usize) -> Value {
    const LANGUAGES: [&str; 8] = [
        "Rust",
        "TypeScript",
        "Go",
        "Python",
        "Java",
        "C++",
        "Shell",
        "Ruby",
    ];
    let api = format!("https://api.github.com/repos/{owner}/{name}");
    // In parts, which `json!` can take.
    let identity = json!({
        "id": 100_000 + n, "node_id": format!("R_kgDOH{n:06}"), "name": name,
        "full_name": format!("{owner}/{name}"), "private": false, "owner": account(owner, 1),
        "html_url": format!("https://github.com/{owner}/{name}"),
        "description": format!("Repository {n} of {owner}, which does something useful for the many people who use it"),
        "fork": n % 7 == 3, "url": api, "created_at": days_ago(30 + n * 5),
        "updated_at": days_ago(n % 30), "pushed_at": days_ago(n),
        "git_url": format!("git://github.com/{owner}/{name}.git"),
        "ssh_url": format!("git@github.com:{owner}/{name}.git"),
        "clone_url": format!("https://github.com/{owner}/{name}.git"),
        "svn_url": format!("https://github.com/{owner}/{name}"),
        "homepage": format!("https://{name}.example.com"), "size": 10_000 + n * 37
    });
    let figures = json!({
        "stargazers_count": 100_000 / (n + 1), "watchers_count": 100_000 / (n + 1),
        "language": LANGUAGES[n % LANGUAGES.len()], "has_issues": true,
        "has_projects": true, "has_downloads": true, "has_wiki": true, "has_pages": false,
        "has_discussions": true, "forks_count": 10_000 / (n + 1), "mirror_url": null,
        "archived": n % 11 == 5, "disabled": false, "open_issues_count": 500 / (n + 1)
    });
    let settings = json!({
        "license": {"key": "mit", "name": "MIT License", "spdx_id": "MIT",
                    "url": "https://api.github.com/licenses/mit", "node_id": "MDc6TGljZW5zZTEz"},
        "allow_forking": true, "is_template": false, "web_commit_signoff_required": false,
        "topics": ["dashboards", "github", "rust", "typescript", "performance"],
        "visibility": "public", "forks": 10_000 / (n + 1), "open_issues": 500 / (n + 1),
        "watchers": 100_000 / (n + 1), "default_branch": "main",
        "network_count": 10_000 / (n + 1), "subscribers_count": 1_000 / (n + 1)
    });
    let mut repository = link(
        merged([identity, figures, settings]),
        &api,
        "forks keys collaborators teams hooks issue_events events assignees branches \
         tags blobs git_tags git_refs trees statuses languages stargazers contributors \
         subscribers subscription commits git_commits comments issue_comment contents \
         compare merges archive downloads issues pulls milestones notifications labels \
         releases deployments",
    );
    repository["organization"] = account(owner, 1);
    repository
}

/// 52 weeks of commit activity.
fn activity(n: usize) -> Value {
    let start = ChronoUtc::now().timestamp() - 52 * 7 * 24 * 60 * 60;
    (0..52)
        .map(|week| {
            let days: Vec<usize> = (0..7).map(|day| (week * 7 + day + n) % 13).collect();
            json!({"week": start + week as i64 * 7 * 24 * 60 * 60,
                   "total": days.iter().sum::<usize>(), "days": days})
        })
        .collect()
}

/// The `n`th issue or pull request updated last.
fn issue(owner: &str, name: &str, n: usize) -> Value {
    let api = format!(
        "https://api.github.com/repos/{owner}/{name}/issues/{}",
        900 - n
    );
    let links = json!({
        "url": api, "repository_url": format!("https://api.github.com/repos/{owner}/{name}"),
        "labels_url": format!("{api}/labels{{/name}}"), "comments_url": format!("{api}/comments"),
        "events_url": format!("{api}/events"), "timeline_url": format!("{api}/timeline"),
        "html_url": format!("https://github.com/{owner}/{name}/issues/{}", 900 - n)
    });
    let content = json!({
        "id": 2_000_000 + n, "node_id": format!("I_kwDOH{n:06}"), "number": 900 - n,
        "title": format!("Widgets wobble when the dashboard loads in a narrow window ({n})"),
        "user": account(&format!("reporter-{n}"), 7_000 + n),
        "labels": [{"id": 1, "name": "bug", "color": "d73a4a", "default": true,
                    "description": "Something isn't working"}],
        "state": if n.is_multiple_of(3) { "closed" } else { "open" }, "locked": false,
        "assignee": null, "assignees": [], "milestone": null, "comments": n * 2,
        "created_at": days_ago(n + 3), "updated_at": days_ago(n), "closed_at": null,
        "author_association": "CONTRIBUTOR",
        "body": "Steps to reproduce: open the dashboard on a phone, then rotate it. ".repeat(8),
        "reactions": {"total_count": 3, "+1": 2, "-1": 0, "laugh": 0, "hooray": 1,
                      "confused": 0, "heart": 0, "rocket": 0, "eyes": 0}
    });
    let mut issue = merged([links, content]);
    if n % 2 == 1 {
        issue["pull_request"] = json!({
            "url": format!("https://api.github.com/repos/{owner}/{name}/pulls/{}", 900 - n),
            "html_url": format!("https://github.com/{owner}/{name}/pull/{}", 900 - n),
            "merged_at": if n.is_multiple_of(3) { json!(days_ago(n)) } else { Value::Null }
        });
    }
    issue
}

/// The `n`th commit on the default branch, newest first.
fn commit(owner: &str, name: &str, n: usize) -> Value {
    let sha = format!("{:040x}", 0xabc_def_u64 + n as u64);
    let person = json!({"name": format!("Author {n}"), "email": format!("author{n}@example.com"),
                        "date": days_ago(n)});
    json!({
        "sha": sha, "node_id": format!("C_kwDOH{n:06}"),
        "commit": {"author": person, "committer": person,
                   "message": format!("Steady the widgets ({n})\n\nThey wobbled on narrow screens, so they now keep their place."),
                   "tree": {"sha": sha, "url": format!("https://api.github.com/repos/{owner}/{name}/git/trees/{sha}")},
                   "url": format!("https://api.github.com/repos/{owner}/{name}/git/commits/{sha}"),
                   "comment_count": 0,
                   "verification": {"verified": false, "reason": "unsigned", "signature": null,
                                    "payload": null, "verified_at": null}},
        "url": format!("https://api.github.com/repos/{owner}/{name}/commits/{sha}"),
        "html_url": format!("https://github.com/{owner}/{name}/commit/{sha}"),
        "comments_url": format!("https://api.github.com/repos/{owner}/{name}/commits/{sha}/comments"),
        "author": account(&format!("author-{n}"), 8_000 + n),
        "committer": account("web-flow", 19_864_447),
        "parents": [{"sha": sha, "url": format!("https://api.github.com/repos/{owner}/{name}/commits/{sha}"),
                     "html_url": format!("https://github.com/{owner}/{name}/commit/{sha}")}]
    })
}

/// The `n`th release, newest first.
fn release(owner: &str, name: &str, n: usize) -> Value {
    let api = format!(
        "https://api.github.com/repos/{owner}/{name}/releases/{}",
        300 - n
    );
    let tag = format!("v{}.0.0", 10 - n);
    json!({
        "url": api, "assets_url": format!("{api}/assets"),
        "upload_url": format!("https://uploads.github.com/repos/{owner}/{name}/releases/{}/assets{{?name,label}}", 300 - n),
        "html_url": format!("https://github.com/{owner}/{name}/releases/tag/{tag}"),
        "id": 300 - n, "author": account("releaser", 4_000), "node_id": format!("RE_kwDOH{n:06}"),
        "tag_name": tag, "target_commitish": "main", "name": format!("Widgets {tag}"),
        "draft": false, "prerelease": false, "created_at": days_ago(n * 30),
        "published_at": days_ago(n * 30), "assets": [],
        "tarball_url": format!("https://api.github.com/repos/{owner}/{name}/tarball/{tag}"),
        "zipball_url": format!("https://api.github.com/repos/{owner}/{name}/zipball/{tag}"),
        "body": "## What's changed\n* Steadier widgets on narrow screens.\n".repeat(20)
    })
}

/// An organization, as GitHub describes one.
fn organization(org: &str) -> Value {
    let api = format!("https://api.github.com/orgs/{org}");
    let profile = json!({
        "login": org, "id": 3_000, "node_id": "O_kgDOAAAAAA", "url": api,
        "avatar_url": "https://avatars.githubusercontent.com/u/3000?v=4",
        "description": format!("The {org} organization, which builds dashboards"),
        "name": format!("The {org} organization"), "company": null,
        "blog": format!("https://{org}.example.com"), "location": "Everywhere",
        "email": null, "twitter_username": null, "is_verified": true
    });
    let figures = json!({
        "has_organization_projects": true, "has_repository_projects": true,
        "public_repos": 1_000, "public_gists": 0, "followers": 5_000, "following": 0,
        "html_url": format!("https://github.com/{org}"), "created_at": days_ago(4_000),
        "updated_at": days_ago(10), "archived_at": null, "type": "Organization"
    });
    link(
        merged([profile, figures]),
        &api,
        "repos events hooks issues members public_members",
    )
}
