//! What a repository's dashboard shows of the repository as a whole: its header
//! (FR-REPO-01), with its name as GitHub spells it (FR-NAV-04) and its new one if it was
//! renamed or transferred (FR-NAV-05), its stat cards (FR-REPO-02), its commit activity
//! (FR-REPO-03), its languages (FR-REPO-04), its top contributors (FR-REPO-05), its issues
//! and pull requests (FR-REPO-06), its recent commits (FR-REPO-07) and its releases
//! (FR-REPO-08). Then how fast its pull requests are merged and how long its issues stay
//! open (FR-REPO-13), how its workflow runs fare (FR-REPO-14), how many lines change each
//! week (FR-REPO-15), and how often it is released, and downloaded (FR-REPO-16). And how
//! its stat cards' figures changed, as BuhTig observed them (FR-REPO-17, FR-DATA-13).

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
use sea_orm::sea_query::prelude::chrono::{Datelike, SecondsFormat, TimeDelta};
use serde_json::{Value, json};
use tracing::error;
use url::Url;

use crate::accounts::is_account_name;
use crate::cache::{self, Cache, Cached, Outcome, Page, Refused, Source, Stale, Viewer};
use crate::entity::cache_entry::Scope;
use crate::github::{self, List};
use crate::trends::{self, Figures, Observation};
use crate::watchlists;

/// The longest repository name GitHub allows.
const MAX_LENGTH: usize = 100;

/// FR-REPO-03: the weeks of commit activity the chart shows.
const WEEKS: usize = 52;

/// FR-REPO-04: the languages the chart names. The rest are "Other".
const LANGUAGES: usize = 8;

/// FR-REPO-05: the contributors the widget lists.
const CONTRIBUTORS: usize = 10;

/// FR-REPO-06: the issues and pull requests that the overview's widget lists.
const RECENT: usize = 6;

/// FR-REPO-06: the issues or pull requests on each page of the Issues and Pull requests
/// tabs' lists.
const PAGE_SIZE: u64 = 25;

/// FR-REPO-06: how many of what it finds GitHub's search gives, on its first pages, and so
/// how far the tabs' lists reach: 40 pages.
const SEARCH_REACH: u64 = 1000;

/// FR-REPO-06: what is kept of each issue or pull request that the tabs list, as the search
/// for them finds them.
const LIST_FIELDS: &[&str] = &[
    "number",
    "title",
    "state",
    "user.login",
    "created_at",
    "updated_at",
    "html_url",
    "pull_request.merged_at",
];

/// FR-REPO-06: the labels that the tabs' label filter offers, and the longest name that
/// GitHub gives a label.
const LABELS: usize = 100;
const MAX_LABEL: usize = 50;

/// FR-REPO-07: the commits the widget lists.
const COMMITS: usize = 10;

/// FR-REPO-08: the releases the widget lists.
const RELEASES: usize = 5;

/// FR-REPO-13: the pull requests updated last whose merges the Pull requests tab tells,
/// and the open issues and pull requests updated last among which the Issues tab tells the
/// age of the issues.
const VELOCITY_SAMPLE: usize = 100;

/// FR-REPO-13: what is kept of each pull request, as the search for them finds them, and of
/// each open issue.
const PULL_FIELDS: &[&str] = &["created_at", "closed_at", "pull_request.merged_at"];
const ISSUE_FIELDS: &[&str] = &["created_at", "pull_request"];

/// FR-REPO-14: the latest workflow runs on the default branch whose health the Activity tab
/// tells, and what is kept of each.
const WORKFLOW_RUNS: usize = 50;
const RUN_FIELDS: &[&str] = &[
    "name",
    "status",
    "conclusion",
    "run_started_at",
    "created_at",
    "updated_at",
    "html_url",
];

/// FR-REPO-14: the conclusions of the workflow runs that failed. Those cancelled, skipped,
/// neutral or stale neither passed nor failed.
pub(crate) const FAILED: &[&str] = &["failure", "timed_out", "startup_failure"];

/// FR-REPO-16: the latest releases whose cadence and downloads the Releases tab tells, and
/// what is kept of each: of its assets, only how many times each was downloaded.
const RELEASE_HISTORY: usize = 100;
const RELEASE_FIELDS: &[&str] = &[
    "tag_name",
    "draft",
    "prerelease",
    "published_at",
    "created_at",
    "assets.download_count",
];

/// The search for a repository's open pull requests. Its stat cards and its issues and
/// pull requests widget both count them, so the same search is cached once for both.
const OPEN_PULLS: &str = "is:pr is:open";

/// `/-/api/repositories/{owner}/{repo}`: what the dashboard's header shows (FR-REPO-01),
///
/// ```json
/// {"name": "owner/repo", "fetched_at": …, "stale": null | "held" | "github",
///  "owner_avatar_url": …, "description": …, "visibility": "public" | "private" | "internal",
///  "archived": …, "template": …, "fork": …, "parent": "owner/repo", "topics": […],
///  "license": …, "default_branch": …, "homepage": …, "created_at": …, "pushed_at": …}
/// ```
///
/// The name is the repository's as GitHub spells it, whatever case it was asked for in
/// (FR-NAV-04), and its new name if it was renamed or transferred, since the client follows
/// GitHub's redirects (FR-NAV-05). `fetched_at` is when GitHub gave what BuhTig knows of the
/// repository, which the dashboard shows (FR-DATA-06), and `stale` why it is no newer, as
/// [`stale`] tells it. `parent` is the name of the repository a fork was forked from. What
/// GitHub does not say, or says in a form BuhTig does not show, is `null`: links are only to
/// `http` and `https` URLs, and avatars only from `https` ones (NFR-SEC-03). 404 if there is
/// no such repository, or if it is private (FR-ACC-05). 403 when GitHub keeps it from the
/// viewer's credential, with why, as [`denied`] tells it (FR-PAT-08).
///
/// Names that cannot be a repository's are 400, without asking GitHub (FR-SRCH-04). Any
/// other status means that BuhTig cannot tell now. The dashboard then keeps its URL.
pub async fn summary(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    if !is_account_name(&owner) || !is_repository_name(&repo) {
        return status(StatusCode::BAD_REQUEST);
    }
    // A token user reads with their PAT, which may see private repositories (FR-PAT-06).
    // The repository is read for its dashboard, so a visitor's load of that counts once
    // (FR-DATA-10).
    let result = read(&cache, &viewer, &owner, &repo).await;
    if let Some(denied) = denied(&viewer, &result, cache.github_host()) {
        return denied;
    }
    let cached = match data(result) {
        Ok(cached) => cached,
        Err(code) => return status(code),
    };
    match summarized(&cached) {
        Some(summary) => respond(summary),
        None => status(StatusCode::BAD_GATEWAY),
    }
}

/// What [`summary`] answers of the repository that GitHub gave as `cached`, unless GitHub
/// gave no name.
fn summarized(cached: &Cached<Value>) -> Option<Value> {
    let data = &cached.data;
    let name = data.get("full_name").and_then(Value::as_str)?;
    Some(json!({
        "name": name,
        "fetched_at": cached.fetched_at_iso(),
        "stale": stale(cached),
        "owner_avatar_url": link(data.pointer("/owner/avatar_url"), &["https"]),
        "description": text(data, "description"),
        "visibility": visibility(data),
        "archived": data.get("archived").and_then(Value::as_bool).unwrap_or(false),
        "template": data.get("is_template").and_then(Value::as_bool).unwrap_or(false),
        "fork": data.get("fork").and_then(Value::as_bool).unwrap_or(false),
        "parent": data
            .pointer("/parent/full_name")
            .and_then(Value::as_str)
            .filter(|parent| names(parent).is_some()),
        "topics": topics(data),
        "license": data.pointer("/license/name").and_then(Value::as_str),
        "default_branch": text(data, "default_branch"),
        "homepage": link(data.get("homepage"), &["http", "https"]),
        "created_at": text(data, "created_at"),
        "pushed_at": text(data, "pushed_at"),
    }))
}

/// `/-/api/repositories/{owner}/{repo}/stats`: what the dashboard's stat cards show
/// (FR-REPO-02),
///
/// ```json
/// {"stars": …, "forks": …, "watchers": …, "open_issues": …, "open_pull_requests": …,
///  "latest_release": {"tag": …, "published_at": …, "url": …} | null}
/// ```
///
/// Watchers are those who get the repository's notifications, not its stargazers, whom
/// GitHub also calls watchers. Open issues and open pull requests are apart, though
/// GitHub counts both as open issues. The latest release is the one GitHub marks as such,
/// which is never a draft or a prerelease, and `url` its page on GitHub (FR-REPO-12).
///
/// What the figures are made of is recorded as an observation of the repository, if it may
/// be (FR-DATA-13), as [`observation`] tells.
///
/// Its statuses are those of [`summary`], since it reads the repository first. A failure
/// to read the rest is 502.
pub async fn stats(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    let pulls = search(&repository.name, OPEN_PULLS);
    let latest = repository.path(&["releases", "latest"]);
    let (pulls, latest) = tokio::join!(
        cache.get(&repository.viewer, &repository.dashboard, &pulls),
        cache.get_optional(&repository.viewer, &repository.dashboard, &latest),
    );
    let (pulls, latest) = match (data(pulls), data(latest)) {
        (Ok(pulls), Ok(latest)) => (pulls, latest.data),
        (Err(code), _) | (_, Err(code)) => return status(code),
    };
    let Some(figures) = figures(
        &repository.data,
        &pulls.data,
        latest.as_ref(),
        cache.github_host(),
    ) else {
        return status(StatusCode::BAD_GATEWAY);
    };
    observe(&cache, &repository, &pulls).await;
    respond(figures)
}

/// `/-/api/repositories/{owner}/{repo}/trends`: how the repository's stat cards' figures
/// changed, as BuhTig observed them in the scope that the viewer's data is in, over the
/// last 90 days (FR-REPO-17, FR-DATA-14), as [`trends::summarize`] tells it, with when the
/// repository was fetched, as [`dated`] tells it.
///
/// It reads the repository first, with the viewer's credential at least once per
/// `cache.ttl`, so that what was observed of it is told only to who may see it now
/// (FR-ACC-07), and so its statuses are those of [`summary`]. Unlike [`summary`], it tells
/// nothing from a read of the repository older than that, which may no longer be the
/// viewer's to see: 429 for a visitor who may not fetch from GitHub now (FR-DATA-10), and
/// 502 while GitHub fails (FR-DATA-05). What the stat cards show is observed first, if it may
/// be, as [`stats`] observes it: a failure to count the open pull requests only leaves that
/// out. 502 if GitHub left out the repository's ID.
pub async fn trends(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    match repository.stale {
        None => {}
        Some("held") => return status(StatusCode::TOO_MANY_REQUESTS),
        Some(_) => return status(StatusCode::BAD_GATEWAY),
    }
    let Some(id) = repository_id(&repository.data) else {
        return status(StatusCode::BAD_GATEWAY);
    };
    let pulls = search(&repository.name, OPEN_PULLS);
    let pulls = cache
        .get(&repository.viewer, &repository.dashboard, &pulls)
        .await;
    if let Ok(pulls) = data(pulls) {
        observe(&cache, &repository, &pulls).await;
    }
    match trends::read(cache.db(), repository.source, id, ChronoUtc::now()).await {
        Ok(observations) => {
            respond(repository.dated(trends::summarize(repository.source.scope, &observations)))
        }
        Err(error) => {
            error!("cannot read what was observed of a repository: {error}");
            status(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

/// Records what the stat cards show of the repository, from `repository` and the count of
/// its open pull requests, `pulls`, as an observation of it (FR-DATA-13), if it may be. A
/// failure is only logged: the figures are still told.
async fn observe(cache: &Cache, repository: &Under, pulls: &Cached<Value>) {
    let Some(observation) = observation(repository, pulls) else {
        return;
    };
    if let Err(error) = trends::record(cache.db(), &observation).await {
        error!("cannot record what was observed of a repository: {error}");
    }
}

/// The observation of what the stat cards show of the repository, made of `repository` and
/// `pulls` as [`stats`] makes its figures, at the times that GitHub gave or confirmed each.
/// `None` if it must not be made (FR-DATA-13):
///
/// - when either is stale, as during an outage or for a visitor held back, since it would
///   then be no newer than what was observed before;
/// - when they are not of the same scope and PAT, as when GitHub rejected the PAT between
///   the two, since the observation could belong to neither (FR-DATA-04);
/// - in the shared scope, unless the repository is public, as a safeguard (FR-ACC-04);
/// - when GitHub left out the repository's ID or one of the counts.
fn observation(repository: &Under, pulls: &Cached<Value>) -> Option<Observation> {
    if repository.stale.is_some() || pulls.stale.is_some() || repository.source != pulls.source {
        return None;
    }
    if repository.source.scope == Scope::Shared && !cache::is_public_repository(&repository.data) {
        return None;
    }
    let count = |key| {
        let count = repository.data.get(key)?.as_u64()?;
        i64::try_from(count).ok()
    };
    let open_pulls = total(&pulls.data)?;
    Some(Observation {
        source: repository.source,
        repository_id: repository_id(&repository.data)?,
        observed_at: repository.fetched_at,
        pull_requests_observed_at: pulls.fetched_at,
        figures: Figures {
            stars: count("stargazers_count")?,
            forks: count("forks_count")?,
            open_issues: i64::try_from(open_issues(&repository.data, open_pulls)?).ok()?,
            open_pull_requests: i64::try_from(open_pulls).ok()?,
        },
    })
}

/// The repository's ID on GitHub, which it keeps when renamed or transferred.
fn repository_id(repository: &Value) -> Option<i64> {
    repository
        .get("id")
        .and_then(Value::as_i64)
        .filter(|id| *id > 0)
}

/// `/-/api/repositories/{owner}/{repo}/commit-activity`: how many commits the repository's
/// default branch had in each of the last 52 weeks (FR-REPO-03), oldest first,
///
/// ```json
/// {"weeks": [{"week": "2025-10-26", "commits": 3}, …],
///  "fetched_at": …, "stale": null | "held" | "github"}
/// ```
///
/// Each week starts on the Sunday whose date it gives, in UTC, as GitHub counts them. An
/// empty repository has no weeks (FR-REPO-11). `fetched_at` and `stale` say when the weeks
/// were fetched, as [`dated`] tells it, for an export of them to say (FR-EXP-04).
///
/// 202 while GitHub is still computing them: ask again (FR-REPO-10). Its other statuses
/// are those of [`stats`].
pub async fn commit_activity(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    let path = repository.path(&["stats", "commit_activity"]);
    let activity = cache
        .get(&repository.viewer, &repository.dashboard, &path)
        .await;
    let activity = match data(activity) {
        Ok(activity) => activity,
        Err(code) => return status(code),
    };
    match weeks(&activity.data) {
        Some(weeks) => respond(dated_by(json!({ "weeks": weeks }), &activity)),
        None => status(StatusCode::BAD_GATEWAY),
    }
}

/// `/-/api/repositories/{owner}/{repo}/languages`: how many bytes of the repository's code
/// are in each language, as GitHub detects them (FR-REPO-04): the 8 with the most, most
/// first, and the rest together,
///
/// ```json
/// {"languages": [{"name": "Rust", "bytes": 120000}, …], "other": 3456,
///  "fetched_at": …, "stale": null | "held" | "github"}
/// ```
///
/// `other` is apart from the languages named, so that none is taken for a language that
/// GitHub calls "Other". An empty repository has no languages (FR-REPO-11). `fetched_at`
/// and `stale` say when they were fetched, as [`dated`] tells it.
///
/// Its statuses are those of [`commit_activity`].
pub async fn languages(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    let path = repository.path(&["languages"]);
    let languages = cache
        .get(&repository.viewer, &repository.dashboard, &path)
        .await;
    let languages = match data(languages) {
        Ok(languages) => languages,
        Err(code) => return status(code),
    };
    match shares(&languages.data) {
        Some(shares) => respond(dated_by(shares, &languages)),
        None => status(StatusCode::BAD_GATEWAY),
    }
}

/// `/-/api/repositories/{owner}/{repo}/contributors`: up to 10 of the GitHub accounts with
/// the most commits on the repository's default branch (FR-REPO-05), most first, and how
/// many there are,
///
/// ```json
/// {"contributors": [{"login": …, "avatar_url": …, "url": …, "commits": …}, …],
///  "count": 42 | null, "too_large": false, "fetched_at": …, "stale": null | "held" | "github"}
/// ```
///
/// `url` is the account's page on GitHub (FR-REPO-12). Bots count too, as on GitHub. What
/// BuhTig does not show or link to is `null` (NFR-SEC-03). `count` is how many accounts
/// GitHub lists, those without a login too. GitHub tells no count, so it is asked for apart
/// when there are more than 10. GitHub does not list the contributors of its largest
/// repositories: `too_large` then says so, there are none, and `count` is `null`, as it is
/// when GitHub lists them but will not count them. An empty repository has none (FR-REPO-11).
/// `fetched_at` and `stale` say when the list was fetched, or its count if that was fetched
/// earlier, as [`Dating`] tells it, or the repository, when GitHub would not list them.
///
/// Its statuses are those of [`commit_activity`]. A failure to count the contributors is
/// 502.
pub async fn contributors(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    let path = repository.path(&["contributors"]);
    let list = cache
        .get_list(
            &repository.viewer,
            &repository.dashboard,
            &path,
            CONTRIBUTORS,
        )
        .await;
    let list = match list {
        Err(error) if refused(&error) => {
            return respond(repository.dated(json!({
                "contributors": [], "count": null, "too_large": true
            })));
        }
        list => match data(list) {
            Ok(list) => list,
            Err(code) => return status(code),
        },
    };
    let mut dating = Dating::of(&list);
    let list = list.data;
    let count = if list.truncated {
        let count = cache
            .get_count(&repository.viewer, &repository.dashboard, &path)
            .await;
        match count {
            Err(error) if refused(&error) => None,
            count => match data(count) {
                Ok(count) => {
                    dating = dating.and(Dating::of(&count));
                    Some(count.data.max(listed(&list)))
                }
                Err(code) => return status(code),
            },
        }
    } else {
        Some(listed(&list))
    };
    let host = cache.github_host();
    let mut contributors: Vec<(u64, Value)> = list
        .items
        .iter()
        .filter_map(|item| contributor(item, host))
        .collect();
    contributors.sort_by(|(one, _), (other, _)| other.cmp(one));
    contributors.truncate(CONTRIBUTORS);
    let contributors: Vec<Value> = contributors.into_iter().map(|(_, data)| data).collect();
    respond(dating.apply(json!({
        "contributors": contributors, "count": count, "too_large": false
    })))
}

/// Whether GitHub refused to list or count what is under a repository: its contributors,
/// when the history is too large to, or its workflow runs, to a token without access to
/// Actions (FR-REPO-14). The viewer may see the repository, so GitHub refuses the list
/// itself. A rate limit is not a refusal.
fn refused(error: &cache::Error) -> bool {
    matches!(error, cache::Error::GitHub(github::Error::Forbidden { .. }))
}

/// How many items GitHub gave of a list, which it has at least.
fn listed(list: &List) -> u64 {
    u64::try_from(list.items.len()).unwrap_or(u64::MAX)
}

/// `/-/api/repositories/{owner}/{repo}/issues`: how many issues and pull requests the
/// repository has in each state, and the 6 updated last (FR-REPO-06), latest first,
///
/// ```json
/// {"issues": {"open": …, "closed": …} | null,
///  "pull_requests": {"open": …, "merged": …, "closed": …} | null,
///  "recent": [{"number": …, "title": …, "kind": "issue" | "pull_request",
///              "state": "open" | "closed" | "merged", "author": …, "created_at": …,
///              "updated_at": …, "url": …}, …],
///  "fetched_at": …, "stale": null | "held" | "github"}
/// ```
///
/// Closed pull requests are those closed without being merged. Open issues are counted as
/// the stat cards count them, so that the two agree. Issues or pull requests that the
/// repository has turned off on GitHub are `null`, and are not searched for, beyond the open
/// pull requests that the stat cards count anyway. `url` is each one's page on GitHub
/// (FR-REPO-12). What BuhTig does not show or link to is `null` (NFR-SEC-03). `fetched_at`
/// and `stale` say when the oldest of the repository, the counts and the list was fetched,
/// as [`Dating`] tells it.
///
/// Its statuses are those of [`stats`].
pub async fn issues(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    match issues_and_pulls(&cache, &repository).await {
        Ok(body) => respond(body),
        Err(code) => status(code),
    }
}

/// `/-/api/repositories/{owner}/{repo}/issue-list?state=…&label=…&sort=…&page=…`: a page of
/// 25 of the repository's issues, without its pull requests, as its Issues tab lists them
/// (FR-REPO-06),
///
/// ```json
/// {"items": [{"number": …, "title": …, "kind": "issue", "state": "open" | "closed",
///             "author": …, "created_at": …, "updated_at": …, "url": …}, …],
///  "total": 1234, "page": 2, "pages": 40, "per_page": 25, "capped": true,
///  "incomplete": false, "off": false, "fetched_at": …, "stale": null | "held" | "github"}
/// ```
///
/// The query picks which, each part left out for its default, as [`ListView::of`] reads it:
/// `state`, `open` (the default), `closed` or `all`; `label`, one label they must have;
/// `sort`, `updated`, those updated last first (the default), or `oldest`, those opened
/// first first; and `page`, from 1 to 40. Any other value is 400, and GitHub is not asked.
///
/// They are found by GitHub's search, which tells issues from pull requests, as the list of
/// a repository's issues does not, and filters and orders all of them, not one page: only
/// the page asked for is read, in one request, cached in the viewer's scope as every other
/// (FR-DATA-04). `total` is how many the search found, `pages` how many pages of them it
/// reaches, which is no more than 40, since GitHub's search gives only the first 1,000 that
/// it finds: `capped` says that it found more. `incomplete` says that GitHub's search ran
/// out of time, so that it may have found fewer than there are. A repository that has turned
/// issues off on GitHub has none, `off` says so, and GitHub is not asked. Items are as
/// [`issues`] lists them, and `fetched_at` and `stale` say when the page was fetched, as
/// [`dated`] tells it, or the repository when GitHub was not asked.
///
/// Its other statuses are those of [`commit_activity`].
pub async fn issue_list(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    tab_list(&cache, viewer, &owner, &repo, Kind::Issue, &query).await
}

/// `/-/api/repositories/{owner}/{repo}/pull-list?state=…&label=…&sort=…&page=…`: a page of
/// 25 of the repository's pull requests, as its Pull requests tab lists them (FR-REPO-06),
/// as [`issue_list`] lists issues, each with `"kind": "pull_request"` and its `state`,
/// `open`, `merged`, or `closed`, without being merged. Its `state` may be `open` (the
/// default), `merged`, `closed`, those closed without being merged, or `all`.
///
/// Its statuses are those of [`issue_list`].
pub async fn pull_list(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    tab_list(&cache, viewer, &owner, &repo, Kind::PullRequest, &query).await
}

/// `/-/api/repositories/{owner}/{repo}/labels`: the names of up to 100 of the repository's
/// labels, which its Issues and Pull requests tabs offer to filter by (FR-REPO-06), in
/// alphabetical order whatever their letter case,
///
/// ```json
/// {"labels": ["bug", "good first issue", …], "truncated": false}
/// ```
///
/// `truncated` says that it has more. A label whose name the search for issues cannot take,
/// as [`is_label`] tells, is left out.
///
/// Its statuses are those of [`commit_activity`].
pub async fn labels(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    let path = repository.path(&["labels"]);
    let list = cache
        .get_list_of(
            &repository.viewer,
            &repository.dashboard,
            &path,
            LABELS,
            &["name"],
        )
        .await;
    let list = match data(list) {
        Ok(list) => list.data,
        Err(code) => return status(code),
    };
    let mut names: Vec<&str> = list
        .items
        .iter()
        .filter_map(|label| text(label, "name"))
        .filter(|name| is_label(name))
        .collect();
    names.sort_by(|one, other| {
        one.to_lowercase()
            .cmp(&other.to_lowercase())
            .then(one.cmp(other))
    });
    names.dedup();
    respond(json!({ "labels": names, "truncated": list.truncated }))
}

/// `/-/api/repositories/{owner}/{repo}/commits`: the 10 latest commits on the repository's
/// default branch (FR-REPO-07), latest first,
///
/// ```json
/// {"commits": [{"sha": …, "message": …, "author": …, "author_avatar_url": …,
///               "committed_at": …, "url": …}, …]}
/// ```
///
/// `message` is the first line of the commit's message. `author` is the GitHub login of its
/// author, or else the name the commit gives, and `author_avatar_url` the avatar of that
/// GitHub account, if it has one. `committed_at` is when it was committed, which for a
/// commit merged from elsewhere is when it landed. `url` is its page on GitHub
/// (FR-REPO-12). What BuhTig does not show or link to is `null`: avatars only from `https`
/// URLs (NFR-SEC-03). An empty repository has none (FR-REPO-11).
///
/// Its statuses are those of [`commit_activity`].
pub async fn commits(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    // Without a branch, GitHub lists the default branch's.
    let path = repository.path(&["commits"]);
    let list = cache
        .get_list(&repository.viewer, &repository.dashboard, &path, COMMITS)
        .await;
    let list = match list {
        // GitHub's answer for the commits of an empty repository.
        Err(cache::Error::GitHub(github::Error::Status { status: 409, .. })) => {
            return respond(json!({ "commits": [] }));
        }
        list => match data(list) {
            Ok(list) => list.data,
            Err(code) => return status(code),
        },
    };
    let host = cache.github_host();
    let commits: Vec<Value> = list
        .items
        .iter()
        .filter_map(|item| commit(item, host))
        .collect();
    respond(json!({ "commits": commits }))
}

/// `/-/api/repositories/{owner}/{repo}/releases`: the repository's 5 latest releases
/// (FR-REPO-08), latest first, and how many it has,
///
/// ```json
/// {"releases": [{"tag": …, "name": …, "published_at": …, "prerelease": false,
///                "target": "main" | null, "url": …}, …],
///  "count": 12}
/// ```
///
/// Drafts are left out, as from the stat cards' latest release, and so are releases without
/// a tag. `name` is `null` when it only repeats the tag. `target` is the branch or commit
/// that the tag was made from, if GitHub tells it. `url` is the release's page on GitHub
/// (FR-REPO-12). A repository without releases has none. `count` is how many releases GitHub
/// lists to the viewer, drafts among them for one who may see them, as GitHub counts them.
/// GitHub tells no count, so it is asked for apart when there are more than 5.
///
/// Its statuses are those of [`commit_activity`]. A failure to count the releases is 502.
pub async fn releases(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    let path = repository.path(&["releases"]);
    let list = cache
        .get_list(&repository.viewer, &repository.dashboard, &path, RELEASES)
        .await;
    let list = match data(list) {
        Ok(list) => list.data,
        Err(code) => return status(code),
    };
    let count = if list.truncated {
        // The count is cached apart from the list, so it may be older. It is never fewer
        // than the list shows.
        let count = cache
            .get_count(&repository.viewer, &repository.dashboard, &path)
            .await;
        match data(count) {
            Ok(count) => count.data.max(listed(&list)),
            Err(code) => return status(code),
        }
    } else {
        listed(&list)
    };
    let host = cache.github_host();
    let releases: Vec<Value> = list
        .items
        .iter()
        .filter_map(|item| listed_release(item, host))
        .collect();
    respond(json!({ "releases": releases, "count": count }))
}

/// `/-/api/repositories/{owner}/{repo}/merge-velocity`: how the repository's 100 pull
/// requests updated last came to an end (FR-REPO-13),
///
/// ```json
/// {"sampled": 100, "merged": 61, "closed": 9, "median_time_to_merge": 172800 | null,
///  "truncated": true, "fetched_at": …, "stale": null | "held" | "github"}
/// ```
///
/// `sampled` is how many pull requests were read, `merged` how many of them were merged,
/// and `closed` how many were closed without being merged. `median_time_to_merge` is the
/// median time, in seconds, from opening to merging of those merged, `null` if none were.
/// `truncated` says whether the repository has more pull requests than were read. One that
/// has turned pull requests off on GitHub has none, and GitHub is not asked.
/// `fetched_at` and `stale` say when the pull requests were fetched, as [`dated`] tells it,
/// or the repository when GitHub was not asked.
///
/// They are searched for, as issues, rather than listed as pull requests: GitHub's list
/// gives each pull request's head repository, which GitHub may mark private, as a fork
/// made private later, and the shared cache keeps nothing so marked (FR-DATA-04).
///
/// Its statuses are those of [`commit_activity`].
pub async fn merge_velocity(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    if !enabled(&repository.data, "has_pull_requests") {
        return respond(repository.dated(merges(&List::default())));
    }
    let path = github::Path::new(["search", "issues"])
        .expect("names are neither empty nor dots")
        .query("q", &format!("repo:{} is:pr", repository.name))
        .query("sort", "updated")
        .query("order", "desc");
    let list = cache
        .get_list_of(
            &repository.viewer,
            &repository.dashboard,
            &path,
            VELOCITY_SAMPLE,
            PULL_FIELDS,
        )
        .await;
    match data(list) {
        Ok(list) => respond(dated_by(merges(&list.data), &list)),
        Err(code) => status(code),
    }
}

/// `/-/api/repositories/{owner}/{repo}/issue-age`: how long the open issues among the
/// repository's 100 open issues and pull requests updated last have been open (FR-REPO-13),
///
/// ```json
/// {"sampled": 37, "median_age": 5184000 | null, "truncated": true,
///  "fetched_at": …, "stale": null | "held" | "github"}
/// ```
///
/// `sampled` is how many open issues were read, and `median_age` the median time, in
/// seconds, since they were opened, `null` if there were none. `truncated` says whether the
/// repository has more open issues and pull requests than were read. One that has turned
/// issues off on GitHub has none, and GitHub is not asked. `fetched_at` and `stale` say when
/// the issues were fetched, as [`dated`] tells it, or the repository when GitHub was not asked.
///
/// Its statuses are those of [`commit_activity`].
pub async fn issue_age(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    if !enabled(&repository.data, "has_issues") {
        return respond(repository.dated(ages(&List::default(), ChronoUtc::now())));
    }
    let path = repository
        .path(&["issues"])
        .query("state", "open")
        .query("sort", "updated")
        .query("direction", "desc");
    let list = cache
        .get_list_of(
            &repository.viewer,
            &repository.dashboard,
            &path,
            VELOCITY_SAMPLE,
            ISSUE_FIELDS,
        )
        .await;
    match data(list) {
        Ok(list) => respond(dated_by(ages(&list.data, ChronoUtc::now()), &list)),
        Err(code) => status(code),
    }
}

/// `/-/api/repositories/{owner}/{repo}/workflow-runs`: how the repository's 50 latest
/// GitHub Actions workflow runs on its default branch fared (FR-REPO-14),
///
/// ```json
/// {"branch": "main" | null, "sampled": 50, "passed": 45, "failed": 3,
///  "average_duration": 252 | null,
///  "latest": {"name": "CI", "status": "completed", "conclusion": "success",
///             "started_at": …, "url": …} | null,
///  "hidden": false, "fetched_at": …, "stale": null | "held" | "github"}
/// ```
///
/// Only runs for pushes are read: a run for a pull request from a fork's branch of the same
/// name is not the default branch's, and GitHub gives with it the fork, which it may mark
/// private, while the shared cache keeps nothing so marked (FR-DATA-04). `sampled` is how
/// many runs were read. Of them, `passed` succeeded and
/// `failed` failed, timed out or could not start. Those cancelled, skipped, neutral or
/// stale did neither. `average_duration` is the mean time, in seconds, that the completed
/// runs took, `null` if none did. `latest` is the latest run, with its status and its
/// conclusion as GitHub names them, and `url` its page on GitHub (FR-REPO-12). A
/// repository without a default branch has no runs, and GitHub is not asked. `hidden` says
/// that GitHub refused to list the runs to the viewer's credential, as to a fine-grained
/// personal access token without access to Actions. `fetched_at` and `stale` say when the
/// runs were fetched, as [`dated`] tells it, the repository when GitHub was not asked, and
/// now when GitHub refused, since nothing is cached of a refusal.
///
/// Its statuses are those of [`commit_activity`].
pub async fn workflow_runs(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    match runs(&cache, &repository).await {
        Ok(runs) => respond(runs),
        Err(code) => status(code),
    }
}

/// What [`workflow_runs`] answers for the repository, or the status that says why it cannot.
/// A watchlist's [`glance`] reads the runs here too, so that both read them under one key of
/// the cache.
async fn runs(cache: &Cache, repository: &Under) -> Result<Value, StatusCode> {
    let host = cache.github_host();
    let Some(branch) = text(&repository.data, "default_branch") else {
        return Ok(repository.dated(health(None, &List::default(), false, host)));
    };
    let path = repository
        .path(&["actions", "runs"])
        .query("branch", branch)
        .query("event", "push")
        .query("exclude_pull_requests", "true");
    let list = cache
        .get_list_of(
            &repository.viewer,
            &repository.dashboard,
            &path,
            WORKFLOW_RUNS,
            RUN_FIELDS,
        )
        .await;
    match list {
        // GitHub just answered, and nothing is cached of a refusal.
        Err(error) if refused(&error) => Ok(dated(
            health(Some(branch), &List::default(), true, host),
            ChronoUtc::now(),
            None,
        )),
        list => {
            data(list).map(|list| dated_by(health(Some(branch), &list.data, false, host), &list))
        }
    }
}

/// `/-/api/repositories/{owner}/{repo}/glance`: what a watchlist shows of the repository
/// (FR-PERS-08), which is what [`summary`] answers, and
///
/// ```json
/// {"latest_release": {"release": {"tag": …, "published_at": …, "url": …} | null,
///                     "fetched_at": …, "stale": …},
///  "workflow_runs": {…, "fetched_at": …, "stale": …}}
/// ```
///
/// `latest_release` is the release that GitHub marks as the latest, as the stat cards show it
/// ([`stats`]), and `workflow_runs` what [`workflow_runs`] answers. Each says when its data
/// was fetched, as [`dated`] tells it, and is `{"failure": "github" | "unavailable" | "held"}`
/// in its place when it cannot be read, as a dashboard's widget would fail apart from the
/// others (FR-REPO-09).
///
/// `trend` is how the repository's stars, forks, open issues and open pull requests changed
/// over a week, as BuhTig observed them (FR-PERS-10), as [`trend`] tells it. With
/// `?watchlist={id}`, of the viewer's watchlist that has the repository by this name, `since`
/// is what the row is to mark as new since it last showed the repository to them
/// (FR-PERS-11), as [`watchlists::marks`] tells it, and `null` otherwise. Neither asks GitHub
/// anything, and a glance records nothing: neither an observation, which needs the count of
/// the open pull requests, a search, nor what the row showed, which it says once loaded.
///
/// The repository is read first, with the viewer's credential at least once per `cache.ttl`,
/// as its dashboard reads it, so that a watchlist tells each repository only to whom may see
/// it now, whatever else the watchlist holds (FR-ACC-06, FR-ACC-07). The rest is read under
/// the same keys of the cache as the dashboard reads it, with conditional requests: a
/// repository costs at most three requests to GitHub per `cache.ttl`, none of them a search or
/// a statistic, and none at all for a repository whose dashboard was opened lately
/// (FR-PERS-09). A refresh of its dashboard refreshes it too.
///
/// Watchlists are signed-in users' alone (FR-ACC-02), so this is 401 for a visitor. Its
/// statuses are otherwise those of [`summary`], including 403 with why GitHub keeps the
/// repository from the viewer's credential, and 400 for a watchlist's ID that cannot be one.
pub async fn glance(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if !is_account_name(&owner) || !is_repository_name(&repo) {
        return status(StatusCode::BAD_REQUEST);
    }
    let watchlist = match query.get("watchlist").map(|id| watchlists::id_of(id)) {
        None => None,
        Some(Some(id)) => Some(id),
        Some(None) => return status(StatusCode::BAD_REQUEST),
    };
    let Some(user_id) = viewer.user_id() else {
        return status(StatusCode::UNAUTHORIZED);
    };
    let host = cache.github_host();
    let result = read(&cache, &viewer, &owner, &repo).await;
    if let Some(denied) = denied(&viewer, &result, host) {
        return denied;
    }
    let cached = match data(result) {
        Ok(cached) => cached,
        Err(code) => return status(code),
    };
    let Some(mut glance) = summarized(&cached) else {
        return status(StatusCode::BAD_GATEWAY);
    };
    let repository = match within(viewer, &owner, &repo, cached) {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    let latest = repository.path(&["releases", "latest"]);
    let (latest, runs) = tokio::join!(
        cache.get_optional(&repository.viewer, &repository.dashboard, &latest),
        runs(&cache, &repository),
    );
    let latest = data(latest).map(|latest| {
        let found = latest.data.as_ref().and_then(|found| release(found, host));
        dated_by(json!({ "release": found }), &latest)
    });
    // GitHub rejected the signed-in user's credential, and so signed them out (FR-AUTH-09).
    if [&latest, &runs].contains(&&Err(StatusCode::UNAUTHORIZED)) {
        return status(StatusCode::UNAUTHORIZED);
    }
    let shown = shown(&repository, &latest, &runs);
    let marks = async {
        let id = watchlist?;
        let name = format!("{owner}/{repo}");
        match watchlists::marked(cache.db(), user_id, id, &name, &shown).await {
            Ok(marks) => marks,
            Err(error) => {
                error!("cannot read what a watchlist's row showed: {error}");
                None
            }
        }
    };
    let (trend, since) = tokio::join!(trend(&cache, &repository, ChronoUtc::now()), marks);
    glance["latest_release"] = part(latest);
    glance["workflow_runs"] = part(runs);
    glance["trend"] = trend;
    glance["since"] = since.into();
    respond(glance)
}

/// What a watchlist's row shows of the repository, of its parts that loaded, to tell what is
/// new in it (FR-PERS-11): the tag of its latest release, how its latest workflow run ended,
/// and when it was last pushed to.
fn shown(
    repository: &Under,
    latest: &Result<Value, StatusCode>,
    runs: &Result<Value, StatusCode>,
) -> watchlists::Shown {
    watchlists::Shown {
        release: latest.as_ref().ok().map(|latest| {
            latest
                .pointer("/release/tag")
                .and_then(Value::as_str)
                .map(str::to_owned)
        }),
        outcome: runs.as_ref().ok().and_then(|runs| {
            let conclusion = runs.pointer("/latest/conclusion")?.as_str()?;
            watchlists::Outcome::of(conclusion)
        }),
        pushed_at: time(&repository.data, "pushed_at"),
    }
}

/// How the repository's stars, forks, open issues and open pull requests changed over a week,
/// as a watchlist's row tells it (FR-PERS-10), as [`trends::change`] tells it, from what was
/// observed of it in the scope that its data is in, with its PAT if it has one: so that no one
/// is told what another's PAT observed (FR-DATA-14). `null` unless GitHub gave or confirmed the
/// repository to the viewer within `cache.ttl`, as for the Activity tab's [`trends`], and
/// `{"failure": "unavailable"}` when the database failed. It observes nothing.
async fn trend(cache: &Cache, repository: &Under, now: DateTimeUtc) -> Value {
    if repository.stale.is_some() {
        return Value::Null;
    }
    let Some(id) = repository_id(&repository.data) else {
        return Value::Null;
    };
    match trends::read(cache.db(), repository.source, id, now).await {
        Ok(observations) => {
            trends::change(repository.source.scope, &observations, trends::ROW_PERIOD)
        }
        Err(error) => {
            error!("cannot read what was observed of a repository: {error}");
            part(Err(StatusCode::SERVICE_UNAVAILABLE))
        }
    }
}

/// A part of a [`glance`], or why it could not be read, as the UI tells it of a widget that
/// failed: `"held"` when the viewer may not fetch from GitHub now, `"unavailable"` when the
/// database failed, and `"github"` when GitHub did.
fn part(result: Result<Value, StatusCode>) -> Value {
    let failure = match result {
        Ok(part) => return part,
        Err(StatusCode::TOO_MANY_REQUESTS) => "held",
        Err(StatusCode::SERVICE_UNAVAILABLE) => "unavailable",
        Err(_) => "github",
    };
    json!({ "failure": failure })
}

/// `/-/api/repositories/{owner}/{repo}/code-frequency`: how many lines were added to and
/// deleted from the repository's default branch in each of the last 52 weeks
/// (FR-REPO-15), oldest first,
///
/// ```json
/// {"weeks": [{"week": "2025-10-26", "additions": 1200, "deletions": 340}, …],
///  "too_large": false, "fetched_at": …, "stale": null | "held" | "github"}
/// ```
///
/// Each week starts on the Sunday whose date it gives, in UTC, as GitHub counts them, and
/// the last is the current week. A week that GitHub leaves out had no changes. An empty
/// repository has no weeks (FR-REPO-11). GitHub does not compute the code frequency of
/// repositories with 10,000 commits or more: `too_large` then says so, and there are no
/// weeks. `fetched_at` and `stale` say when the weeks were fetched, as [`dated`] tells it,
/// or the repository, when GitHub would not compute them.
///
/// Its statuses are those of [`commit_activity`]: 202 while GitHub is still computing it.
pub async fn code_frequency(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    let path = repository.path(&["stats", "code_frequency"]);
    let frequency = cache
        .get(&repository.viewer, &repository.dashboard, &path)
        .await;
    let frequency = match frequency {
        // GitHub's answer for a repository with 10,000 commits or more.
        Err(cache::Error::GitHub(github::Error::Status { status: 422, .. })) => {
            return respond(repository.dated(json!({ "weeks": [], "too_large": true })));
        }
        frequency => match data(frequency) {
            Ok(frequency) => frequency,
            Err(code) => return status(code),
        },
    };
    match changes(&frequency.data, ChronoUtc::now()) {
        Some(weeks) => respond(dated_by(
            json!({ "weeks": weeks, "too_large": false }),
            &frequency,
        )),
        None => status(StatusCode::BAD_GATEWAY),
    }
}

/// `/-/api/repositories/{owner}/{repo}/release-cadence`: how often the repository was
/// released, and how many times its releases' files were downloaded, over its 100 latest
/// releases (FR-REPO-16),
///
/// ```json
/// {"sampled": 100, "stable": 80, "prereleases": 20, "average_interval": 1036800 | null,
///  "assets": 240, "downloads": 123456, "truncated": true,
///  "fetched_at": …, "stale": null | "held" | "github"}
/// ```
///
/// Drafts are left out, as from the releases widget, and so are releases without a tag.
/// `sampled` is how many releases are left, `stable` and `prereleases` how many of them are
/// each. `average_interval` is the mean time, in seconds, between one release and the next,
/// `null` with fewer than two. `assets` is how many files they have, and `downloads` how many
/// times all were downloaded.
/// `truncated` says whether the repository has more releases than were read. `fetched_at` and
/// `stale` say when the releases were fetched, as [`dated`] tells it.
///
/// Its statuses are those of [`commit_activity`].
pub async fn release_cadence(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, viewer, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    let path = repository.path(&["releases"]);
    let list = cache
        .get_list_of(
            &repository.viewer,
            &repository.dashboard,
            &path,
            RELEASE_HISTORY,
            RELEASE_FIELDS,
        )
        .await;
    match data(list) {
        Ok(list) => respond(dated_by(cadence(&list.data), &list)),
        Err(code) => status(code),
    }
}

/// `POST /-/api/repositories/{owner}/{repo}/refresh`: makes the next requests for the
/// repository's dashboard ask GitHub, however fresh what is cached (FR-DATA-07), as
/// [`refreshed`] answers.
pub async fn refresh(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    if !is_account_name(&owner) || !is_repository_name(&repo) {
        return status(StatusCode::BAD_REQUEST);
    }
    refreshed(cache.refresh(&viewer, &format!("/{owner}/{repo}")))
}

/// The answer to a request to refresh a dashboard: 204 once it is, and 401 for a visitor,
/// since only signed-in users may (FR-ACC-02). 429 if it was refreshed less than a minute
/// ago, with `Retry-After` and `{"until": …}`, when it may be again.
///
/// It changes state, so it is no GET, and other origins' pages cannot send it
/// ([`crate::security`], NFR-SEC-02).
pub(crate) fn refreshed(result: Result<(), Refused>) -> Response {
    match result {
        Ok(()) => status(StatusCode::NO_CONTENT),
        Err(Refused::SignInRequired) => status(StatusCode::UNAUTHORIZED),
        Err(Refused::TooSoon { until }) => {
            // In whole seconds, rounded up, so that it is not too soon still.
            let wait = ((until - ChronoUtc::now()).num_milliseconds().max(0) + 999) / 1000;
            (
                StatusCode::TOO_MANY_REQUESTS,
                [(header::CACHE_CONTROL, "no-store")],
                [(header::RETRY_AFTER, wait.max(1).to_string())],
                Json(json!({ "until": until.to_rfc3339_opts(SecondsFormat::Millis, true) })),
            )
                .into_response()
        }
    }
}

/// Whether `name` can be a GitHub repository's (FR-SRCH-04): up to 100 letters, digits,
/// hyphens, underscores and periods, other than `.` and `..`. The search box checks the
/// same rule, in `search/parse.ts`.
pub fn is_repository_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_LENGTH
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// A repository, for what is read under it, such as its stat cards' figures.
struct Under {
    viewer: Viewer,
    /// The dashboard's path, with the names as the URL has them.
    dashboard: String,
    /// `owner/repo`, as GitHub spells it.
    name: String,
    /// The repository, as GitHub gave it.
    data: Value,
    /// When GitHub gave the repository, and why it is no newer, as [`stale`] tells it.
    fetched_at: DateTimeUtc,
    stale: Option<&'static str>,
    /// Whose the repository's data is: what is made of it is theirs alone too.
    source: Source,
}

impl Under {
    /// `body`, made from the repository alone without asking GitHub more, with when the
    /// repository was fetched, as [`dated`] tells it.
    fn dated(&self, body: Value) -> Value {
        self.dating().apply(body)
    }

    /// When GitHub gave the repository, and why it is no newer.
    fn dating(&self) -> Dating {
        Dating {
            fetched_at: self.fetched_at,
            stale: self.stale,
        }
    }

    /// The path of what is under the repository on GitHub, such as `["languages"]`, by the
    /// names GitHub gave: so that it is cached once whatever case the dashboard was opened
    /// in, and under the new names of a repository that was renamed or transferred.
    fn path(&self, segments: &[&str]) -> github::Path {
        let (owner, repo) = self.name.split_once('/').expect("names() checked it");
        let path = ["repos", owner, repo].into_iter();
        github::Path::new(path.chain(segments.iter().copied()))
            .expect("names are neither empty nor dots")
    }
}

/// The repository `owner/repo`, read for the viewer as [`summary`] reads it, for what is
/// read under it, or the status that says why it cannot be: those of [`summary`].
async fn under(
    cache: &Cache,
    viewer: Viewer,
    owner: &str,
    repo: &str,
) -> Result<Under, StatusCode> {
    if !is_account_name(owner) || !is_repository_name(repo) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let cached = repository(cache, &viewer, owner, repo).await?;
    within(viewer, owner, repo, cached)
}

/// The repository `owner/repo`, which the cache had for the viewer as `cached`, for what is
/// read under it, or 502 if GitHub gave no name of it that can be a repository's.
fn within(
    viewer: Viewer,
    owner: &str,
    repo: &str,
    cached: Cached<Value>,
) -> Result<Under, StatusCode> {
    let (fetched_at, stale, source) = (cached.fetched_at, stale(&cached), cached.source);
    let data = cached.data;
    let name = data
        .get("full_name")
        .and_then(Value::as_str)
        .filter(|name| names(name).is_some())
        .ok_or(StatusCode::BAD_GATEWAY)?
        .to_owned();
    Ok(Under {
        viewer,
        dashboard: format!("/{owner}/{repo}"),
        name,
        data,
        fetched_at,
        stale,
        source,
    })
}

/// `body`, a figure of what is under a repository, with when GitHub gave the data it was
/// made from, as `fetched_at`, and why that is no newer, as `stale`, as the summary tells
/// them (FR-DATA-05, FR-DATA-06): so that a comparison can say so of each of its sections,
/// whose data may be fetched at other times than the repository (FR-CMP-06).
fn dated(mut body: Value, fetched_at: DateTimeUtc, stale: Option<&'static str>) -> Value {
    if let Some(fields) = body.as_object_mut() {
        fields.insert("fetched_at".into(), cache::iso(fetched_at).into());
        fields.insert("stale".into(), stale.into());
    }
    body
}

/// `body`, made from `cached`, with when it was fetched, as [`dated`] tells it.
fn dated_by<T>(body: Value, cached: &Cached<T>) -> Value {
    Dating::of(cached).apply(body)
}

/// When GitHub gave the data that a figure was made from, and why that is no newer, as
/// [`dated`] tells them (FR-DATA-05, FR-DATA-06). Of a figure made from several parts, such
/// as counts of several searches, they are those of the part fetched first, and it is stale
/// if any part is, so that an export of it says no more than BuhTig knows (FR-EXP-04).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Dating {
    pub(crate) fetched_at: DateTimeUtc,
    pub(crate) stale: Option<&'static str>,
}

impl Dating {
    /// When `cached` was fetched, and why it is no newer.
    pub(crate) fn of<T>(cached: &Cached<T>) -> Self {
        Self {
            fetched_at: cached.fetched_at,
            stale: stale(cached),
        }
    }

    /// Of a figure made from this part and `other`: the earlier of their fetches, and stale
    /// if either is.
    pub(crate) fn and(self, other: Self) -> Self {
        Self {
            fetched_at: self.fetched_at.min(other.fetched_at),
            stale: self.stale.or(other.stale),
        }
    }

    /// `body`, with when its data was fetched, as [`dated`] tells it.
    pub(crate) fn apply(self, body: Value) -> Value {
        dated(body, self.fetched_at, self.stale)
    }
}

/// The repository `owner/repo`, as the cache has it for the viewer, or the status that
/// says why it has none.
async fn repository(
    cache: &Cache,
    viewer: &Viewer,
    owner: &str,
    repo: &str,
) -> Result<Cached<Value>, StatusCode> {
    data(read(cache, viewer, owner, repo).await)
}

/// What the cache has of the repository `owner/repo` for the viewer.
async fn read(
    cache: &Cache,
    viewer: &Viewer,
    owner: &str,
    repo: &str,
) -> Result<Outcome<Value>, cache::Error> {
    let path = github::Path::new(["repos", owner, repo]).expect("names are neither empty nor dots");
    cache.get(viewer, &format!("/{owner}/{repo}"), &path).await
}

/// The answer for a resource that GitHub keeps from the viewer's credential, rather than
/// hides, so that the dashboard can say how to get access (FR-PAT-08): 403 with
///
/// - `{"denied": "sso", "url": …}` when an organization requires the credential to be
///   authorized for its single sign-on, with where to do so if GitHub says, or `null`;
/// - `{"denied": "token"}` when GitHub refuses a token user's PAT, as when an organization
///   has not approved it, or forbids tokens that live as long.
///
/// `None` for any other result.
pub(crate) fn denied<T>(
    viewer: &Viewer,
    result: &Result<Outcome<T>, cache::Error>,
    host: &str,
) -> Option<Response> {
    let body = match result {
        Err(cache::Error::GitHub(github::Error::SsoRequired { url })) => {
            let url = url.as_deref().map(Value::from);
            json!({ "denied": "sso", "url": page(url.as_ref(), host) })
        }
        Err(cache::Error::GitHub(github::Error::Forbidden { .. }))
            if matches!(viewer, Viewer::TokenUser { .. }) =>
        {
            json!({ "denied": "token" })
        }
        _ => return None,
    };
    Some(
        (
            StatusCode::FORBIDDEN,
            [(header::CACHE_CONTROL, "no-store")],
            Json(body),
        )
            .into_response(),
    )
}

/// Why the cache had no newer data than `cached`, as a dashboard's header tells it beside
/// its age (FR-DATA-05): `"held"` when the visitor may not fetch from GitHub now, so that the
/// dashboard can ask them to sign in (FR-DATA-10, FR-DATA-11), `"github"` when GitHub
/// failed, or was not reachable, and `None` when the data is fresh, or was just fetched.
pub(crate) fn stale<T>(cached: &Cached<T>) -> Option<&'static str> {
    match cached.stale {
        None => None,
        Some(Stale::Held(_)) => Some("held"),
        Some(Stale::GitHub(_)) => Some("github"),
    }
}

/// The data the cache had, or the status that says why it had none: 202 while GitHub is
/// still computing it, for the dashboard to ask again (FR-REPO-10), and 401 when GitHub
/// rejected the credential of the signed-in user, who has been signed out (FR-AUTH-09).
pub(crate) fn data<T>(result: Result<Outcome<T>, cache::Error>) -> Result<Cached<T>, StatusCode> {
    match result {
        Ok(Outcome::Data(cached)) => Ok(cached),
        Ok(Outcome::Computing) => Err(StatusCode::ACCEPTED),
        Err(cache::Error::GitHub(github::Error::NotFound)) => Err(StatusCode::NOT_FOUND),
        Err(cache::Error::GitHub(github::Error::BadCredentials)) => Err(StatusCode::UNAUTHORIZED),
        Err(cache::Error::GitHub(_)) => Err(StatusCode::BAD_GATEWAY),
        Err(cache::Error::Held(_)) => Err(StatusCode::TOO_MANY_REQUESTS),
        Err(error @ cache::Error::Database(_)) => {
            error!("{error}");
            Err(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

/// What [`issues`] answers for the repository, or the status that says why it cannot.
async fn issues_and_pulls(cache: &Cache, repository: &Under) -> Result<Value, StatusCode> {
    let has_issues = enabled(&repository.data, "has_issues");
    let has_pulls = enabled(&repository.data, "has_pull_requests");
    let updated = repository
        .path(&["issues"])
        .query("state", "all")
        .query("sort", "updated")
        .query("direction", "desc");
    let (open_pulls, closed_issues, merged_pulls, closed_pulls, recent) = tokio::join!(
        count(cache, repository, OPEN_PULLS),
        when(has_issues, count(cache, repository, "is:issue is:closed")),
        when(has_pulls, count(cache, repository, "is:pr is:merged")),
        when(
            has_pulls,
            count(cache, repository, "is:pr is:closed is:unmerged")
        ),
        cache.get_list(&repository.viewer, &repository.dashboard, &updated, RECENT),
    );
    // The open issues are counted from the repository as well as the open pull requests.
    let mut dating = repository.dating();
    let mut counted = |counted: (u64, Dating)| {
        dating = dating.and(counted.1);
        counted.0
    };
    let open_pulls = counted(open_pulls?);
    let closed_issues = closed_issues.transpose()?.map(&mut counted);
    let merged_pulls = merged_pulls.transpose()?.map(&mut counted);
    let closed_pulls = closed_pulls.transpose()?.map(&mut counted);
    let issues = match closed_issues {
        Some(closed) => Some(json!({
            "open": open_issues(&repository.data, open_pulls).ok_or(StatusCode::BAD_GATEWAY)?,
            "closed": closed,
        })),
        None => None,
    };
    let pull_requests = match (merged_pulls, closed_pulls) {
        (Some(merged), Some(closed)) => Some(json!({
            "open": open_pulls,
            "merged": merged,
            "closed": closed,
        })),
        _ => None,
    };
    let recent = data(recent)?;
    let dating = dating.and(Dating::of(&recent));
    let recent: Vec<Value> = recent
        .data
        .items
        .iter()
        .filter_map(|item| listed_item(item, cache.github_host()))
        .collect();
    Ok(dating.apply(json!({
        "issues": issues, "pull_requests": pull_requests, "recent": recent
    })))
}

/// What the Issues or the Pull requests tab lists (FR-REPO-06).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Issue,
    PullRequest,
}

impl Kind {
    /// The qualifier that has GitHub's search find only these.
    fn qualifier(self) -> &'static str {
        match self {
            Kind::Issue => "is:issue",
            Kind::PullRequest => "is:pr",
        }
    }

    /// The feature of a repository that it may turn off on GitHub.
    fn feature(self) -> &'static str {
        match self {
            Kind::Issue => "has_issues",
            Kind::PullRequest => "has_pull_requests",
        }
    }

    /// The `kind` of an item of the kind, as [`listed_item`] tells it.
    fn name(self) -> &'static str {
        match self {
            Kind::Issue => "issue",
            Kind::PullRequest => "pull_request",
        }
    }
}

/// Which issues or pull requests a tab's list shows, by state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Shown {
    Open,
    /// Closed issues, or pull requests closed without being merged.
    Closed,
    /// Merged pull requests. Issues are never merged.
    Merged,
    All,
}

/// The order of a tab's list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Order {
    /// Those updated last first.
    Updated,
    /// Those opened first first.
    Oldest,
}

/// What a tab's list shows (FR-REPO-06): which issues or pull requests, in which order,
/// and which page of them, from 1.
#[derive(Clone, Debug, PartialEq, Eq)]
struct ListView {
    shown: Shown,
    label: Option<String>,
    order: Order,
    page: u64,
}

impl ListView {
    /// The view of the list of `kind` that `query` asks for, each part it leaves out at its
    /// default, the first page of the open ones, updated last first, or `None` if it asks for
    /// one that the list cannot show: a state, order or page it does not know, a state of the
    /// other kind, such as merged issues, a page past the 40 that GitHub's search reaches, or
    /// a label that the search cannot take, as [`is_label`] tells.
    fn of(kind: Kind, query: &HashMap<String, String>) -> Option<ListView> {
        let shown = match (query.get("state").map(String::as_str), kind) {
            (None | Some("open"), _) => Shown::Open,
            (Some("closed"), _) => Shown::Closed,
            (Some("merged"), Kind::PullRequest) => Shown::Merged,
            (Some("all"), _) => Shown::All,
            _ => return None,
        };
        let label = match query.get("label") {
            Some(label) if is_label(label) => Some(label.clone()),
            Some(_) => return None,
            None => None,
        };
        let order = match query.get("sort").map(String::as_str) {
            None | Some("updated") => Order::Updated,
            Some("oldest") => Order::Oldest,
            _ => return None,
        };
        let page = match query.get("page") {
            None => 1,
            Some(page) if page.bytes().all(|byte| byte.is_ascii_digit()) => page
                .parse::<u64>()
                .ok()
                .filter(|page| (1..=SEARCH_REACH / PAGE_SIZE).contains(page))?,
            Some(_) => return None,
        };
        Some(ListView {
            shown,
            label,
            order,
            page,
        })
    }
}

/// Whether `name` can be a label's that GitHub's search for issues can take, quoted: one of
/// up to 50 characters, without quotes or control characters.
fn is_label(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= MAX_LABEL
        && !name.chars().any(|char| char == '"' || char.is_control())
}

/// What [`issue_list`] or [`pull_list`] answers for the repository `owner/repo`, of `kind`,
/// as `query` asks for it.
async fn tab_list(
    cache: &Cache,
    viewer: Viewer,
    owner: &str,
    repo: &str,
    kind: Kind,
    query: &HashMap<String, String>,
) -> Response {
    let Some(view) = ListView::of(kind, query) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let repository = match under(cache, viewer, owner, repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    if !enabled(&repository.data, kind.feature()) {
        let none = Page::default();
        return respond(repository.dated(list_page(kind, &view, &none, true, "")));
    }
    let path = list_search(&repository.name, kind, &view);
    let page = cache
        .get_page_of(
            &repository.viewer,
            &repository.dashboard,
            &path,
            LIST_FIELDS,
        )
        .await;
    match data(page) {
        Ok(page) => respond(dated_by(
            list_page(kind, &view, &page.data, false, cache.github_host()),
            &page,
        )),
        Err(code) => status(code),
    }
}

/// The search for the issues or pull requests of the repository `name`, as `owner/repo`, of
/// `kind`, that a tab's list shows as `view`: the page of 25 that it shows, of all of them
/// that it shows, in its order. Its qualifiers are as [`search_qualifiers`] makes them.
fn list_search(name: &str, kind: Kind, view: &ListView) -> github::Path {
    let (sort, order) = match view.order {
        Order::Updated => ("updated", "desc"),
        Order::Oldest => ("created", "asc"),
    };
    github::Path::new(["search", "issues"])
        .expect("names are neither empty nor dots")
        .query("q", &search_qualifiers(name, kind, view))
        .query("sort", sort)
        .query("order", order)
        .query("per_page", &PAGE_SIZE.to_string())
        .query("page", &view.page.to_string())
}

/// The query of GitHub's search for the issues or pull requests of the repository `name`, of
/// `kind`, that `view` shows, such as `repo:owner/repo is:pr is:closed is:unmerged
/// label:"good first issue"`. The label is quoted, and can hold no quote (see [`is_label`]),
/// so that it is one qualifier whatever it holds.
fn search_qualifiers(name: &str, kind: Kind, view: &ListView) -> String {
    let state = match (view.shown, kind) {
        (Shown::Open, _) => " is:open",
        (Shown::Closed, Kind::Issue) => " is:closed",
        (Shown::Closed, Kind::PullRequest) => " is:closed is:unmerged",
        (Shown::Merged, _) => " is:merged",
        (Shown::All, _) => "",
    };
    let label = view
        .label
        .as_deref()
        .map(|label| format!(" label:\"{label}\""))
        .unwrap_or_default();
    format!("repo:{name} {}{state}{label}", kind.qualifier())
}

/// What [`issue_list`] answers of `page`, the page of what the search for the list of
/// `kind`, as `view` shows it, found, or that the repository has turned the kind `off`. An
/// item of the other kind is left out, as a safeguard.
fn list_page(kind: Kind, view: &ListView, page: &Page, off: bool, host: &str) -> Value {
    let items: Vec<Value> = page
        .items
        .iter()
        .filter_map(|item| listed_item(item, host))
        .filter(|item| item["kind"] == kind.name())
        .collect();
    let pages = page.total.min(SEARCH_REACH).div_ceil(PAGE_SIZE).max(1);
    json!({
        "items": items,
        "total": page.total,
        "page": view.page,
        "pages": pages,
        "per_page": PAGE_SIZE,
        "capped": page.total > SEARCH_REACH,
        "incomplete": page.incomplete,
        "off": off,
    })
}

/// How many of the repository's issues or pull requests the search for `qualifiers` finds,
/// and when the search was fetched, or the status that says why it cannot tell: 502 if
/// GitHub left the count out.
async fn count(
    cache: &Cache,
    repository: &Under,
    qualifiers: &str,
) -> Result<(u64, Dating), StatusCode> {
    let path = search(&repository.name, qualifiers);
    let found = data(
        cache
            .get(&repository.viewer, &repository.dashboard, &path)
            .await,
    )?;
    let total = total(&found.data).ok_or(StatusCode::BAD_GATEWAY)?;
    Ok((total, Dating::of(&found)))
}

/// What `future` comes to, if `enabled`. Otherwise it is never started, so it asks GitHub
/// nothing.
async fn when<T>(enabled: bool, future: impl Future<Output = T>) -> Option<T> {
    if enabled { Some(future.await) } else { None }
}

/// The search for the issues or pull requests of the repository `name`, as `owner/repo`,
/// that `qualifiers` pick, such as `is:pr is:open`, for their count. GitHub's search counts
/// pull requests apart from issues, in one request that returns at most one of them.
fn search(name: &str, qualifiers: &str) -> github::Path {
    github::Path::new(["search", "issues"])
        .expect("names are neither empty nor dots")
        .query("q", &format!("repo:{name} {qualifiers}"))
        .query("per_page", "1")
}

/// The stat cards' figures, from the repository, the search for its open pull requests,
/// and its latest release, if it has one. `None` if GitHub left a count out.
fn figures(repository: &Value, pulls: &Value, latest: Option<&Value>, host: &str) -> Option<Value> {
    let count = |data: &Value, key| data.get(key).and_then(Value::as_u64);
    let open_pulls = total(pulls)?;
    Some(json!({
        "stars": count(repository, "stargazers_count")?,
        "forks": count(repository, "forks_count")?,
        "watchers": count(repository, "subscribers_count")?,
        "open_issues": open_issues(repository, open_pulls)?,
        "open_pull_requests": open_pulls,
        "latest_release": latest.and_then(|latest| release(latest, host)),
    }))
}

/// The repository's open issues, without its `open_pulls`, which GitHub counts as open
/// issues too. `None` if GitHub left its count out.
fn open_issues(repository: &Value, open_pulls: u64) -> Option<u64> {
    let open = repository.get("open_issues_count")?.as_u64()?;
    // The two counts may have been fetched at different times.
    Some(open.saturating_sub(open_pulls))
}

/// The count of what a search found. `None` if GitHub left it out.
fn total(search: &Value) -> Option<u64> {
    search.get("total_count")?.as_u64()
}

/// Whether the repository has `feature`, such as `has_issues`, one that GitHub lets it turn
/// off: unless GitHub says it is off.
fn enabled(repository: &Value, feature: &str) -> bool {
    repository.get(feature) != Some(&Value::Bool(false))
}

/// A release as its stat card shows it, unless it has no tag.
fn release(release: &Value, host: &str) -> Option<Value> {
    let tag = text(release, "tag_name")?;
    Some(json!({
        "tag": tag,
        "published_at": text(release, "published_at").or_else(|| text(release, "created_at")),
        "url": page(release.get("html_url"), host),
    }))
}

/// The weeks of commit activity that GitHub gave, as the chart shows them: the last 52,
/// oldest first. `None` if a week lacks its start or its count. GitHub has no content, or
/// `{}` or `[]`, for an empty repository.
pub(crate) fn weeks(activity: &Value) -> Option<Vec<Value>> {
    let weeks = match activity {
        Value::Array(weeks) => weeks.as_slice(),
        Value::Null => &[],
        Value::Object(object) if object.is_empty() => &[],
        _ => return None,
    };
    let mut weeks = weeks
        .iter()
        .map(|week| {
            let start = DateTimeUtc::from_timestamp(week.get("week")?.as_i64()?, 0)?;
            Some((start, week.get("total")?.as_u64()?))
        })
        .collect::<Option<Vec<_>>>()?;
    weeks.sort_by_key(|(start, _)| *start);
    let old = weeks.len().saturating_sub(WEEKS);
    Some(
        weeks[old..]
            .iter()
            .map(|(start, commits)| {
                json!({ "week": start.date_naive().to_string(), "commits": commits })
            })
            .collect(),
    )
}

/// The languages' bytes as the chart shows them: the 8 with the most, most first and then
/// by name, and the sum of the rest. `None` unless GitHub gave them by name, or nothing,
/// as for an empty repository.
fn shares(languages: &Value) -> Option<Value> {
    let mut languages: Vec<(&str, u64)> = match languages {
        Value::Object(languages) => languages
            .iter()
            .filter(|(name, _)| !name.is_empty())
            .filter_map(|(name, bytes)| Some((name.as_str(), bytes.as_u64()?)))
            .filter(|(_, bytes)| *bytes > 0)
            .collect(),
        Value::Null => Vec::new(),
        _ => return None,
    };
    languages.sort_by(|(name, bytes), (other_name, other_bytes)| {
        other_bytes.cmp(bytes).then(name.cmp(other_name))
    });
    let other = languages
        .iter()
        .skip(LANGUAGES)
        .fold(0u64, |sum, (_, bytes)| sum.saturating_add(*bytes));
    languages.truncate(LANGUAGES);
    let languages: Vec<Value> = languages
        .into_iter()
        .map(|(name, bytes)| json!({ "name": name, "bytes": bytes }))
        .collect();
    Some(json!({ "languages": languages, "other": other }))
}

/// A contributor as the widget shows them, with their count of commits, unless GitHub
/// left out their login or that count.
fn contributor(contributor: &Value, host: &str) -> Option<(u64, Value)> {
    let commits = contributor.get("contributions")?.as_u64()?;
    Some((
        commits,
        json!({
            "login": text(contributor, "login")?,
            "avatar_url": link(contributor.get("avatar_url"), &["https"]),
            "url": page(contributor.get("html_url"), host),
            "commits": commits,
        }),
    ))
}

/// An issue or pull request as the widget and the tabs list it, unless GitHub left out its
/// number or title, or gave it a state that BuhTig does not know.
fn listed_item(item: &Value, host: &str) -> Option<Value> {
    let pull_request = item.get("pull_request").filter(|pull| pull.is_object());
    let state = match (text(item, "state")?, pull_request) {
        ("open", _) => "open",
        ("closed", Some(pull)) if text(pull, "merged_at").is_some() => "merged",
        ("closed", _) => "closed",
        _ => return None,
    };
    Some(json!({
        "number": item.get("number")?.as_u64()?,
        "title": text(item, "title")?,
        "kind": if pull_request.is_some() { "pull_request" } else { "issue" },
        "state": state,
        "author": first_text(item, &["/user/login"]),
        "created_at": text(item, "created_at"),
        "updated_at": text(item, "updated_at"),
        "url": page(item.get("html_url"), host),
    }))
}

/// A commit as the widget lists it, unless GitHub left out its SHA.
fn commit(commit: &Value, host: &str) -> Option<Value> {
    let message = first_text(commit, &["/commit/message"])
        .and_then(|message| message.lines().next())
        .map(str::trim)
        .filter(|line| !line.is_empty());
    Some(json!({
        "sha": text(commit, "sha")?,
        "message": message,
        "author": first_text(commit, &["/author/login", "/commit/author/name"]),
        "author_avatar_url": link(commit.pointer("/author/avatar_url"), &["https"]),
        "committed_at": first_text(commit, &["/commit/committer/date", "/commit/author/date"]),
        "url": page(commit.get("html_url"), host),
    }))
}

/// A release as the releases widget lists it, unless it is a draft or has no tag.
fn listed_release(data: &Value, host: &str) -> Option<Value> {
    if data.get("draft") == Some(&Value::Bool(true)) {
        return None;
    }
    let mut listed = release(data, host)?;
    let tag = text(data, "tag_name")?;
    listed["name"] = text(data, "name").filter(|name| *name != tag).into();
    listed["prerelease"] = (data.get("prerelease") == Some(&Value::Bool(true))).into();
    listed["target"] = text(data, "target_commitish").into();
    Some(listed)
}

/// When a pull request was merged, as GitHub's search tells, if it was.
fn merged_at(pull: &Value) -> Option<&str> {
    text(pull.get("pull_request")?, "merged_at")
}

/// How the pull requests of `pulls`, as GitHub's search finds them, came to an end, as
/// [`merge_velocity`] answers.
fn merges(pulls: &List) -> Value {
    let merged: Vec<&Value> = pulls
        .items
        .iter()
        .filter(|pull| merged_at(pull).is_some())
        .collect();
    let closed = pulls
        .items
        .iter()
        .filter(|pull| merged_at(pull).is_none() && text(pull, "closed_at").is_some())
        .count();
    let times = merged
        .iter()
        .filter_map(|pull| since(pull, "created_at", merged_at(pull)?.parse().ok()?))
        .collect();
    json!({
        "sampled": pulls.items.len(),
        "merged": merged.len(),
        "closed": closed,
        "median_time_to_merge": median(times),
        "truncated": pulls.truncated,
    })
}

/// How long the open issues of `items`, which GitHub lists with its open pull requests,
/// have been open at `now`, as [`issue_age`] answers.
fn ages(items: &List, now: DateTimeUtc) -> Value {
    let issues: Vec<&Value> = items
        .items
        .iter()
        .filter(|item| item.is_object() && !item.get("pull_request").is_some_and(Value::is_object))
        .collect();
    let ages = issues
        .iter()
        .filter_map(|issue| since(issue, "created_at", now))
        .collect();
    json!({
        "sampled": issues.len(),
        "median_age": median(ages),
        "truncated": items.truncated,
    })
}

/// How the workflow runs of `runs` on `branch` fared, latest first as GitHub lists them,
/// as [`workflow_runs`] answers, or that GitHub refused to list them, if `hidden`.
fn health(branch: Option<&str>, runs: &List, hidden: bool, host: &str) -> Value {
    let runs: Vec<&Value> = runs.items.iter().filter(|run| run.is_object()).collect();
    let concluded = |conclusions: &[&str]| {
        runs.iter()
            .filter(|run| text(run, "conclusion").is_some_and(|end| conclusions.contains(&end)))
            .count()
    };
    let durations: Vec<i64> = runs
        .iter()
        .filter(|run| text(run, "status") == Some("completed"))
        .filter_map(|run| since(run, "run_started_at", time(run, "updated_at")?))
        .collect();
    let latest = runs.first().map(|run| {
        json!({
            "name": text(run, "name"),
            "status": text(run, "status"),
            "conclusion": text(run, "conclusion"),
            "started_at": text(run, "run_started_at").or_else(|| text(run, "created_at")),
            "url": page(run.get("html_url"), host),
        })
    });
    json!({
        "branch": branch,
        "sampled": runs.len(),
        "passed": concluded(&["success"]),
        "failed": concluded(FAILED),
        "average_duration": mean(&durations),
        "latest": latest,
        "hidden": hidden,
    })
}

/// The weeks of code frequency that GitHub gave, as the chart shows them: the 52 up to the
/// week of `now`, oldest first, with no changes in those that GitHub left out, and the
/// lines deleted counted up, not down. `None` if a week lacks its start or its counts.
/// GitHub has no content, or `{}` or `[]`, for an empty repository, which has no weeks.
fn changes(frequency: &Value, now: DateTimeUtc) -> Option<Vec<Value>> {
    let weeks = match frequency {
        Value::Array(weeks) => weeks.as_slice(),
        Value::Null => &[],
        Value::Object(object) if object.is_empty() => &[],
        _ => return None,
    };
    if weeks.is_empty() {
        return Some(Vec::new());
    }
    let given = weeks
        .iter()
        .map(|week| {
            let [start, additions, deletions] = week.as_array()?.as_slice() else {
                return None;
            };
            let start = DateTimeUtc::from_timestamp(start.as_i64()?, 0)?.date_naive();
            let lines = |count: &Value| count.as_i64().map(i64::unsigned_abs);
            Some((start, (lines(additions)?, lines(deletions)?)))
        })
        .collect::<Option<HashMap<_, _>>>()?;
    let today = now.date_naive();
    let current = today - TimeDelta::days(i64::from(today.weekday().num_days_from_sunday()));
    let first = current - TimeDelta::weeks(i64::try_from(WEEKS - 1).ok()?);
    let starts = std::iter::successors(Some(first), |week| Some(*week + TimeDelta::weeks(1)));
    Some(
        starts
            .take(WEEKS)
            .map(|start| {
                let (additions, deletions) = given.get(&start).copied().unwrap_or_default();
                json!({
                    "week": start.to_string(),
                    "additions": additions,
                    "deletions": deletions,
                })
            })
            .collect(),
    )
}

/// How often the releases of `list` came, and how many times their assets were
/// downloaded, as [`release_cadence`] answers.
fn cadence(list: &List) -> Value {
    let releases: Vec<&Value> = list
        .items
        .iter()
        .filter(|release| {
            release.get("draft") != Some(&Value::Bool(true)) && text(release, "tag_name").is_some()
        })
        .collect();
    let prereleases = releases
        .iter()
        .filter(|release| release.get("prerelease") == Some(&Value::Bool(true)))
        .count();
    let dates: Vec<DateTimeUtc> = releases
        .iter()
        .filter_map(|release| time(release, "published_at").or_else(|| time(release, "created_at")))
        .collect();
    let average_interval = match (dates.iter().min(), dates.iter().max()) {
        (Some(first), Some(last)) if dates.len() > 1 => i64::try_from(dates.len() - 1)
            .ok()
            .map(|gaps| (*last - *first).num_seconds() / gaps),
        _ => None,
    };
    let assets: Vec<&Value> = releases
        .iter()
        .filter_map(|release| release.get("assets")?.as_array())
        .flatten()
        .collect();
    let downloads = assets
        .iter()
        .filter_map(|asset| asset.get("download_count")?.as_u64())
        .fold(0u64, u64::saturating_add);
    json!({
        "sampled": releases.len(),
        "stable": releases.len() - prereleases,
        "prereleases": prereleases,
        "average_interval": average_interval,
        "assets": assets.len(),
        "downloads": downloads,
        "truncated": list.truncated,
    })
}

/// The median of `values`, halfway between the two in the middle, rounded down, if there
/// is an even number of them. `None` if there are none.
fn median(mut values: Vec<i64>) -> Option<i64> {
    values.sort_unstable();
    let middle = values.len() / 2;
    if values.len() % 2 == 1 {
        return values.get(middle).copied();
    }
    let (low, high) = (*values.get(middle.checked_sub(1)?)?, *values.get(middle)?);
    Some(low + (high - low) / 2)
}

/// The mean of `values`, rounded down. `None` if there are none.
fn mean(values: &[i64]) -> Option<i64> {
    let count = i64::try_from(values.len())
        .ok()
        .filter(|count| *count > 0)?;
    Some(
        values
            .iter()
            .fold(0i64, |sum, value| sum.saturating_add(*value))
            / count,
    )
}

/// The seconds from the time of `data`'s member `key` to `until`, unless it tells no time,
/// or one after `until`.
fn since(data: &Value, key: &str, until: DateTimeUtc) -> Option<i64> {
    let seconds = (until - time(data, key)?).num_seconds();
    (seconds >= 0).then_some(seconds)
}

/// The time of `data`'s member `key`, if it tells one.
fn time(data: &Value, key: &str) -> Option<DateTimeUtc> {
    text(data, key)?.parse().ok()
}

/// `value` as a URL to link to, if it is one of a page on GitHub, on `github.host` (FR-REPO-12).
pub(crate) fn page(value: Option<&Value>, host: &str) -> Option<String> {
    link(value, &["https"])
        .filter(|url| Url::parse(url).is_ok_and(|url| url.host_str() == Some(host)))
}

/// `owner/repo` as its two names, if it is a repository's.
pub(crate) fn names(full_name: &str) -> Option<(&str, &str)> {
    full_name
        .split_once('/')
        .filter(|(owner, repo)| is_account_name(owner) && is_repository_name(repo))
}

/// The text of `data`'s member `key`, unless it is empty.
pub(crate) fn text<'a>(data: &'a Value, key: &str) -> Option<&'a str> {
    data.get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

/// The text at the first of `pointers`, such as `/author/login`, that has some in `data`.
fn first_text<'a>(data: &'a Value, pointers: &[&str]) -> Option<&'a str> {
    pointers.iter().find_map(|pointer| {
        data.pointer(pointer)
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
    })
}

/// The repository's topics, as GitHub gives them, but for any that are not text.
pub(crate) fn topics(data: &Value) -> Vec<&str> {
    data.get("topics")
        .and_then(Value::as_array)
        .map(|topics| topics.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

/// GitHub's visibility of the repository, from `private` if it gives no other.
pub(crate) fn visibility(data: &Value) -> &'static str {
    let visibility = data.get("visibility").and_then(Value::as_str);
    match visibility.map(str::to_ascii_lowercase).as_deref() {
        Some("public") => "public",
        Some("private") => "private",
        Some("internal") => "internal",
        _ if data.get("private") == Some(&Value::Bool(true)) => "private",
        _ => "public",
    }
}

/// `value` as a URL to link to, if it is an absolute one with one of `schemes`
/// (NFR-SEC-03).
pub(crate) fn link(value: Option<&Value>, schemes: &[&str]) -> Option<String> {
    let url = Url::parse(value?.as_str()?.trim()).ok()?;
    schemes.contains(&url.scheme()).then(|| url.into())
}

pub(crate) fn respond(body: Value) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

pub(crate) fn status(status: StatusCode) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use axum::http::HeaderMap;
    use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
    use sea_orm::sea_query::prelude::chrono::{SubsecRound, TimeDelta};
    use url::form_urlencoded;

    use super::*;
    use crate::config::{CacheConfig, DatabaseConfig, LimitsConfig, Secret};
    use crate::db;
    use crate::github::stub::{Stub, answer, client};
    use crate::test_cluster::cluster;
    use crate::visitors::Visitor;

    /// `Acme/Widget` as GitHub gives it, with all that its dashboard shows.
    const WIDGET: &str = r#"{
        "id": 42,
        "full_name": "Acme/Widget",
        "private": false,
        "visibility": "public",
        "owner": {"login": "Acme", "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4"},
        "description": "Widgets for everyone",
        "archived": true,
        "is_template": true,
        "fork": true,
        "parent": {"full_name": "Upstream/Widget", "private": false},
        "topics": ["widgets", "rust"],
        "license": {"key": "mit", "name": "MIT License", "spdx_id": "MIT"},
        "default_branch": "main",
        "homepage": "https://widget.example/docs",
        "created_at": "2015-03-01T10:00:00Z",
        "pushed_at": "2026-10-20T08:30:00Z",
        "stargazers_count": 12345,
        "watchers_count": 12345,
        "subscribers_count": 321,
        "forks_count": 678,
        "open_issues_count": 45
    }"#;

    /// A repository with as little as GitHub gives: no description, topics, license,
    /// homepage, pushes or releases.
    const BARE: &str = r#"{
        "full_name": "acme/bare",
        "private": false,
        "visibility": "public",
        "owner": {"login": "acme"},
        "description": null,
        "archived": false,
        "is_template": false,
        "fork": false,
        "topics": [],
        "license": null,
        "default_branch": "main",
        "homepage": null,
        "created_at": "2026-10-20T08:00:00Z",
        "pushed_at": null,
        "stargazers_count": 0,
        "watchers_count": 0,
        "subscribers_count": 0,
        "forks_count": 0,
        "open_issues_count": 0
    }"#;

    /// A repository that says odd things, which the header must not show as they are.
    const ODD: &str = r#"{
        "full_name": "acme/odd",
        "private": false,
        "visibility": "secret",
        "owner": {"login": "acme", "avatar_url": "http://avatars.example/u/2"},
        "description": "",
        "fork": true,
        "parent": {"full_name": "../evil"},
        "topics": ["ok", 7, null],
        "license": {"key": "other"},
        "homepage": "javascript:alert(1)"
    }"#;

    /// The languages of `Acme/Widget`: ten, two of them as large, and two that GitHub
    /// would not give.
    const LANGUAGES: &str = r#"{
        "Rust": 50000, "TypeScript": 30000, "HTML": 5000, "CSS": 5000, "Shell": 1000,
        "Dockerfile": 500, "Makefile": 300, "JavaScript": 200, "Python": 100, "Nix": 50,
        "Empty": 0, "Odd": "many"
    }"#;

    /// The top contributors of `Acme/Widget`, a bot among them, with some that the widget
    /// must not show as they are.
    const CONTRIBUTORS: &str = r#"[
        {"login": "alice", "avatar_url": "https://avatars.githubusercontent.com/u/2?v=4",
         "html_url": "https://github.com/alice", "contributions": 120, "type": "User"},
        {"login": "dependabot[bot]",
         "avatar_url": "https://avatars.githubusercontent.com/in/29110?v=4",
         "html_url": "https://github.com/apps/dependabot", "contributions": 40, "type": "Bot"},
        {"login": "mallory", "avatar_url": "http://avatars.example/u/3",
         "html_url": "javascript:alert(1)", "contributions": 7},
        {"login": "bob", "html_url": "https://evil.example/bob", "contributions": 300},
        {"login": "", "contributions": 5},
        {"login": "uncounted"}
    ]"#;

    /// The issues and pull requests of `Acme/Widget` updated last, with some that the widget
    /// must not show as they are.
    const ISSUES: &str = r#"[
        {"number": 50, "title": "Widgets wobble", "state": "open",
         "user": {"login": "alice"}, "created_at": "2026-10-20T08:00:00Z",
         "updated_at": "2026-10-22T09:00:00Z",
         "html_url": "https://github.com/Acme/Widget/issues/50"},
        {"number": 49, "title": "Steady the widgets", "state": "closed", "draft": false,
         "user": {"login": "bob"}, "created_at": "2026-10-19T08:00:00Z",
         "updated_at": "2026-10-21T08:00:00Z",
         "html_url": "https://github.com/Acme/Widget/pull/49",
         "pull_request": {"merged_at": "2026-10-21T08:00:00Z"}},
        {"number": 48, "title": "Paint the widgets", "state": "closed",
         "user": {"login": "carol"}, "created_at": "2026-10-18T08:00:00Z",
         "updated_at": "2026-10-20T08:00:00Z",
         "html_url": "https://github.com/Acme/Widget/pull/48",
         "pull_request": {"merged_at": null}},
        {"number": 47, "title": "Widgets are too blue", "state": "closed", "user": null,
         "updated_at": "", "html_url": "javascript:alert(1)"},
        {"number": 46, "title": "Square widgets", "state": "open", "draft": true,
         "user": {"login": "dave"}, "html_url": "https://evil.example/46",
         "pull_request": {"merged_at": null}},
        {"number": 45, "title": "Locked widgets", "state": "locked"},
        {"title": "Numberless", "state": "open"},
        {"number": 44, "title": "", "state": "open"}
    ]"#;

    /// The latest commits on `Acme/Widget`'s default branch, with some that the widget must
    /// not show as they are.
    const COMMITS: &str = r#"[
        {"sha": "a1b2c3d", "html_url": "https://github.com/Acme/Widget/commit/a1b2c3d",
         "author": {"login": "alice",
                    "avatar_url": "https://avatars.githubusercontent.com/u/2?v=4"},
         "commit": {"message": "Steady the widgets (#49)\n\nThey wobbled.",
                    "author": {"name": "Alice Example", "date": "2026-10-19T08:00:00Z"},
                    "committer": {"name": "GitHub", "date": "2026-10-21T08:00:00Z"}}},
        {"sha": "b2c3d4e", "html_url": "javascript:alert(1)", "author": null,
         "commit": {"message": "  Fix a typo  \r\nin the widgets",
                    "author": {"name": "Bob Example", "date": "2026-10-18T08:00:00Z"}}},
        {"sha": "c3d4e5f", "html_url": "https://evil.example/c3d4e5f",
         "author": {"login": "", "avatar_url": "http://avatars.example/u/3"},
         "commit": {"message": "", "author": {"name": ""}}},
        {"html_url": "https://github.com/Acme/Widget/commit/0", "commit": {"message": "Shaless"}}
    ]"#;

    /// The latest releases of `Acme/Widget`, a draft among them, with some that the widget
    /// must not show as they are.
    const RELEASES: &str = r#"[
        {"tag_name": "v3.0.0", "name": "Widget 3", "draft": true, "prerelease": false,
         "assets": [{"name": "widget.zip", "download_count": 1000}]},
        {"tag_name": "v3.0.0-rc.1", "name": "v3.0.0-rc.1", "draft": false, "prerelease": true,
         "target_commitish": "next",
         "created_at": "2026-10-10T12:00:00Z", "published_at": "2026-10-11T12:00:00Z",
         "html_url": "https://github.com/Acme/Widget/releases/tag/v3.0.0-rc.1",
         "assets": [{"name": "widget.zip", "download_count": 5,
                     "uploader": {"login": "alice"}},
                    {"name": "widget.tar.gz", "download_count": 7}]},
        {"tag_name": "v2.1.0", "name": "Widget 2.1", "draft": false, "prerelease": false,
         "target_commitish": "main",
         "created_at": "2026-09-30T12:00:00Z", "published_at": "2026-10-01T12:00:00Z",
         "html_url": "https://github.com/Acme/Widget/releases/tag/v2.1.0",
         "assets": [{"name": "widget.zip", "download_count": 100}, {"name": "uncounted"}]},
        {"tag_name": "v2.0.0", "name": "", "target_commitish": "", "created_at": "2026-06-01T12:00:00Z",
         "published_at": null, "html_url": "https://evil.example/v2.0.0"},
        {"tag_name": "", "name": "Tagless"}
    ]"#;

    /// The pull requests of `Acme/Widget` updated last, as GitHub's search finds them: two
    /// merged in a day or more, one in an hour, one merged without a time of opening, one
    /// closed without being merged, and one open.
    const PULLS: &str = r#"{"total_count": 6, "incomplete_results": false, "items": [
        {"number": 49, "created_at": "2026-10-19T08:00:00Z", "closed_at": "2026-10-21T08:00:00Z",
         "title": "Steady the widgets", "user": {"login": "bob"},
         "pull_request": {"html_url": "https://github.com/Acme/Widget/pull/49",
                          "merged_at": "2026-10-21T08:00:00Z"}},
        {"number": 48, "created_at": "2026-10-18T08:00:00Z", "closed_at": "2026-10-20T08:00:00Z",
         "pull_request": {"merged_at": null}},
        {"number": 46, "created_at": "2026-10-17T08:00:00Z", "closed_at": null,
         "pull_request": {"merged_at": null}},
        {"number": 43, "created_at": "2026-10-10T08:00:00Z", "closed_at": "2026-10-10T09:00:00Z",
         "pull_request": {"merged_at": "2026-10-10T09:00:00Z"}},
        {"number": 42, "created_at": "2026-10-01T08:00:00Z", "closed_at": "2026-10-05T08:00:00Z",
         "pull_request": {"merged_at": "2026-10-05T08:00:00Z"}},
        {"number": 41, "created_at": "", "closed_at": "2026-10-01T00:00:00Z",
         "pull_request": {"merged_at": "2026-10-01T00:00:00Z"}}
    ]}"#;

    /// The open issues and pull requests of `Acme/Widget` updated last: three issues, one
    /// of them without a time of opening, and two pull requests.
    const OPEN_ISSUES: &str = r#"[
        {"number": 50, "created_at": "2026-01-01T00:00:00Z", "title": "Widgets wobble"},
        {"number": 46, "created_at": "2020-01-01T00:00:00Z",
         "pull_request": {"merged_at": null}},
        {"number": 30, "created_at": "2025-01-01T00:00:00Z"},
        {"number": 20, "created_at": "2024-01-01T00:00:00Z"},
        {"number": 10, "created_at": null},
        {"number": 9, "created_at": "2019-01-01T00:00:00Z",
         "pull_request": {"merged_at": null}}
    ]"#;

    /// The latest workflow runs for pushes to `Acme/Widget`'s default branch, latest first:
    /// one in progress, two that passed, two that failed, one of them with times out of
    /// order, and one cancelled.
    const RUNS: &str = r#"{"total_count": 6, "workflow_runs": [
        {"id": 7, "name": "CI", "event": "push", "status": "in_progress", "conclusion": null,
         "run_started_at": "2026-10-22T10:00:00Z", "created_at": "2026-10-22T10:00:00Z",
         "updated_at": "2026-10-22T10:01:00Z",
         "html_url": "https://github.com/Acme/Widget/actions/runs/7",
         "head_commit": {"message": "Steady the widgets"},
         "repository": {"full_name": "Acme/Widget", "private": false}},
        {"id": 5, "name": "CI", "event": "push", "status": "completed", "conclusion": "success",
         "run_started_at": "2026-10-21T10:00:00Z", "updated_at": "2026-10-21T10:04:00Z"},
        {"id": 4, "name": "Release", "event": "push", "status": "completed",
         "conclusion": "failure", "run_started_at": "2026-10-20T10:00:00Z",
         "updated_at": "2026-10-20T10:10:00Z"},
        {"id": 3, "name": "CI", "event": "push", "status": "completed", "conclusion": "cancelled",
         "run_started_at": "2026-10-19T10:00:00Z", "updated_at": "2026-10-19T10:02:00Z"},
        {"id": 2, "name": "CI", "event": "push", "status": "completed", "conclusion": "timed_out",
         "run_started_at": "2026-10-18T10:00:00Z", "updated_at": "2026-10-18T09:00:00Z"},
        {"id": 1, "name": "CI", "event": "push", "status": "completed",
         "conclusion": "success", "run_started_at": "2026-10-17T10:00:00Z",
         "updated_at": "2026-10-17T10:05:00Z"}
    ]}"#;

    /// The Sunday that the week of `now` starts on, at midnight UTC, as GitHub counts weeks.
    fn week_of(now: DateTimeUtc) -> DateTimeUtc {
        let today = now.date_naive();
        let sunday = today - TimeDelta::days(i64::from(today.weekday().num_days_from_sunday()));
        sunday.and_hms_opt(0, 0, 0).unwrap().and_utc()
    }

    /// GitHub's code frequency for `Acme/Widget`: from 60 weeks before the current week to
    /// the week before it, `10 × n` lines added and `n` deleted in the week `n` weeks ago,
    /// but for 3 weeks ago, which GitHub left out.
    fn frequency() -> String {
        let current = week_of(ChronoUtc::now());
        let weeks: Vec<Value> = (1..=60)
            .rev()
            .filter(|ago| *ago != 3)
            .map(|ago| {
                let start = (current - TimeDelta::weeks(ago)).timestamp();
                json!([start, 10 * ago, -ago])
            })
            .collect();
        Value::from(weeks).to_string()
    }

    /// GitHub's last 52 weeks of commit activity for `Acme/Widget`, from the week that
    /// starts on Sunday 2025-10-26, with as many commits in each week as weeks before it.
    fn activity() -> String {
        let weeks: Vec<Value> = (0..52)
            .map(|week| {
                json!({"week": 1_761_436_800 + week * 7 * 24 * 60 * 60, "total": week,
                       "days": [week, 0, 0, 0, 0, 0, 0]})
            })
            .collect();
        Value::from(weeks).to_string()
    }

    /// A stub GitHub with the repositories `Acme/Widget`, `acme/bare` and `acme/odd`, two
    /// with issues or pull requests turned off, one that was renamed to `Acme/Widget`, and a
    /// few odd answers. Like GitHub, it ignores the case of names in paths.
    /// A page of what GitHub's search finds of `Acme/Widget`'s issues or pull requests, as
    /// `query` asks for it, as the Issues and Pull requests tabs list them, or `None` for a
    /// search it does not know. The repository has many more pull requests than issues, all
    /// of them updated after its issues: 30 open issues and 4 closed, 3 of the open ones
    /// labeled `bug` and 2 `slow`, which GitHub's search runs out of time finding, and 1,234
    /// open pull requests, 300 merged and 40 closed without being merged. Each is numbered by
    /// when it was opened, and listed in the order asked for.
    fn searched(query: &HashMap<String, String>) -> Option<Value> {
        let q = query.get("q")?.strip_prefix("repo:Acme/Widget ")?;
        let per_page: u64 = query.get("per_page")?.parse().ok()?;
        let page: u64 = query.get("page")?.parse().ok()?;
        let oldest = match (query.get("sort")?.as_str(), query.get("order")?.as_str()) {
            ("updated", "desc") => false,
            ("created", "asc") => true,
            _ => return None,
        };
        let (pulls, states, label) = match q.split_once(" label:") {
            Some((kind, label)) => (kind.starts_with("is:pr"), kind, Some(label)),
            None => (q.starts_with("is:pr"), q, None),
        };
        // The states of those found, how many of each, and the numbers they start from.
        let found: &[(&str, u64, u64)] = match (states, label) {
            ("is:issue is:open", None) => &[("open", 30, 1)],
            ("is:issue is:open", Some(r#""bug""#)) => &[("open", 3, 1)],
            ("is:issue is:open", Some(r#""slow""#)) => &[("open", 2, 1)],
            ("is:issue is:closed", None) => &[("closed", 4, 31)],
            ("is:issue", None) => &[("open", 30, 1), ("closed", 4, 31)],
            ("is:pr is:open", None) => &[("open", 1234, 1000)],
            ("is:pr is:merged", None) => &[("merged", 300, 3000)],
            ("is:pr is:closed is:unmerged", None) => &[("closed", 40, 4000)],
            ("is:pr", None) => &[
                ("open", 1234, 1000),
                ("merged", 300, 3000),
                ("closed", 40, 4000),
            ],
            (_, Some(_)) => &[],
            _ => return None,
        };
        let mut all: Vec<(&str, u64)> = found
            .iter()
            .flat_map(|(state, count, first)| (*first..first + count).map(|n| (*state, n)))
            .collect();
        // Opened first first, or else updated last first, which is opened last first here.
        all.sort_by_key(|(_, number)| *number);
        if !oldest {
            all.reverse();
        }
        let start = usize::try_from((page - 1) * per_page).ok()?;
        let items: Vec<Value> = all
            .iter()
            .skip(start)
            .take(usize::try_from(per_page).ok()?)
            .map(|(state, number)| {
                let mut item = json!({
                    "number": number,
                    "title": format!("Widgets {number}"),
                    "state": if *state == "open" { "open" } else { "closed" },
                    "user": {"login": "alice", "id": 2},
                    "body": "What it says",
                    "created_at": "2026-10-01T08:00:00Z",
                    "updated_at": "2026-10-22T08:00:00Z",
                    "html_url": format!(
                        "https://github.com/Acme/Widget/{}/{number}",
                        if pulls { "pull" } else { "issues" }
                    ),
                });
                if pulls {
                    let merged = (*state == "merged").then_some("2026-10-21T08:00:00Z");
                    item["pull_request"] = json!({"merged_at": merged, "url": "…"});
                }
                item
            })
            .collect();
        Some(json!({
            "total_count": all.len(),
            "incomplete_results": label == Some(r#""slow""#),
            "items": items,
        }))
    }

    fn github() -> Arc<Stub> {
        Stub::new(|request| {
            let query: HashMap<String, String> =
                form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
                    .into_owned()
                    .collect();
            // A search's answer, with as many found.
            let found = |count: u64| {
                let body = json!({"total_count": count, "incomplete_results": false, "items": []});
                answer(200, &[], &body.to_string())
            };
            match request.uri().path().to_ascii_lowercase().as_str() {
                "/repos/acme/widget" | "/repositories/42" => answer(200, &[], WIDGET),
                "/repos/acme/bare" => answer(200, &[], BARE),
                "/repos/acme/odd" => answer(200, &[], ODD),
                "/repos/acme/gadget" => answer(
                    301,
                    &[("location", "https://api.github.com/repositories/42")],
                    r#"{"message": "Moved Permanently"}"#,
                ),
                // Its counts were read at different times.
                "/repos/acme/racy" => answer(
                    200,
                    &[],
                    r#"{"full_name": "acme/racy", "private": false, "stargazers_count": 1,
                        "subscribers_count": 1, "forks_count": 1, "open_issues_count": 2}"#,
                ),
                "/repos/acme/unsearchable" => answer(
                    200,
                    &[],
                    r#"{"full_name": "acme/unsearchable", "private": false, "stargazers_count": 1,
                        "subscribers_count": 1, "forks_count": 1, "open_issues_count": 1}"#,
                ),
                // GitHub is still computing its statistics.
                "/repos/acme/busy" => answer(200, &[], r#"{"full_name": "acme/busy"}"#),
                "/repos/acme/busy/stats/commit_activity"
                | "/repos/acme/busy/stats/code_frequency" => answer(202, &[], "{}"),
                // GitHub does not list its contributors, nor compute its code frequency.
                "/repos/acme/huge" => answer(200, &[], r#"{"full_name": "acme/huge"}"#),
                "/repos/acme/huge/stats/code_frequency" => answer(
                    422,
                    &[],
                    r#"{"message": "The code frequency is not available for repositories with 10,000 or more commits.", "status": "422"}"#,
                ),
                // GitHub does not list its workflow runs to the credential.
                "/repos/acme/guarded" => answer(
                    200,
                    &[],
                    r#"{"full_name": "acme/guarded", "private": false,
                        "default_branch": "release/1.x"}"#,
                ),
                "/repos/acme/guarded/actions/runs" => answer(
                    403,
                    &[],
                    r#"{"message": "Resource not accessible by personal access token", "status": "403"}"#,
                ),
                "/repos/acme/huge/contributors" => answer(
                    403,
                    &[],
                    r#"{"message": "The history or contributor list is too large to list contributors for this repository via the API.", "status": "403"}"#,
                ),
                // Issues are turned off, and on the other also pull requests.
                "/repos/acme/mirror" => answer(
                    200,
                    &[],
                    r#"{"full_name": "acme/mirror", "private": false, "open_issues_count": 2,
                        "has_issues": false, "has_pull_requests": true}"#,
                ),
                "/repos/acme/locked" => answer(
                    200,
                    &[],
                    r#"{"full_name": "acme/locked", "private": false, "open_issues_count": 0,
                        "has_issues": false, "has_pull_requests": false}"#,
                ),
                "/repos/acme/widget/stats/commit_activity" => answer(200, &[], &activity()),
                "/repos/acme/widget/languages" => answer(200, &[], LANGUAGES),
                "/repos/acme/widget/contributors" => answer(200, &[], CONTRIBUTORS),
                "/repos/acme/widget/issues"
                    if query.get("state").map(String::as_str) == Some("open") =>
                {
                    answer(200, &[], OPEN_ISSUES)
                }
                "/repos/acme/widget/issues" => answer(200, &[], ISSUES),
                "/repos/acme/widget/actions/runs" => answer(200, &[], RUNS),
                "/repos/acme/widget/stats/code_frequency" => answer(200, &[], &frequency()),
                "/repos/acme/widget/commits" => answer(200, &[], COMMITS),
                "/repos/acme/widget/releases" => answer(200, &[], RELEASES),
                "/repos/acme/mirror/issues" => answer(
                    200,
                    &[],
                    r#"[{"number": 3, "title": "Mirror the widgets", "state": "open",
                         "user": {"login": "erin"}, "created_at": "2026-10-22T08:00:00Z",
                         "html_url": "https://github.com/acme/mirror/pull/3",
                         "pull_request": {"merged_at": null}}]"#,
                ),
                // As for an empty repository.
                "/repos/acme/bare/stats/commit_activity"
                | "/repos/acme/bare/stats/code_frequency"
                | "/repos/acme/bare/contributors" => answer(204, &[], ""),
                "/repos/acme/bare/actions/runs" => {
                    answer(200, &[], r#"{"total_count": 0, "workflow_runs": []}"#)
                }
                "/repos/acme/bare/languages" => answer(200, &[], "{}"),
                "/repos/acme/bare/commits" => answer(
                    409,
                    &[],
                    r#"{"message": "Git Repository is empty.", "status": "409"}"#,
                ),
                "/repos/acme/bare/issues"
                | "/repos/acme/bare/releases"
                | "/repos/acme/locked/issues" => answer(200, &[], "[]"),
                "/repos/acme/odd/stats/commit_activity" => answer(
                    200,
                    &[],
                    r#"[{"week": 1761436800, "days": [1, 0, 0, 0, 0, 0, 0]}]"#,
                ),
                "/repos/acme/odd/languages" => answer(200, &[], r#"["Rust"]"#),
                "/repos/acme/odd/stats/code_frequency" => {
                    answer(200, &[], r#"[[1761436800, 3], [1762041600, "many", -1]]"#)
                }
                "/repos/acme/odd/contributors"
                | "/repos/acme/odd/issues"
                | "/repos/acme/odd/commits"
                | "/repos/acme/odd/releases" => answer(200, &[], r#"{"login": "alice"}"#),
                // More contributors and releases than one page shows: GitHub counts them
                // by the number of the last page of one each.
                "/repos/acme/crowded" | "/repos/acme/uncountable" => {
                    let name = request.uri().path().trim_start_matches("/repos/");
                    answer(
                        200,
                        &[],
                        &json!({"full_name": name, "private": false}).to_string(),
                    )
                }
                "/repos/acme/crowded/contributors" | "/repos/acme/crowded/releases"
                    if query.get("per_page").map(String::as_str) == Some("1") =>
                {
                    let path = request.uri().path();
                    let last = if path.ends_with("/releases") {
                        37
                    } else {
                        1234
                    };
                    let link = format!(
                        r#"<https://api.github.com{path}?per_page=1&page=2>; rel="next", <https://api.github.com{path}?per_page=1&page={last}>; rel="last""#
                    );
                    answer(
                        200,
                        &[("link", &link)],
                        r#"[{"login": "first", "tag_name": "v1"}]"#,
                    )
                }
                "/repos/acme/uncountable/contributors"
                    if query.get("per_page").map(String::as_str) == Some("1") =>
                {
                    answer(
                        403,
                        &[],
                        r#"{"message": "The history or contributor list is too large to list contributors for this repository via the API."}"#,
                    )
                }
                "/repos/acme/crowded/contributors"
                | "/repos/acme/crowded/releases"
                | "/repos/acme/uncountable/contributors" => {
                    let path = request.uri().path();
                    let per_page: usize = query["per_page"].parse().unwrap();
                    let items: Vec<Value> = (0..per_page)
                        .map(|n| {
                            json!({"login": format!("c{n}"), "contributions": 100 - n,
                                        "tag_name": format!("v{n}")})
                        })
                        .collect();
                    let next = format!(
                        r#"<https://api.github.com{path}?per_page={per_page}&page=2>; rel="next""#
                    );
                    answer(200, &[("link", &next)], &Value::from(items).to_string())
                }
                "/repos/acme/nameless" => answer(200, &[], r#"{"private": false}"#),
                "/repos/acme/broken" => answer(500, &[], r#"{"message": "Server Error"}"#),
                "/repos/acme/widget/releases/latest" => answer(
                    200,
                    &[],
                    r#"{"tag_name": "v2.1.0", "name": "Widget 2.1",
                        "html_url": "https://github.com/Acme/Widget/releases/tag/v2.1.0",
                        "created_at": "2026-09-30T12:00:00Z",
                        "published_at": "2026-10-01T12:00:00Z",
                        "draft": false, "prerelease": false}"#,
                ),
                // What the Issues and Pull requests tabs list, a page at a time.
                "/search/issues" if query.contains_key("page") => match searched(&query) {
                    Some(page) => answer(200, &[], &page.to_string()),
                    None => answer(500, &[], r#"{"message": "Server Error"}"#),
                },
                "/repos/acme/widget/labels" => answer(
                    200,
                    &[],
                    r#"[{"name": "bug", "color": "d73a4a"}, {"name": "Docs"},
                        {"name": "good first issue"}, {"name": "say \"hi\""}, {"name": ""},
                        {"name": "area/api"}, {"color": "ffffff"}]"#,
                ),
                "/search/issues" => match query.get("q").map(String::as_str) {
                    Some("repo:Acme/Widget is:pr is:open") => answer(
                        200,
                        &[],
                        r#"{"total_count": 12, "incomplete_results": false,
                            "items": [{"number": 7, "pull_request": {}}]}"#,
                    ),
                    Some("repo:Acme/Widget is:issue is:closed") => found(120),
                    Some("repo:Acme/Widget is:pr is:merged") => found(300),
                    Some("repo:Acme/Widget is:pr is:closed is:unmerged") => found(40),
                    Some("repo:Acme/Widget is:pr") => answer(200, &[], PULLS),
                    Some("repo:acme/mirror is:pr is:open") => found(2),
                    Some("repo:acme/mirror is:pr is:merged") => found(5),
                    Some("repo:acme/mirror is:pr is:closed is:unmerged") => found(1),
                    Some(q)
                        if q.starts_with("repo:acme/bare ")
                            || q.starts_with("repo:acme/locked ") =>
                    {
                        found(0)
                    }
                    Some("repo:acme/racy is:pr is:open") => answer(
                        200,
                        &[],
                        r#"{"total_count": 3, "incomplete_results": false, "items": [{}]}"#,
                    ),
                    _ => answer(500, &[], r#"{"message": "Server Error"}"#),
                },
                _ => answer(404, &[], r#"{"message": "Not Found"}"#),
            }
        })
    }

    /// A cache on a database of its own, in front of `stub`, that lets each visitor make
    /// `visitor_fetches` dashboard loads an hour.
    async fn cache(stub: &Arc<Stub>, visitor_fetches: u32) -> Arc<Cache> {
        cache_for(stub, visitor_fetches, Duration::from_secs(15 * 60)).await
    }

    /// As [`cache`], keeping data fresh for `ttl`.
    async fn cache_for(stub: &Arc<Stub>, visitor_fetches: u32, ttl: Duration) -> Arc<Cache> {
        let cluster = cluster();
        let database = cluster.create_database();
        let db = db::connect(&DatabaseConfig {
            url: Secret::new(Url::parse(&cluster.url(&database)).unwrap()),
            max_connections: 5,
        })
        .await
        .unwrap();
        db::migrate(&db, crate::config::GITHUB_COM).await.unwrap();
        Arc::new(Cache::new(
            db,
            Arc::new(client(stub)),
            &CacheConfig {
                ttl,
                retention: Duration::from_secs(30 * 24 * 60 * 60),
            },
            &LimitsConfig {
                org_repositories: 1000,
                visitor_fetches_per_hour: visitor_fetches,
            },
        ))
    }

    /// What a dashboard asks about its repository.
    #[derive(Clone, Copy, Debug)]
    enum Api {
        Summary,
        Stats,
        CommitActivity,
        Languages,
        Contributors,
        Issues,
        Commits,
        Releases,
        MergeVelocity,
        IssueAge,
        WorkflowRuns,
        CodeFrequency,
        ReleaseCadence,
        Trends,
        /// At their defaults: the first page of the open ones, updated last first.
        IssueList,
        PullList,
        Labels,
    }

    impl Api {
        const ALL: [Api; 17] = [
            Api::Summary,
            Api::Stats,
            Api::CommitActivity,
            Api::Languages,
            Api::Contributors,
            Api::Issues,
            Api::Commits,
            Api::Releases,
            Api::MergeVelocity,
            Api::IssueAge,
            Api::WorkflowRuns,
            Api::CodeFrequency,
            Api::ReleaseCadence,
            Api::Trends,
            Api::IssueList,
            Api::PullList,
            Api::Labels,
        ];
    }

    /// The status and body of a visitor's request to `api` for `owner/repo`.
    async fn request(
        cache: &Arc<Cache>,
        api: Api,
        owner: &str,
        repo: &str,
    ) -> (StatusCode, String) {
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        request_as(cache, visitor, api, owner, repo).await
    }

    /// The status and body of `visitor`'s request to `api` for `owner/repo`.
    async fn request_as(
        cache: &Arc<Cache>,
        visitor: Viewer,
        api: Api,
        owner: &str,
        repo: &str,
    ) -> (StatusCode, String) {
        let names = Path((owner.to_owned(), repo.to_owned()));
        let cache = State(cache.clone());
        // Boxed, so that a test that asks for many is not as large as all their handlers'
        // futures together in a debug build, which would overflow its stack.
        let response = Box::pin(async move {
            match api {
                Api::Summary => summary(cache, visitor, names).await,
                Api::Stats => stats(cache, visitor, names).await,
                Api::CommitActivity => commit_activity(cache, visitor, names).await,
                Api::Languages => languages(cache, visitor, names).await,
                Api::Contributors => contributors(cache, visitor, names).await,
                Api::Issues => issues(cache, visitor, names).await,
                Api::Commits => commits(cache, visitor, names).await,
                Api::Releases => releases(cache, visitor, names).await,
                Api::MergeVelocity => merge_velocity(cache, visitor, names).await,
                Api::IssueAge => issue_age(cache, visitor, names).await,
                Api::WorkflowRuns => workflow_runs(cache, visitor, names).await,
                Api::CodeFrequency => code_frequency(cache, visitor, names).await,
                Api::ReleaseCadence => release_cadence(cache, visitor, names).await,
                Api::Trends => trends(cache, visitor, names).await,
                Api::IssueList => issue_list(cache, visitor, names, Query(HashMap::new())).await,
                Api::PullList => pull_list(cache, visitor, names, Query(HashMap::new())).await,
                Api::Labels => labels(cache, visitor, names).await,
            }
        })
        .await;
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    /// As [`request`], with the body as JSON, `null` if there is none, and without the time
    /// of fetching, since it is the time the test ran.
    async fn ask(cache: &Arc<Cache>, api: Api, owner: &str, repo: &str) -> (StatusCode, Value) {
        let (status, body) = request(cache, api, owner, repo).await;
        if body.is_empty() {
            return (status, Value::Null);
        }
        let mut body: Value = serde_json::from_str(&body).unwrap();
        // The summary tells it, and the figures of what is under the repository.
        if body.get("fetched_at").is_some() {
            fetched_at(&body);
            body.as_object_mut().unwrap().remove("fetched_at");
        }
        (status, body)
    }

    /// The status and body, as [`ask`] gives them, of a visitor's request for the list of
    /// `owner/repo`'s issues, or its pull requests, with `query`.
    async fn ask_list(
        cache: &Arc<Cache>,
        kind: Kind,
        owner: &str,
        repo: &str,
        query: &[(&str, &str)],
    ) -> (StatusCode, Value) {
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let names = Path((owner.to_owned(), repo.to_owned()));
        let query = Query(
            query
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect(),
        );
        let cache = State(cache.clone());
        let response = Box::pin(async move {
            match kind {
                Kind::Issue => issue_list(cache, visitor, names, query).await,
                Kind::PullRequest => pull_list(cache, visitor, names, query).await,
            }
        })
        .await;
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        if body.is_empty() {
            return (status, Value::Null);
        }
        let mut body: Value = serde_json::from_slice(&body).unwrap();
        fetched_at(&body);
        body.as_object_mut().unwrap().remove("fetched_at");
        (status, body)
    }

    /// The numbers of the items of a list's page, and their states.
    fn listed_states(page: &Value) -> Vec<(u64, String)> {
        page["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| {
                (
                    item["number"].as_u64().unwrap(),
                    item["state"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    }

    /// The time of fetching in `body`, which must be as JavaScript writes it.
    fn fetched_at(body: &Value) -> DateTimeUtc {
        let text = body["fetched_at"].as_str().unwrap();
        assert!(text.ends_with('Z') && text.len() == 24, "{text}");
        text.parse().unwrap()
    }

    #[tokio::test]
    async fn names_are_spelled_as_github_spells_them() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        for (owner, repo) in [("Acme", "Widget"), ("acme", "widget"), ("ACME", "WIDGET")] {
            let (status, body) = ask(&cache, Api::Summary, owner, repo).await;
            assert_eq!(
                (status, &body["name"]),
                (StatusCode::OK, &json!("Acme/Widget"))
            );
        }
    }

    #[tokio::test]
    async fn the_time_of_fetching_is_the_caches() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let before = ChronoUtc::now() - TimeDelta::milliseconds(1);
        let (_, first) = request(&cache, Api::Summary, "acme", "widget").await;
        let (_, again) = request(&cache, Api::Summary, "acme", "widget").await;
        let first = fetched_at(&serde_json::from_str(&first).unwrap());
        assert_eq!(fetched_at(&serde_json::from_str(&again).unwrap()), first);
        assert!(before <= first && first <= ChronoUtc::now(), "{first}");
        assert_eq!(stub.urls(), ["https://api.github.com/repos/acme/widget"]);
    }

    #[tokio::test]
    async fn renamed_repositories_have_their_new_name() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let (status, body) = ask(&cache, Api::Summary, "acme", "gadget").await;
        assert_eq!(
            (status, &body["name"]),
            (StatusCode::OK, &json!("Acme/Widget"))
        );
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/repos/acme/gadget",
                "https://api.github.com/repositories/42"
            ]
        );
    }

    #[tokio::test]
    async fn the_header_shows_what_github_says_of_the_repository() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Summary, "acme", "widget").await,
            (
                StatusCode::OK,
                json!({
                    "name": "Acme/Widget",
                    "stale": null,
                    "owner_avatar_url": "https://avatars.githubusercontent.com/u/1?v=4",
                    "description": "Widgets for everyone",
                    "visibility": "public",
                    "archived": true,
                    "template": true,
                    "fork": true,
                    "parent": "Upstream/Widget",
                    "topics": ["widgets", "rust"],
                    "license": "MIT License",
                    "default_branch": "main",
                    "homepage": "https://widget.example/docs",
                    "created_at": "2015-03-01T10:00:00Z",
                    "pushed_at": "2026-10-20T08:30:00Z",
                })
            )
        );
        assert_eq!(
            ask(&cache, Api::Summary, "acme", "bare").await,
            (
                StatusCode::OK,
                json!({
                    "name": "acme/bare",
                    "stale": null,
                    "owner_avatar_url": null,
                    "description": null,
                    "visibility": "public",
                    "archived": false,
                    "template": false,
                    "fork": false,
                    "parent": null,
                    "topics": [],
                    "license": null,
                    "default_branch": "main",
                    "homepage": null,
                    "created_at": "2026-10-20T08:00:00Z",
                    "pushed_at": null,
                })
            )
        );
    }

    #[tokio::test]
    async fn what_the_header_cannot_show_safely_is_left_out() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Summary, "acme", "odd").await,
            (
                StatusCode::OK,
                json!({
                    "name": "acme/odd",
                    "stale": null,
                    // Only from https URLs.
                    "owner_avatar_url": null,
                    "description": null,
                    // GitHub's own words, else what `private` says.
                    "visibility": "public",
                    "archived": false,
                    "template": false,
                    "fork": true,
                    // No repository is named so.
                    "parent": null,
                    "topics": ["ok"],
                    "license": null,
                    "default_branch": null,
                    // Links only to http and https URLs (NFR-SEC-03).
                    "homepage": null,
                    "created_at": null,
                    "pushed_at": null,
                })
            )
        );
    }

    #[tokio::test]
    async fn the_header_says_why_its_data_is_no_newer() {
        let down = Arc::new(AtomicBool::new(false));
        let stub = Stub::new({
            let down = down.clone();
            move |_| match down.load(Ordering::Relaxed) {
                true => answer(502, &[], r#"{"message": "Server Error"}"#),
                false => answer(200, &[], WIDGET),
            }
        });
        // Nothing is fresh, and visitors may fetch nothing.
        let cache = cache_for(&stub, 0, Duration::ZERO).await;
        let signed_in = Viewer::SignedIn {
            user_id: 1,
            sign_in: Secret::new("sign-in".to_owned()),
        };
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let ask = async |viewer: &Viewer| {
            let names = Path(("acme".to_owned(), "widget".to_owned()));
            let response = summary(State(cache.clone()), viewer.clone(), names).await;
            let status = response.status();
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let body: Value = serde_json::from_slice(&body).unwrap();
            (status, body["stale"].clone(), fetched_at(&body))
        };

        // Just fetched: as fresh as can be.
        let (status, stale, fetched) = ask(&signed_in).await;
        assert_eq!((status, stale), (StatusCode::OK, Value::Null));
        // A visitor who may not fetch from GitHub now is served what is cached, and told
        // why it is no newer, so that the dashboard can ask them to sign in.
        assert_eq!(
            ask(&visitor).await,
            (StatusCode::OK, json!("held"), fetched)
        );
        // GitHub fails: what is cached is served, with why it is no newer.
        down.store(true, Ordering::Relaxed);
        assert_eq!(
            ask(&signed_in).await,
            (StatusCode::OK, json!("github"), fetched)
        );
        assert_eq!(stub.urls().len(), 2);
    }

    /// FR-CMP-06, FR-DATA-05, FR-DATA-06: the figures of what is under a repository say when
    /// their data was fetched, which may be at another time than the repository, and why it
    /// is no newer, as the summary does, so that a comparison can say so of each section.
    #[tokio::test]
    async fn maintenance_figures_say_when_fetched_and_why_no_newer() {
        let down = Arc::new(AtomicBool::new(false));
        let stub = Stub::new({
            let down = down.clone();
            move |request| {
                if down.load(Ordering::Relaxed) {
                    return answer(502, &[], r#"{"message": "Server Error"}"#);
                }
                match request.uri().path() {
                    "/repos/acme/widget" => answer(200, &[], WIDGET),
                    "/search/issues" => answer(200, &[], PULLS),
                    "/repos/Acme/Widget/issues" => answer(200, &[], OPEN_ISSUES),
                    "/repos/Acme/Widget/actions/runs" => answer(200, &[], RUNS),
                    "/repos/Acme/Widget/releases" => answer(200, &[], RELEASES),
                    _ => answer(404, &[], r#"{"message": "Not Found"}"#),
                }
            }
        });
        // Nothing is fresh, and visitors may fetch nothing.
        let cache = cache_for(&stub, 0, Duration::ZERO).await;
        let signed_in = Viewer::SignedIn {
            user_id: 1,
            sign_in: Secret::new("sign-in".to_owned()),
        };
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let ask = async |viewer: &Viewer, api: Api| {
            let (status, body) = request_as(&cache, viewer.clone(), api, "acme", "widget").await;
            let body: Value = serde_json::from_str(&body).unwrap();
            (status, body["stale"].clone(), fetched_at(&body))
        };
        let apis = [
            Api::MergeVelocity,
            Api::IssueAge,
            Api::WorkflowRuns,
            Api::ReleaseCadence,
        ];

        for api in apis {
            // Just fetched: as fresh as can be, to the millisecond that it is told in.
            let before = ChronoUtc::now().trunc_subsecs(3);
            let (status, stale, fetched) = ask(&signed_in, api).await;
            assert_eq!((status, stale), (StatusCode::OK, Value::Null), "{api:?}");
            assert!(before <= fetched && fetched <= ChronoUtc::now(), "{api:?}");
            // A visitor who may not fetch from GitHub now is served what is cached, and told
            // why it is no newer.
            assert_eq!(
                ask(&visitor, api).await,
                (StatusCode::OK, json!("held"), fetched),
                "{api:?}"
            );
            // GitHub fails: what is cached is served, with why it is no newer.
            down.store(true, Ordering::Relaxed);
            assert_eq!(
                ask(&signed_in, api).await,
                (StatusCode::OK, json!("github"), fetched),
                "{api:?}"
            );
            down.store(false, Ordering::Relaxed);
        }
    }

    /// FR-EXP-04, FR-DATA-05, FR-DATA-06: what the charts' tables are made of says when its
    /// data was fetched, and why it is no newer, so that an export of a table can say so.
    #[tokio::test]
    async fn chart_figures_say_when_fetched_and_why_no_newer() {
        let down = Arc::new(AtomicBool::new(false));
        let stub = Stub::new({
            let down = down.clone();
            move |request| {
                if down.load(Ordering::Relaxed) {
                    return answer(502, &[], r#"{"message": "Server Error"}"#);
                }
                match request.uri().path() {
                    "/repos/acme/widget" => answer(200, &[], WIDGET),
                    "/repos/Acme/Widget/stats/commit_activity" => answer(200, &[], &activity()),
                    "/repos/Acme/Widget/stats/code_frequency" => answer(200, &[], &frequency()),
                    "/repos/Acme/Widget/languages" => answer(200, &[], LANGUAGES),
                    "/repos/Acme/Widget/contributors" => answer(200, &[], CONTRIBUTORS),
                    "/repos/Acme/Widget/issues" => answer(200, &[], ISSUES),
                    "/search/issues" => answer(200, &[], PULLS),
                    _ => answer(404, &[], r#"{"message": "Not Found"}"#),
                }
            }
        });
        // Nothing is fresh, and visitors may fetch nothing.
        let cache = cache_for(&stub, 0, Duration::ZERO).await;
        let signed_in = Viewer::SignedIn {
            user_id: 1,
            sign_in: Secret::new("sign-in".to_owned()),
        };
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let ask = async |viewer: &Viewer, api: Api| {
            let (status, body) = request_as(&cache, viewer.clone(), api, "acme", "widget").await;
            let body: Value = serde_json::from_str(&body).unwrap();
            (status, body["stale"].clone(), fetched_at(&body))
        };

        for api in [
            Api::CommitActivity,
            Api::CodeFrequency,
            Api::Languages,
            Api::Contributors,
            Api::Issues,
        ] {
            let before = ChronoUtc::now().trunc_subsecs(3);
            let (status, stale, fetched) = ask(&signed_in, api).await;
            assert_eq!((status, stale), (StatusCode::OK, Value::Null), "{api:?}");
            assert!(before <= fetched && fetched <= ChronoUtc::now(), "{api:?}");
            // A visitor who may not fetch from GitHub now is served what is cached, and told
            // why it is no newer.
            let (status, stale, _) = ask(&visitor, api).await;
            assert_eq!((status, stale), (StatusCode::OK, json!("held")), "{api:?}");
            // GitHub fails: what is cached is served, with why it is no newer.
            down.store(true, Ordering::Relaxed);
            let (status, stale, _) = ask(&signed_in, api).await;
            assert_eq!(
                (status, stale),
                (StatusCode::OK, json!("github")),
                "{api:?}"
            );
            down.store(false, Ordering::Relaxed);
        }
    }

    /// FR-EXP-04: counts made of several parts are as fresh as the part fetched first, here
    /// the repository, read before its searches were.
    #[tokio::test]
    async fn counts_are_as_fresh_as_their_oldest_part() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let fetched = |body: &str| fetched_at(&serde_json::from_str(body).unwrap());
        let repository = fetched(&request(&cache, Api::Summary, "acme", "widget").await.1);
        tokio::time::sleep(Duration::from_millis(5)).await;
        let (status, body) = request(&cache, Api::Issues, "acme", "widget").await;
        assert_eq!((status, fetched(&body)), (StatusCode::OK, repository));
    }

    #[test]
    fn a_figure_of_several_parts_is_dated_by_the_first_fetched_and_stale_if_any_is() {
        let at = |seconds| DateTimeUtc::from_timestamp(seconds, 0).unwrap();
        let fresh = Dating {
            fetched_at: at(200),
            stale: None,
        };
        let held = Dating {
            fetched_at: at(300),
            stale: Some("held"),
        };
        let failed = Dating {
            fetched_at: at(100),
            stale: Some("github"),
        };
        assert_eq!(
            fresh.and(held),
            Dating {
                fetched_at: at(200),
                stale: Some("held")
            }
        );
        assert_eq!(fresh.and(failed), failed);
        assert_eq!(fresh.and(fresh), fresh);
        assert_eq!(
            fresh.apply(json!({"weeks": []})),
            json!({"weeks": [], "fetched_at": "1970-01-01T00:03:20.000Z", "stale": null})
        );
    }

    /// FR-CMP-06: what is told without asking GitHub more is as fresh as the repository it is
    /// told from, and that GitHub refused to list workflow runs is as fresh as can be, since
    /// nothing is cached of it.
    #[tokio::test]
    async fn figures_told_without_asking_are_as_fresh_as_what_they_are_told_from() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let fetched = |body: &str| fetched_at(&serde_json::from_str(body).unwrap());
        let repository = fetched(&request(&cache, Api::Summary, "acme", "locked").await.1);
        for api in [Api::MergeVelocity, Api::IssueAge] {
            let (status, body) = request(&cache, api, "acme", "locked").await;
            assert_eq!(
                (status, fetched(&body)),
                (StatusCode::OK, repository),
                "{api:?}"
            );
        }
        let before = ChronoUtc::now().trunc_subsecs(3);
        let (status, body) = request(&cache, Api::WorkflowRuns, "acme", "guarded").await;
        let refused = fetched(&body);
        assert_eq!(status, StatusCode::OK);
        assert!(
            before <= refused && refused <= ChronoUtc::now(),
            "{refused}"
        );
    }

    #[test]
    fn links_are_to_absolute_urls_with_the_schemes_allowed() {
        let web = |url: &str| link(Some(&json!(url)), &["http", "https"]);
        assert_eq!(
            web("http://widget.example").as_deref(),
            Some("http://widget.example/")
        );
        assert_eq!(
            web(" https://widget.example/docs?a=1#b ").as_deref(),
            Some("https://widget.example/docs?a=1#b")
        );
        for url in [
            "",
            "widget.example",
            "/docs",
            "javascript:alert(1)",
            "ftp://widget.example",
        ] {
            assert_eq!(web(url), None, "{url}");
        }
        assert_eq!(link(Some(&json!(7)), &["https"]), None);
        assert_eq!(link(None, &["https"]), None);
        assert_eq!(
            link(Some(&json!("http://avatars.example/u/2")), &["https"]),
            None
        );
    }

    #[tokio::test]
    async fn stat_cards_count_issues_and_pull_requests_apart() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let widget = json!({
            "stars": 12345,
            "forks": 678,
            "watchers": 321,
            "open_issues": 33,
            "open_pull_requests": 12,
            "latest_release": {
                "tag": "v2.1.0",
                "published_at": "2026-10-01T12:00:00Z",
                "url": "https://github.com/Acme/Widget/releases/tag/v2.1.0",
            },
        });
        assert_eq!(
            ask(&cache, Api::Stats, "acme", "widget").await,
            (StatusCode::OK, widget.clone())
        );

        // What is under the repository is asked for by its names as GitHub spells them,
        // here those of the repository it was renamed to, and is then cached.
        assert_eq!(
            ask(&cache, Api::Stats, "acme", "gadget").await,
            (StatusCode::OK, widget)
        );
        let mut urls = stub.urls();
        urls.sort();
        assert_eq!(
            urls,
            [
                "https://api.github.com/repos/Acme/Widget/releases/latest",
                "https://api.github.com/repos/acme/gadget",
                "https://api.github.com/repos/acme/widget",
                "https://api.github.com/repositories/42",
                "https://api.github.com/search/issues?q=repo%3AAcme%2FWidget+is%3Apr+is%3Aopen&per_page=1",
            ]
        );
    }

    /// Whose data fetched without a PAT is.
    const SHARED: Source = Source {
        scope: Scope::Shared,
        pat: None,
    };

    /// What was observed of repositories, as the stars, the repository's ID and the times.
    async fn observed(cache: &Cache) -> Vec<(i64, i64, DateTimeUtc, DateTimeUtc)> {
        use sea_orm::{EntityTrait, QueryOrder};

        use crate::entity::repository_observation::{Column, Entity};

        Entity::find()
            .order_by_asc(Column::ObservedAt)
            .all(cache.db())
            .await
            .unwrap()
            .into_iter()
            .map(|row| {
                (
                    row.stars,
                    row.repository_id,
                    row.observed_at,
                    row.pull_requests_observed_at,
                )
            })
            .collect()
    }

    #[tokio::test]
    async fn stat_cards_are_observed_as_github_gives_them() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let before = ChronoUtc::now();
        for _ in 0..2 {
            assert_eq!(
                ask(&cache, Api::Stats, "acme", "widget").await.0,
                StatusCode::OK
            );
        }
        // Once, while they are cached, at when GitHub gave them.
        let rows = observed(&cache).await;
        assert_eq!(rows.len(), 1, "{rows:?}");
        let (stars, id, observed_at, pulls_at) = rows[0];
        assert_eq!((stars, id), (12345, 42));
        assert!(before <= observed_at && observed_at <= pulls_at, "{rows:?}");
        // Under the repository's ID, however it is asked for: by its old name, it is read
        // anew, so observed later, with the open pull requests still cached.
        assert_eq!(
            ask(&cache, Api::Stats, "acme", "gadget").await.0,
            StatusCode::OK
        );
        let again = observed(&cache).await;
        assert_eq!(again.len(), 1, "{again:?}");
        assert!(
            again[0].2 > observed_at && again[0].3 == pulls_at,
            "{again:?}"
        );
        // Anything else but the repository and the count of its open pull requests asks
        // nothing more of GitHub.
        assert_eq!(stub.requests().len(), 5);
    }

    #[tokio::test]
    async fn the_repository_read_first_by_another_widget_is_still_observed() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let (_, summary) = ask(&cache, Api::Summary, "acme", "widget").await;
        assert_eq!(summary["name"], "Acme/Widget");
        ask(&cache, Api::Stats, "acme", "widget").await;
        assert_eq!(observed(&cache).await.len(), 1);
    }

    #[tokio::test]
    async fn a_newly_tracked_repository_has_no_baseline() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let (status, body) = ask(&cache, Api::Trends, "acme", "widget").await;
        assert_eq!(status, StatusCode::OK);
        let rows = observed(&cache).await;
        let observed_at = cache::iso(rows[0].2);
        assert_eq!(body["scope"], "shared");
        assert_eq!(body["kept_days"], 90);
        assert_eq!(body["tracking_since"], observed_at.as_str());
        assert_eq!(body["stale"], Value::Null);
        assert_eq!(
            body["observations"],
            json!([{
                "day": rows[0].2.date_naive().to_string(),
                "observed_at": observed_at,
                "pull_requests_observed_at": cache::iso(rows[0].3),
                "stars": 12345, "forks": 678, "open_issues": 33, "open_pull_requests": 12,
            }])
        );
        assert_eq!(body["gaps"], json!([]));
        for period in body["periods"].as_array().unwrap() {
            assert_eq!(
                (&period["supported"], &period["reason"]),
                (&json!(false), &json!("first_observation")),
                "{period}"
            );
        }
    }

    #[tokio::test]
    async fn changes_match_the_observations_they_are_between_and_gaps_stay() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        // As if BuhTig had observed Acme/Widget 10 days and a week before now.
        let now = ChronoUtc::now().trunc_subsecs(3);
        for (days, stars) in [(10, 12000), (7, 12300)] {
            let observation = Observation {
                source: SHARED,
                repository_id: 42,
                observed_at: now - TimeDelta::days(days),
                pull_requests_observed_at: now - TimeDelta::days(days),
                figures: Figures {
                    stars,
                    forks: 600,
                    open_issues: 40,
                    open_pull_requests: 12,
                },
            };
            assert!(trends::record(cache.db(), &observation).await.unwrap());
        }
        let (_, body) = ask(&cache, Api::Trends, "acme", "widget").await;
        let week = &body["periods"][0];
        assert_eq!(week["days"], 7);
        assert_eq!(week["supported"], true, "{week}");
        assert_eq!(
            week["from"]["observed_at"],
            cache::iso(now - TimeDelta::days(7)).as_str()
        );
        assert_eq!(week["to"], body["observations"][2]);
        assert_eq!(
            week["changes"],
            json!({"stars": 45, "forks": 78, "open_issues": -7, "open_pull_requests": 0})
        );
        // A month: tracked for 10 days only.
        assert_eq!(body["periods"][1]["reason"], "tracked_later");
        // The days between observations are told as gaps, not as observations.
        let day = |days: i64| (now - TimeDelta::days(days)).date_naive().to_string();
        let today = body["observations"][2]["day"].as_str().unwrap().to_owned();
        assert_eq!(today, day(0));
        assert_eq!(
            body["gaps"],
            json!([
                {"from": day(9), "to": day(8)},
                {"from": day(6), "to": day(1)},
            ])
        );
        assert_eq!(body["observations"].as_array().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn trends_are_told_only_from_a_fresh_read_of_the_repository() {
        let down = Arc::new(AtomicBool::new(false));
        let stub = Stub::new({
            let down = down.clone();
            move |_| match down.load(Ordering::Relaxed) {
                true => answer(502, &[], r#"{"message": "Server Error"}"#),
                false => answer(200, &[], WIDGET),
            }
        });
        // Nothing is fresh, and visitors may fetch nothing.
        let cache = cache_for(&stub, 0, Duration::ZERO).await;
        let observation = Observation {
            source: SHARED,
            repository_id: 42,
            observed_at: ChronoUtc::now() - TimeDelta::days(1),
            pull_requests_observed_at: ChronoUtc::now() - TimeDelta::days(1),
            figures: Figures {
                stars: 1,
                forks: 1,
                open_issues: 1,
                open_pull_requests: 1,
            },
        };
        assert!(trends::record(cache.db(), &observation).await.unwrap());
        let signed_in = Viewer::SignedIn {
            user_id: 1,
            sign_in: Secret::new("sign-in".to_owned()),
        };
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let ask = async |viewer: &Viewer| {
            request_as(&cache, viewer.clone(), Api::Trends, "acme", "widget").await
        };

        // Read just now: what was observed is told.
        let (status, body) = ask(&signed_in).await;
        assert_eq!(status, StatusCode::OK);
        let body: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(body["observations"].as_array().unwrap().len(), 1);
        // Read no more recently than the cache has it, which may no longer be so to see:
        // nothing is told, though the summary is served (FR-DATA-05).
        assert_eq!(
            ask(&visitor).await,
            (StatusCode::TOO_MANY_REQUESTS, String::new())
        );
        down.store(true, Ordering::Relaxed);
        assert_eq!(
            ask(&signed_in).await,
            (StatusCode::BAD_GATEWAY, String::new())
        );
        assert_eq!(
            request_as(&cache, signed_in, Api::Summary, "acme", "widget")
                .await
                .0,
            StatusCode::OK
        );
    }

    /// FR-PERS-10, FR-DATA-14: a watchlist's row tells the week's change only from a read of
    /// the repository that GitHub gave or confirmed just now, as the Activity tab does, and
    /// otherwise shows the rest of the row without it. It observes nothing.
    #[tokio::test]
    async fn a_row_tells_a_trend_only_from_a_fresh_read_of_the_repository() {
        let down = Arc::new(AtomicBool::new(false));
        let stub = Stub::new({
            let down = down.clone();
            move |_| match down.load(Ordering::Relaxed) {
                true => answer(502, &[], r#"{"message": "Server Error"}"#),
                false => answer(200, &[], WIDGET),
            }
        });
        let cache = cache_for(&stub, 0, Duration::ZERO).await;
        let observed_at = ChronoUtc::now() - TimeDelta::days(1);
        let observation = Observation {
            source: SHARED,
            repository_id: 42,
            observed_at,
            pull_requests_observed_at: observed_at,
            figures: Figures {
                stars: 1,
                forks: 2,
                open_issues: 3,
                open_pull_requests: 4,
            },
        };
        assert!(trends::record(cache.db(), &observation).await.unwrap());
        let signed_in = Viewer::SignedIn {
            user_id: 1,
            sign_in: Secret::new("sign-in".to_owned()),
        };
        let ask = async || {
            let response = glance(
                State(cache.clone()),
                signed_in.clone(),
                Path(("acme".into(), "widget".into())),
                Query(HashMap::new()),
            )
            .await;
            let status = response.status();
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            (status, serde_json::from_slice::<Value>(&body).unwrap())
        };
        let observations = async || {
            trends::read(cache.db(), SHARED, 42, ChronoUtc::now())
                .await
                .unwrap()
                .len()
        };

        let (status, body) = ask().await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["trend"]["scope"], "shared");
        assert_eq!(body["trend"]["latest"]["stars"], 1);
        assert_eq!(body["trend"]["period"]["reason"], "first_observation");
        // Without a watchlist, there is nothing to mark.
        assert_eq!(body["since"], Value::Null);
        assert_eq!(observations().await, 1);

        // While GitHub fails, the row shows what the cache has, and no trend.
        down.store(true, Ordering::Relaxed);
        let (status, body) = ask().await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["stale"], "github");
        assert_eq!(body["trend"], Value::Null);
        assert_eq!(observations().await, 1);
    }

    #[tokio::test]
    async fn a_repository_without_its_id_is_not_observed() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Stats, "acme", "racy").await.0,
            StatusCode::OK
        );
        assert!(observed(&cache).await.is_empty());
        assert_eq!(
            ask(&cache, Api::Trends, "acme", "racy").await.0,
            StatusCode::BAD_GATEWAY
        );
    }

    #[test]
    fn observations_are_of_fresh_figures_of_one_scope() {
        let widget: Value = serde_json::from_str(WIDGET).unwrap();
        let (repository_at, pulls_at) = (
            "2026-11-09T10:00:00Z".parse().unwrap(),
            "2026-11-09T10:05:00Z".parse().unwrap(),
        );
        let alices = Source {
            scope: Scope::User(1),
            pat: Some(7),
        };
        let repository = |data: &Value, stale: Option<&'static str>, source: Source| Under {
            viewer: Viewer::Visitor(Visitor::of(
                "203.0.113.1".parse().unwrap(),
                &HeaderMap::new(),
            )),
            dashboard: "/acme/widget".to_owned(),
            name: "Acme/Widget".to_owned(),
            data: data.clone(),
            fetched_at: repository_at,
            stale,
            source,
        };
        let pulls = |stale: Option<Stale>, source: Source| Cached {
            data: json!({"total_count": 12}),
            fetched_at: pulls_at,
            stale,
            source,
        };
        assert_eq!(
            observation(&repository(&widget, None, SHARED), &pulls(None, SHARED)),
            Some(Observation {
                source: SHARED,
                repository_id: 42,
                observed_at: repository_at,
                pull_requests_observed_at: pulls_at,
                figures: Figures {
                    stars: 12345,
                    forks: 678,
                    open_issues: 33,
                    open_pull_requests: 12,
                },
            })
        );
        assert!(observation(&repository(&widget, None, alices), &pulls(None, alices)).is_some());

        // Not of what is stale, as during an outage.
        let down = || Some(Stale::GitHub(github::Error::Unreachable("down".to_owned())));
        assert_eq!(
            observation(
                &repository(&widget, Some("github"), SHARED),
                &pulls(None, SHARED)
            ),
            None
        );
        assert_eq!(
            observation(&repository(&widget, None, SHARED), &pulls(down(), SHARED)),
            None
        );
        // Nor of two scopes, as when GitHub rejected a PAT between the two.
        assert_eq!(
            observation(&repository(&widget, None, alices), &pulls(None, SHARED)),
            None
        );
        // Nor, in the shared scope, of a repository that is not public.
        let mut internal = widget.clone();
        internal["visibility"] = json!("internal");
        assert_eq!(
            observation(&repository(&internal, None, SHARED), &pulls(None, SHARED)),
            None
        );
        assert!(observation(&repository(&internal, None, alices), &pulls(None, alices)).is_some());
        // Nor of what GitHub left out.
        for left_out in ["id", "stargazers_count", "forks_count", "open_issues_count"] {
            let mut partial = widget.clone();
            partial.as_object_mut().unwrap().remove(left_out);
            assert_eq!(
                observation(&repository(&partial, None, SHARED), &pulls(None, SHARED)),
                None,
                "{left_out}"
            );
        }
    }

    #[tokio::test]
    async fn a_repository_without_releases_has_no_latest_one() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let bare = json!({
            "stars": 0,
            "forks": 0,
            "watchers": 0,
            "open_issues": 0,
            "open_pull_requests": 0,
            "latest_release": null,
        });
        assert_eq!(
            ask(&cache, Api::Stats, "acme", "bare").await,
            (StatusCode::OK, bare.clone())
        );
        // GitHub's "not found" was the answer, so it is not asked again.
        assert_eq!(
            ask(&cache, Api::Stats, "acme", "bare").await,
            (StatusCode::OK, bare)
        );
        assert_eq!(stub.urls().len(), 3);
    }

    #[tokio::test]
    async fn counts_read_at_different_times_never_go_below_zero() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let (status, body) = ask(&cache, Api::Stats, "acme", "racy").await;
        assert_eq!(
            (status, &body["open_issues"], &body["open_pull_requests"]),
            (StatusCode::OK, &json!(0), &json!(3))
        );
    }

    #[test]
    fn releases_link_only_to_their_page_on_github() {
        let release = |url: &str| {
            release(
                &json!({"tag_name": "v1", "created_at": "2026-10-01T12:00:00Z", "html_url": url}),
                "github.com",
            )
        };
        assert_eq!(
            release("https://github.com/acme/widget/releases/tag/v1"),
            Some(json!({
                "tag": "v1",
                "published_at": "2026-10-01T12:00:00Z",
                "url": "https://github.com/acme/widget/releases/tag/v1",
            }))
        );
        for url in [
            "http://github.com/acme/widget",
            "https://evil.example/",
            "javascript:x",
        ] {
            assert_eq!(release(url).unwrap()["url"], Value::Null, "{url}");
        }
        assert_eq!(super::release(&json!({"tag_name": ""}), "github.com"), None);
    }

    /// On GitHub Enterprise Server, links go to its pages alone, and no longer to
    /// github.com's.
    #[test]
    fn pages_are_on_the_configured_github_host() {
        let page = |url: &str| super::page(Some(&json!(url)), "ghe.example.com");
        assert_eq!(
            page("https://ghe.example.com/acme/widget/releases/tag/v1").as_deref(),
            Some("https://ghe.example.com/acme/widget/releases/tag/v1")
        );
        assert_eq!(
            page("https://GHE.example.com/acme").as_deref(),
            Some("https://ghe.example.com/acme")
        );
        for url in [
            "https://github.com/acme/widget",
            "http://ghe.example.com/acme",
            "https://ghe.example.com.evil.example/acme",
            "https://evil.example/ghe.example.com",
        ] {
            assert_eq!(page(url), None, "{url}");
        }
    }

    #[tokio::test]
    async fn commit_activity_is_by_week_oldest_first() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let (status, body) = ask(&cache, Api::CommitActivity, "acme", "gadget").await;
        assert_eq!(status, StatusCode::OK);
        let weeks = body["weeks"].as_array().unwrap();
        assert_eq!(weeks.len(), 52);
        assert_eq!(weeks[0], json!({"week": "2025-10-26", "commits": 0}));
        assert_eq!(weeks[1], json!({"week": "2025-11-02", "commits": 1}));
        assert_eq!(weeks[51], json!({"week": "2026-10-18", "commits": 51}));
        // Under the names of the repository it was renamed to.
        assert!(
            stub.urls().contains(
                &"https://api.github.com/repos/Acme/Widget/stats/commit_activity".to_owned()
            ),
            "{:?}",
            stub.urls()
        );
    }

    #[test]
    fn commit_activity_is_the_last_52_weeks_github_gave() {
        let week = |week: i64, total: u64| json!({"week": week * 7 * 24 * 60 * 60, "total": total});
        let mut given: Vec<Value> = (0..53).map(|n| week(n, n as u64)).collect();
        given.reverse();
        let weeks = weeks(&Value::from(given)).unwrap();
        assert_eq!(weeks.len(), 52);
        assert_eq!(weeks[0], json!({"week": "1970-01-08", "commits": 1}));
        assert_eq!(weeks[51], json!({"week": "1970-12-31", "commits": 52}));
        // What GitHub gives for an empty repository.
        for empty in [Value::Null, json!({}), json!([])] {
            assert_eq!(super::weeks(&empty), Some(Vec::new()), "{empty}");
        }
        for odd in [
            json!({"message": "Not computed"}),
            json!([{"week": "soon", "total": 1}]),
            json!([{"week": 0, "total": -1}]),
            json!([{"total": 1}]),
            json!("weeks"),
        ] {
            assert_eq!(super::weeks(&odd), None, "{odd}");
        }
    }

    #[tokio::test]
    async fn statistics_github_is_still_computing_are_asked_for_again() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        for (api, statistic) in [
            (Api::CommitActivity, "commit_activity"),
            (Api::CodeFrequency, "code_frequency"),
        ] {
            for _ in 0..2 {
                assert_eq!(
                    ask(&cache, api, "acme", "busy").await,
                    (StatusCode::ACCEPTED, Value::Null),
                    "{api:?}"
                );
            }
            // Nothing is cached of what GitHub has yet to compute.
            let asked = stub.urls();
            let computing = format!("https://api.github.com/repos/acme/busy/stats/{statistic}");
            assert_eq!(
                asked.iter().filter(|url| **url == computing).count(),
                2,
                "{asked:?}"
            );
        }
    }

    #[tokio::test]
    async fn languages_are_the_top_8_and_the_rest_together() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Languages, "acme", "widget").await,
            (
                StatusCode::OK,
                json!({
                    "languages": [
                        {"name": "Rust", "bytes": 50000},
                        {"name": "TypeScript", "bytes": 30000},
                        // As large as each other, so by name.
                        {"name": "CSS", "bytes": 5000},
                        {"name": "HTML", "bytes": 5000},
                        {"name": "Shell", "bytes": 1000},
                        {"name": "Dockerfile", "bytes": 500},
                        {"name": "Makefile", "bytes": 300},
                        {"name": "JavaScript", "bytes": 200},
                    ],
                    // Python and Nix.
                    "other": 150,
                    "stale": null,
                })
            )
        );
        assert_eq!(
            shares(&json!({"Rust": 10, "Other": 5})),
            Some(json!({
                "languages": [{"name": "Rust", "bytes": 10}, {"name": "Other", "bytes": 5}],
                "other": 0,
            }))
        );
        assert_eq!(shares(&json!(["Rust"])), None);
    }

    #[tokio::test]
    async fn contributors_are_those_with_the_most_commits() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Contributors, "acme", "widget").await,
            (
                StatusCode::OK,
                json!({
                    "contributors": [
                        // Not a page on GitHub.
                        {"login": "bob", "avatar_url": null, "url": null, "commits": 300},
                        {
                            "login": "alice",
                            "avatar_url": "https://avatars.githubusercontent.com/u/2?v=4",
                            "url": "https://github.com/alice",
                            "commits": 120,
                        },
                        {
                            "login": "dependabot[bot]",
                            "avatar_url": "https://avatars.githubusercontent.com/in/29110?v=4",
                            "url": "https://github.com/apps/dependabot",
                            "commits": 40,
                        },
                        // Avatars only from https URLs, and links only to GitHub's pages.
                        {"login": "mallory", "avatar_url": null, "url": null, "commits": 7},
                    ],
                    // As GitHub lists them, those it gave no login or count too. They fit
                    // on one page, so they are not counted apart.
                    "count": 6,
                    "too_large": false,
                    "stale": null,
                })
            )
        );
        assert!(
            stub.urls().contains(
                &"https://api.github.com/repos/Acme/Widget/contributors?per_page=10".to_owned()
            ),
            "{:?}",
            stub.urls()
        );
    }

    #[tokio::test]
    async fn contributors_and_releases_past_a_page_are_counted_apart() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let (status, contributors) = ask(&cache, Api::Contributors, "acme", "crowded").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            (
                contributors["contributors"].as_array().unwrap().len(),
                &contributors["count"],
                &contributors["too_large"]
            ),
            (10, &json!(1234), &json!(false))
        );
        let (status, releases) = ask(&cache, Api::Releases, "acme", "crowded").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            (
                releases["releases"].as_array().unwrap().len(),
                &releases["count"]
            ),
            (5, &json!(37))
        );
        // Both are then cached.
        assert_eq!(
            ask(&cache, Api::Releases, "acme", "crowded").await,
            (status, releases)
        );
        let mut urls = stub.urls();
        urls.sort();
        assert_eq!(
            urls,
            [
                "https://api.github.com/repos/acme/crowded",
                "https://api.github.com/repos/acme/crowded/contributors?per_page=1",
                "https://api.github.com/repos/acme/crowded/contributors?per_page=10",
                "https://api.github.com/repos/acme/crowded/releases?per_page=1",
                "https://api.github.com/repos/acme/crowded/releases?per_page=5",
            ]
        );
    }

    #[tokio::test]
    async fn contributors_github_lists_but_will_not_count_have_no_count() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let (status, body) = ask(&cache, Api::Contributors, "acme", "uncountable").await;
        assert_eq!(
            (
                status,
                body["contributors"].as_array().unwrap().len(),
                &body["count"],
                &body["too_large"]
            ),
            (StatusCode::OK, 10, &Value::Null, &json!(false))
        );
    }

    #[tokio::test]
    async fn contributors_github_does_not_list_are_said_to_be_too_many() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Contributors, "acme", "huge").await,
            (
                StatusCode::OK,
                json!({"contributors": [], "count": null, "too_large": true, "stale": null})
            )
        );
    }

    #[tokio::test]
    async fn issues_and_pull_requests_are_counted_by_state_and_the_latest_listed() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Issues, "acme", "widget").await,
            (
                StatusCode::OK,
                json!({
                    // Open issues as the stat cards count them.
                    "issues": {"open": 33, "closed": 120},
                    // Closed without being merged.
                    "pull_requests": {"open": 12, "merged": 300, "closed": 40},
                    "recent": [
                        {
                            "number": 50,
                            "title": "Widgets wobble",
                            "kind": "issue",
                            "state": "open",
                            "author": "alice",
                            "created_at": "2026-10-20T08:00:00Z",
                            "updated_at": "2026-10-22T09:00:00Z",
                            "url": "https://github.com/Acme/Widget/issues/50",
                        },
                        {
                            "number": 49,
                            "title": "Steady the widgets",
                            "kind": "pull_request",
                            "state": "merged",
                            "author": "bob",
                            "created_at": "2026-10-19T08:00:00Z",
                            "updated_at": "2026-10-21T08:00:00Z",
                            "url": "https://github.com/Acme/Widget/pull/49",
                        },
                        {
                            "number": 48,
                            "title": "Paint the widgets",
                            "kind": "pull_request",
                            "state": "closed",
                            "author": "carol",
                            "created_at": "2026-10-18T08:00:00Z",
                            "updated_at": "2026-10-20T08:00:00Z",
                            "url": "https://github.com/Acme/Widget/pull/48",
                        },
                        // Links only to GitHub's pages.
                        {
                            "number": 47,
                            "title": "Widgets are too blue",
                            "kind": "issue",
                            "state": "closed",
                            "author": null,
                            "created_at": null,
                            "updated_at": null,
                            "url": null,
                        },
                        // A draft is open, as the counts have it.
                        {
                            "number": 46,
                            "title": "Square widgets",
                            "kind": "pull_request",
                            "state": "open",
                            "author": "dave",
                            "created_at": null,
                            "updated_at": null,
                            "url": null,
                        },
                    ],
                    "stale": null,
                })
            )
        );
        assert!(
            stub.urls().contains(
                &"https://api.github.com/repos/Acme/Widget/issues?state=all&sort=updated&direction=desc&per_page=6"
                    .to_owned()
            ),
            "{:?}",
            stub.urls()
        );
    }

    #[tokio::test]
    async fn each_tab_lists_a_full_page_of_its_own_kind() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        // Its 1,234 open pull requests were all updated after its issues.
        let (status, first) = ask_list(&cache, Kind::Issue, "acme", "widget", &[]).await;
        assert_eq!(status, StatusCode::OK);
        let items = first["items"].as_array().unwrap();
        assert_eq!(items.len(), 25);
        assert!(items.iter().all(|item| item["kind"] == "issue"), "{first}");
        assert_eq!(
            items[0],
            json!({
                "number": 30,
                "title": "Widgets 30",
                "kind": "issue",
                "state": "open",
                "author": "alice",
                "created_at": "2026-10-01T08:00:00Z",
                "updated_at": "2026-10-22T08:00:00Z",
                "url": "https://github.com/Acme/Widget/issues/30",
            })
        );
        let mut rest = first.clone();
        rest.as_object_mut().unwrap().remove("items");
        assert_eq!(
            rest,
            json!({
                "total": 30, "page": 1, "pages": 2, "per_page": 25, "capped": false,
                "incomplete": false, "off": false, "stale": null,
            })
        );
        // The last page has the rest.
        let (_, last) = ask_list(&cache, Kind::Issue, "acme", "widget", &[("page", "2")]).await;
        assert_eq!(
            listed_states(&last),
            (1..=5)
                .rev()
                .map(|n| (n, "open".to_owned()))
                .collect::<Vec<_>>()
        );
        assert_eq!((&last["page"], &last["pages"]), (&json!(2), &json!(2)));
        // Only the pages asked for, as GitHub's search finds them.
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/repos/acme/widget",
                "https://api.github.com/search/issues?q=repo%3AAcme%2FWidget+is%3Aissue+is%3Aopen&sort=updated&order=desc&per_page=25&page=1",
                "https://api.github.com/search/issues?q=repo%3AAcme%2FWidget+is%3Aissue+is%3Aopen&sort=updated&order=desc&per_page=25&page=2",
            ]
        );
        // Each page is cached.
        ask_list(&cache, Kind::Issue, "acme", "widget", &[("page", "2")]).await;
        assert_eq!(stub.urls().len(), 3);
    }

    #[tokio::test]
    async fn pull_requests_are_listed_by_how_they_ended() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let list = |state| {
            let cache = cache.clone();
            async move {
                let (status, page) = ask_list(
                    &cache,
                    Kind::PullRequest,
                    "acme",
                    "widget",
                    &[("state", state)],
                )
                .await;
                assert_eq!(status, StatusCode::OK, "{state}");
                page
            }
        };

        let merged = list("merged").await;
        assert_eq!(merged["total"], 300);
        assert_eq!(merged["items"][0]["kind"], "pull_request");
        assert_eq!(
            merged["items"][0]["url"],
            "https://github.com/Acme/Widget/pull/3299"
        );
        assert!(
            listed_states(&merged)
                .iter()
                .all(|(_, state)| state == "merged")
        );

        // Closed without being merged.
        let closed = list("closed").await;
        assert_eq!(closed["total"], 40);
        assert!(
            listed_states(&closed)
                .iter()
                .all(|(_, state)| state == "closed")
        );

        // More than GitHub's search reaches: 40 pages of them.
        let open = list("open").await;
        assert_eq!(
            (&open["total"], &open["pages"], &open["capped"]),
            (&json!(1234), &json!(40), &json!(true))
        );

        let all = list("all").await;
        assert_eq!(all["total"], 1574);
        assert_eq!(listed_states(&all)[0], (4039, "closed".to_owned()));

        let searched: Vec<String> = stub
            .urls()
            .into_iter()
            .filter_map(|url| {
                let query = Url::parse(&url).ok()?;
                let q = query.query_pairs().find(|(key, _)| key == "q")?.1;
                Some(q.into_owned())
            })
            .collect();
        assert_eq!(
            searched,
            [
                "repo:Acme/Widget is:pr is:merged",
                "repo:Acme/Widget is:pr is:closed is:unmerged",
                "repo:Acme/Widget is:pr is:open",
                "repo:Acme/Widget is:pr",
            ]
        );
    }

    #[tokio::test]
    async fn the_oldest_and_those_of_a_label_are_found_by_the_search() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let (_, oldest) =
            ask_list(&cache, Kind::Issue, "acme", "widget", &[("sort", "oldest")]).await;
        assert_eq!(listed_states(&oldest)[0], (1, "open".to_owned()));

        let (_, bugs) = ask_list(
            &cache,
            Kind::Issue,
            "acme",
            "widget",
            &[
                ("label", "bug"),
                ("state", "open"),
                ("sort", "updated"),
                ("page", "1"),
            ],
        )
        .await;
        assert_eq!(
            listed_states(&bugs),
            [
                (3, "open".to_owned()),
                (2, "open".to_owned()),
                (1, "open".to_owned())
            ]
        );
        assert_eq!((&bugs["total"], &bugs["pages"]), (&json!(3), &json!(1)));

        // A label with spaces, quoted, as one qualifier. None has it.
        let (status, none) = ask_list(
            &cache,
            Kind::Issue,
            "acme",
            "widget",
            &[("label", "good first issue"), ("state", "all")],
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            (&none["items"], &none["total"], &none["pages"]),
            (&json!([]), &json!(0), &json!(1))
        );
        let searches: Vec<String> = stub
            .urls()
            .into_iter()
            .filter(|url| url.contains("/search/"))
            .collect();
        assert_eq!(
            searches,
            [
                "https://api.github.com/search/issues?q=repo%3AAcme%2FWidget+is%3Aissue+is%3Aopen&sort=created&order=asc&per_page=25&page=1",
                "https://api.github.com/search/issues?q=repo%3AAcme%2FWidget+is%3Aissue+is%3Aopen+label%3A%22bug%22&sort=updated&order=desc&per_page=25&page=1",
                "https://api.github.com/search/issues?q=repo%3AAcme%2FWidget+is%3Aissue+label%3A%22good+first+issue%22&sort=updated&order=desc&per_page=25&page=1",
            ]
        );
    }

    #[tokio::test]
    async fn a_search_that_ran_out_of_time_says_so() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let (_, slow) = ask_list(&cache, Kind::Issue, "acme", "widget", &[("label", "slow")]).await;
        assert_eq!(
            (&slow["total"], &slow["incomplete"]),
            (&json!(2), &json!(true))
        );
    }

    #[tokio::test]
    async fn views_the_lists_cannot_show_are_not_asked_for() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let long = "l".repeat(51);
        for (kind, query) in [
            // Issues are never merged.
            (Kind::Issue, ("state", "merged")),
            (Kind::PullRequest, ("state", "draft")),
            (Kind::PullRequest, ("state", "")),
            (Kind::Issue, ("sort", "newest")),
            (Kind::Issue, ("page", "0")),
            // Past the 1,000 that GitHub's search reaches.
            (Kind::Issue, ("page", "41")),
            (Kind::Issue, ("page", "two")),
            (Kind::Issue, ("page", "+2")),
            (Kind::Issue, ("page", "")),
            (Kind::Issue, ("label", "")),
            // What would end the quoted label, and add qualifiers of its own.
            (Kind::Issue, ("label", "x\" repo:acme/secret")),
            (Kind::Issue, ("label", "line\nbreak")),
            (Kind::Issue, ("label", &long)),
        ] {
            assert_eq!(
                ask_list(&cache, kind, "acme", "widget", &[query]).await,
                (StatusCode::BAD_REQUEST, Value::Null),
                "{kind:?} {query:?}"
            );
        }
        assert_eq!(stub.urls(), Vec::<String>::new());

        // The longest a label's name can be, whatever its letters.
        let longest = "é".repeat(50);
        let page = ask_list(
            &cache,
            Kind::Issue,
            "acme",
            "widget",
            &[("label", &longest)],
        )
        .await;
        assert_eq!(page.0, StatusCode::OK);
        assert_eq!(
            ask_list(
                &cache,
                Kind::PullRequest,
                "acme",
                "widget",
                &[("page", "40")]
            )
            .await
            .0,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn lists_turned_off_are_said_to_be_and_not_searched() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let off = json!({
            "items": [], "total": 0, "page": 1, "pages": 1, "per_page": 25, "capped": false,
            "incomplete": false, "off": true, "stale": null,
        });
        assert_eq!(
            ask_list(&cache, Kind::Issue, "acme", "mirror", &[]).await,
            (StatusCode::OK, off.clone())
        );
        assert_eq!(
            ask_list(&cache, Kind::PullRequest, "acme", "locked", &[]).await,
            (StatusCode::OK, off)
        );
        assert!(
            stub.urls().iter().all(|url| !url.contains("/search/")),
            "{:?}",
            stub.urls()
        );
    }

    #[tokio::test]
    async fn labels_are_listed_by_name() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Labels, "acme", "widget").await,
            (
                StatusCode::OK,
                // Without those the search cannot take, nor any without a name.
                json!({
                    "labels": ["area/api", "bug", "Docs", "good first issue"],
                    "truncated": false,
                })
            )
        );
        assert!(
            stub.urls().contains(
                &"https://api.github.com/repos/Acme/Widget/labels?per_page=100".to_owned()
            ),
            "{:?}",
            stub.urls()
        );
    }

    #[test]
    fn the_search_for_a_list_has_the_qualifiers_of_its_view() {
        let view = |shown, label: Option<&str>| ListView {
            shown,
            label: label.map(str::to_owned),
            order: Order::Updated,
            page: 1,
        };
        for (kind, shown, label, expected) in [
            (Kind::Issue, Shown::Open, None, "repo:o/r is:issue is:open"),
            (
                Kind::Issue,
                Shown::Closed,
                None,
                "repo:o/r is:issue is:closed",
            ),
            (
                Kind::Issue,
                Shown::All,
                Some("bug"),
                r#"repo:o/r is:issue label:"bug""#,
            ),
            (
                Kind::PullRequest,
                Shown::Open,
                None,
                "repo:o/r is:pr is:open",
            ),
            (
                Kind::PullRequest,
                Shown::Merged,
                None,
                "repo:o/r is:pr is:merged",
            ),
            (
                Kind::PullRequest,
                Shown::Closed,
                Some("good first issue"),
                r#"repo:o/r is:pr is:closed is:unmerged label:"good first issue""#,
            ),
            (Kind::PullRequest, Shown::All, None, "repo:o/r is:pr"),
        ] {
            assert_eq!(
                search_qualifiers("o/r", kind, &view(shown, label)),
                expected
            );
        }
    }

    #[test]
    fn a_list_reads_its_view_from_its_query() {
        let query = |pairs: &[(&str, &str)]| -> HashMap<String, String> {
            pairs
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect()
        };
        assert_eq!(
            ListView::of(Kind::Issue, &query(&[])),
            Some(ListView {
                shown: Shown::Open,
                label: None,
                order: Order::Updated,
                page: 1,
            })
        );
        assert_eq!(
            ListView::of(
                Kind::PullRequest,
                &query(&[
                    ("state", "merged"),
                    ("label", "area/api"),
                    ("sort", "oldest"),
                    ("page", "40"),
                    // What it does not know of is no part of it.
                    ("q", "is:pr"),
                ])
            ),
            Some(ListView {
                shown: Shown::Merged,
                label: Some("area/api".to_owned()),
                order: Order::Oldest,
                page: 40,
            })
        );
        assert_eq!(
            ListView::of(Kind::Issue, &query(&[("state", "merged")])),
            None
        );
    }

    #[tokio::test]
    async fn the_open_pull_requests_are_searched_once_for_stats_and_issues() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Stats, "acme", "widget").await.0,
            StatusCode::OK
        );
        assert_eq!(
            ask(&cache, Api::Issues, "acme", "widget").await.0,
            StatusCode::OK
        );
        let open = "https://api.github.com/search/issues?q=repo%3AAcme%2FWidget+is%3Apr+is%3Aopen&per_page=1";
        let asked = stub.urls();
        assert_eq!(
            asked.iter().filter(|url| *url == open).count(),
            1,
            "{asked:?}"
        );
    }

    #[tokio::test]
    async fn features_turned_off_are_said_to_be_and_not_searched() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Issues, "acme", "mirror").await,
            (
                StatusCode::OK,
                json!({
                    "issues": null,
                    "pull_requests": {"open": 2, "merged": 5, "closed": 1},
                    // GitHub lists pull requests with issues, even with issues turned off.
                    "recent": [{
                        "number": 3,
                        "title": "Mirror the widgets",
                        "kind": "pull_request",
                        "state": "open",
                        "author": "erin",
                        "created_at": "2026-10-22T08:00:00Z",
                        "updated_at": null,
                        "url": "https://github.com/acme/mirror/pull/3",
                    }],
                    "stale": null,
                })
            )
        );
        assert_eq!(
            ask(&cache, Api::Issues, "acme", "locked").await,
            (
                StatusCode::OK,
                json!({"issues": null, "pull_requests": null, "recent": [], "stale": null})
            )
        );
        let mut searches: Vec<String> = stub
            .urls()
            .into_iter()
            .filter(|url| url.contains("/search/"))
            .collect();
        searches.sort();
        // Open pull requests are searched for all the same, as the stat cards search them.
        assert_eq!(
            searches,
            [
                "https://api.github.com/search/issues?q=repo%3Aacme%2Flocked+is%3Apr+is%3Aopen&per_page=1",
                "https://api.github.com/search/issues?q=repo%3Aacme%2Fmirror+is%3Apr+is%3Aclosed+is%3Aunmerged&per_page=1",
                "https://api.github.com/search/issues?q=repo%3Aacme%2Fmirror+is%3Apr+is%3Amerged&per_page=1",
                "https://api.github.com/search/issues?q=repo%3Aacme%2Fmirror+is%3Apr+is%3Aopen&per_page=1",
            ]
        );
    }

    #[tokio::test]
    async fn commits_show_their_first_line_author_and_time() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Commits, "acme", "widget").await,
            (
                StatusCode::OK,
                json!({
                    "commits": [
                        // When it landed, by the account of who wrote it.
                        {
                            "sha": "a1b2c3d",
                            "message": "Steady the widgets (#49)",
                            "author": "alice",
                            "author_avatar_url": "https://avatars.githubusercontent.com/u/2?v=4",
                            "committed_at": "2026-10-21T08:00:00Z",
                            "url": "https://github.com/Acme/Widget/commit/a1b2c3d",
                        },
                        // By the name in the commit, without an account on GitHub.
                        {
                            "sha": "b2c3d4e",
                            "message": "Fix a typo",
                            "author": "Bob Example",
                            "author_avatar_url": null,
                            "committed_at": "2026-10-18T08:00:00Z",
                            "url": null,
                        },
                        // Avatars only from https URLs.
                        {
                            "sha": "c3d4e5f",
                            "message": null,
                            "author": null,
                            "author_avatar_url": null,
                            "committed_at": null,
                            "url": null,
                        },
                    ],
                })
            )
        );
        // The default branch's, under the names of the repository it was renamed to.
        assert!(
            stub.urls().contains(
                &"https://api.github.com/repos/Acme/Widget/commits?per_page=10".to_owned()
            ),
            "{:?}",
            stub.urls()
        );
    }

    #[tokio::test]
    async fn releases_are_the_latest_without_drafts() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Releases, "acme", "widget").await,
            (
                StatusCode::OK,
                json!({
                    "releases": [
                        // Its name only repeats its tag.
                        {
                            "tag": "v3.0.0-rc.1",
                            "name": null,
                            "published_at": "2026-10-11T12:00:00Z",
                            "prerelease": true,
                            "target": "next",
                            "url": "https://github.com/Acme/Widget/releases/tag/v3.0.0-rc.1",
                        },
                        {
                            "tag": "v2.1.0",
                            "name": "Widget 2.1",
                            "published_at": "2026-10-01T12:00:00Z",
                            "prerelease": false,
                            "target": "main",
                            "url": "https://github.com/Acme/Widget/releases/tag/v2.1.0",
                        },
                        {
                            "tag": "v2.0.0",
                            "name": null,
                            "published_at": "2026-06-01T12:00:00Z",
                            "prerelease": false,
                            "target": null,
                            "url": null,
                        },
                    ],
                    // As GitHub lists them, the draft and the release without a tag too.
                    // They fit on one page, so they are not counted apart.
                    "count": 5,
                })
            )
        );
        assert!(
            stub.urls().contains(
                &"https://api.github.com/repos/Acme/Widget/releases?per_page=5".to_owned()
            ),
            "{:?}",
            stub.urls()
        );
    }

    /// What [`merge_velocity`] answers without pull requests.
    fn no_merges() -> Value {
        json!({"sampled": 0, "merged": 0, "closed": 0, "median_time_to_merge": null,
               "truncated": false, "stale": null})
    }

    /// What [`issue_age`] answers without open issues.
    fn no_ages() -> Value {
        json!({"sampled": 0, "median_age": null, "truncated": false, "stale": null})
    }

    /// What [`workflow_runs`] answers without workflow runs on `branch`, or when GitHub
    /// refused to list them, if `hidden`.
    fn no_runs(branch: Option<&str>, hidden: bool) -> Value {
        json!({"branch": branch, "sampled": 0, "passed": 0, "failed": 0,
               "average_duration": null, "latest": null, "hidden": hidden, "stale": null})
    }

    #[tokio::test]
    async fn pull_requests_merged_are_timed_and_counted_against_those_closed() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::MergeVelocity, "acme", "widget").await,
            (
                StatusCode::OK,
                json!({
                    // #49, #43, #42 and #41, which was merged at an unknown time after it was
                    // opened. #48 was closed without being merged, and #46 is open.
                    "sampled": 6,
                    "merged": 4,
                    "closed": 1,
                    // Of an hour, two days and four days.
                    "median_time_to_merge": 2 * 24 * 60 * 60,
                    "truncated": false,
                    "stale": null,
                })
            )
        );
        assert!(
            stub.urls().contains(
                &"https://api.github.com/search/issues?q=repo%3AAcme%2FWidget+is%3Apr&sort=updated&order=desc&per_page=100".to_owned()
            ),
            "{:?}",
            stub.urls()
        );
    }

    #[tokio::test]
    async fn open_issues_are_aged_without_pull_requests() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let before = ChronoUtc::now();
        let (status, body) = ask(&cache, Api::IssueAge, "acme", "widget").await;
        let after = ChronoUtc::now();
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            (&body["sampled"], &body["truncated"]),
            (&json!(4), &json!(false))
        );
        // The issues opened in 2026, 2025 and 2024, of which the median is that of 2025.
        let opened: DateTimeUtc = "2025-01-01T00:00:00Z".parse().unwrap();
        let age = body["median_age"].as_i64().unwrap();
        assert!(
            ((before - opened).num_seconds()..=(after - opened).num_seconds()).contains(&age),
            "{age}"
        );
        assert!(
            stub.urls().contains(
                &"https://api.github.com/repos/Acme/Widget/issues?state=open&sort=updated&direction=desc&per_page=100".to_owned()
            ),
            "{:?}",
            stub.urls()
        );
    }

    #[tokio::test]
    async fn what_a_repository_turned_off_is_not_asked_for() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::MergeVelocity, "acme", "locked").await,
            (StatusCode::OK, no_merges())
        );
        for repo in ["locked", "mirror"] {
            assert_eq!(
                ask(&cache, Api::IssueAge, "acme", repo).await,
                (StatusCode::OK, no_ages()),
                "{repo}"
            );
        }
        let asked = stub.urls();
        assert!(
            asked
                .iter()
                .all(|url| !url.contains("is%3Apr") && !url.contains("/issues?state")),
            "{asked:?}"
        );
    }

    #[tokio::test]
    async fn workflow_runs_on_the_default_branch_pass_fail_and_take_time() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::WorkflowRuns, "acme", "widget").await,
            (
                StatusCode::OK,
                json!({
                    "branch": "main",
                    "sampled": 6,
                    "passed": 2,
                    // One failed, one timed out. One was cancelled.
                    "failed": 2,
                    // Of 4, 10, 2 and 5 minutes. The run in progress has not ended, and one
                    // ended before it started.
                    "average_duration": (4 + 10 + 2 + 5) * 60 / 4,
                    "latest": {
                        "name": "CI",
                        "status": "in_progress",
                        "conclusion": null,
                        "started_at": "2026-10-22T10:00:00Z",
                        "url": "https://github.com/Acme/Widget/actions/runs/7",
                    },
                    "hidden": false,
                    "stale": null,
                })
            )
        );
        assert!(
            stub.urls().contains(
                &"https://api.github.com/repos/Acme/Widget/actions/runs?branch=main&event=push&exclude_pull_requests=true&per_page=50".to_owned()
            ),
            "{:?}",
            stub.urls()
        );
    }

    #[tokio::test]
    async fn workflow_runs_github_will_not_list_are_hidden() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::WorkflowRuns, "acme", "guarded").await,
            (StatusCode::OK, no_runs(Some("release/1.x"), true))
        );
        assert!(
            stub.urls().contains(
                &"https://api.github.com/repos/acme/guarded/actions/runs?branch=release%2F1.x&event=push&exclude_pull_requests=true&per_page=50".to_owned()
            ),
            "{:?}",
            stub.urls()
        );
        // Without a default branch, there is nothing to ask for.
        assert_eq!(
            ask(&cache, Api::WorkflowRuns, "acme", "huge").await,
            (StatusCode::OK, no_runs(None, false))
        );
        assert!(
            stub.urls()
                .iter()
                .all(|url| !url.contains("/acme/huge/actions")),
            "{:?}",
            stub.urls()
        );
    }

    #[tokio::test]
    async fn code_frequency_is_of_the_last_52_weeks() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let current = week_of(ChronoUtc::now());
        let (status, body) = ask(&cache, Api::CodeFrequency, "acme", "widget").await;
        assert_eq!(
            (status, &body["too_large"]),
            (StatusCode::OK, &json!(false))
        );
        let weeks = body["weeks"].as_array().unwrap();
        let expected: Vec<Value> = (0..52)
            .rev()
            .map(|ago: i64| {
                let start = (current - TimeDelta::weeks(ago)).date_naive().to_string();
                // GitHub left out the current week and the one 3 weeks ago.
                let lines = if ago == 0 || ago == 3 { 0 } else { ago };
                json!({"week": start, "additions": 10 * lines, "deletions": lines})
            })
            .collect();
        assert_eq!(weeks, &expected);
    }

    #[tokio::test]
    async fn code_frequency_github_will_not_compute_is_too_large() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::CodeFrequency, "acme", "huge").await,
            (
                StatusCode::OK,
                json!({"weeks": [], "too_large": true, "stale": null})
            )
        );
    }

    #[test]
    fn code_frequency_is_read_as_github_gives_it() {
        // A Wednesday, in the week that starts on Sunday 2026-11-01.
        let now: DateTimeUtc = "2026-11-04T15:00:00Z".parse().unwrap();
        let current = 1_793_491_200; // 2026-11-01
        let week = 7 * 24 * 60 * 60;
        let given = json!([
            [current - 60 * week, 1, -1],
            [current - 51 * week, 100, -20],
            [current - week, 5, 0],
            [current, 0, -7],
        ]);
        let weeks = changes(&given, now).unwrap();
        assert_eq!(weeks.len(), 52);
        assert_eq!(
            weeks[0],
            json!({"week": "2025-11-09", "additions": 100, "deletions": 20})
        );
        assert_eq!(
            weeks[1],
            json!({"week": "2025-11-16", "additions": 0, "deletions": 0})
        );
        assert_eq!(
            weeks[50..],
            [
                json!({"week": "2026-10-25", "additions": 5, "deletions": 0}),
                json!({"week": "2026-11-01", "additions": 0, "deletions": 7}),
            ]
        );
        for empty in [json!(null), json!({}), json!([])] {
            assert_eq!(changes(&empty, now), Some(Vec::new()), "{empty}");
        }
        for odd in [
            json!({"weeks": []}),
            json!([[current, 1]]),
            json!([[current, 1, "-1"]]),
            json!([["2026-11-01", 1, -1]]),
            json!([{"week": current}]),
        ] {
            assert_eq!(changes(&odd, now), None, "{odd}");
        }
    }

    #[tokio::test]
    async fn releases_are_counted_spaced_and_downloaded_without_drafts() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::ReleaseCadence, "acme", "widget").await,
            (
                StatusCode::OK,
                json!({
                    // v3.0.0-rc.1, v2.1.0 and v2.0.0, without the draft or the one without a tag.
                    "sampled": 3,
                    "stable": 2,
                    "prereleases": 1,
                    // From 2026-06-01, when v2.0.0 was created, to 2026-10-11, 132 days, in two
                    // intervals.
                    "average_interval": 132 * 24 * 60 * 60 / 2,
                    // One of them counts no downloads.
                    "assets": 4,
                    "downloads": 5 + 7 + 100,
                    "truncated": false,
                    "stale": null,
                })
            )
        );
        assert!(
            stub.urls().contains(
                &"https://api.github.com/repos/Acme/Widget/releases?per_page=100".to_owned()
            ),
            "{:?}",
            stub.urls()
        );
        // Releases past the 100 latest are not read.
        assert_eq!(
            ask(&cache, Api::ReleaseCadence, "acme", "crowded").await,
            (
                StatusCode::OK,
                json!({"sampled": 100, "stable": 100, "prereleases": 0,
                       "average_interval": null, "assets": 0, "downloads": 0,
                       "truncated": true, "stale": null})
            )
        );
    }

    #[test]
    fn medians_and_means_are_of_what_there_is() {
        assert_eq!(median(vec![]), None);
        assert_eq!(median(vec![7]), Some(7));
        assert_eq!(median(vec![9, 1, 5]), Some(5));
        assert_eq!(median(vec![10, 1, 4, 100]), Some(7));
        assert_eq!(median(vec![1, 2]), Some(1));
        assert_eq!(median(vec![i64::MAX, i64::MAX - 2]), Some(i64::MAX - 1));
        assert_eq!(mean(&[]), None);
        assert_eq!(mean(&[1, 2]), Some(1));
        assert_eq!(mean(&[60, 120, 300]), Some(160));
    }

    #[test]
    fn open_issues_are_aged_at_the_time_given() {
        let now: DateTimeUtc = "2026-11-01T00:00:00Z".parse().unwrap();
        let items = List {
            items: vec![
                json!({"created_at": "2026-10-31T00:00:00Z"}),
                json!({"created_at": "2026-10-29T00:00:00Z"}),
                // Opened after now, as a clock out of step would tell.
                json!({"created_at": "2026-11-02T00:00:00Z"}),
                json!({"created_at": "2026-01-01T00:00:00Z", "pull_request": {}}),
                json!("odd"),
            ],
            truncated: true,
        };
        assert_eq!(
            ages(&items, now),
            json!({"sampled": 3, "median_age": 2 * 24 * 60 * 60, "truncated": true})
        );
    }

    #[tokio::test]
    async fn an_empty_repository_has_nothing_to_show() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::CommitActivity, "acme", "bare").await,
            (StatusCode::OK, json!({"weeks": [], "stale": null}))
        );
        assert_eq!(
            ask(&cache, Api::Languages, "acme", "bare").await,
            (
                StatusCode::OK,
                json!({"languages": [], "other": 0, "stale": null})
            )
        );
        assert_eq!(
            ask(&cache, Api::Contributors, "acme", "bare").await,
            (
                StatusCode::OK,
                json!({"contributors": [], "count": 0, "too_large": false, "stale": null})
            )
        );
        assert_eq!(
            ask(&cache, Api::Issues, "acme", "bare").await,
            (
                StatusCode::OK,
                json!({
                    "issues": {"open": 0, "closed": 0},
                    "pull_requests": {"open": 0, "merged": 0, "closed": 0},
                    "recent": [],
                    "stale": null,
                })
            )
        );
        assert_eq!(
            ask(&cache, Api::Commits, "acme", "bare").await,
            (StatusCode::OK, json!({"commits": []}))
        );
        assert_eq!(
            ask(&cache, Api::Releases, "acme", "bare").await,
            (StatusCode::OK, json!({"releases": [], "count": 0}))
        );
        assert_eq!(
            ask(&cache, Api::MergeVelocity, "acme", "bare").await,
            (StatusCode::OK, no_merges())
        );
        assert_eq!(
            ask(&cache, Api::IssueAge, "acme", "bare").await,
            (StatusCode::OK, no_ages())
        );
        assert_eq!(
            ask(&cache, Api::WorkflowRuns, "acme", "bare").await,
            (StatusCode::OK, no_runs(Some("main"), false))
        );
        assert_eq!(
            ask(&cache, Api::CodeFrequency, "acme", "bare").await,
            (
                StatusCode::OK,
                json!({"weeks": [], "too_large": false, "stale": null})
            )
        );
        assert_eq!(
            ask(&cache, Api::ReleaseCadence, "acme", "bare").await,
            (
                StatusCode::OK,
                json!({"sampled": 0, "stable": 0, "prereleases": 0, "average_interval": null,
                       "assets": 0, "downloads": 0, "truncated": false, "stale": null})
            )
        );
    }

    #[tokio::test]
    async fn what_github_cannot_tell_is_not_an_answer() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        for api in Api::ALL {
            assert_eq!(
                ask(&cache, api, "acme", "nothing").await,
                (StatusCode::NOT_FOUND, Value::Null),
                "{api:?}"
            );
            for repo in ["broken", "nameless"] {
                assert_eq!(
                    ask(&cache, api, "acme", repo).await.0,
                    StatusCode::BAD_GATEWAY,
                    "{api:?} {repo}"
                );
            }
        }
        for api in [Api::Stats, Api::Issues] {
            assert_eq!(
                ask(&cache, api, "acme", "unsearchable").await.0,
                StatusCode::BAD_GATEWAY,
                "{api:?}"
            );
        }
        // `acme/odd` has no default branch, so its workflow runs are not asked for.
        for api in [
            Api::CommitActivity,
            Api::Languages,
            Api::Contributors,
            Api::Issues,
            Api::Commits,
            Api::Releases,
            Api::MergeVelocity,
            Api::IssueAge,
            Api::CodeFrequency,
            Api::ReleaseCadence,
        ] {
            assert_eq!(
                ask(&cache, api, "acme", "odd").await.0,
                StatusCode::BAD_GATEWAY,
                "{api:?}"
            );
        }
    }

    #[tokio::test]
    async fn names_that_cannot_be_repositories_are_not_asked_for() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let longest = "a".repeat(101);
        for api in Api::ALL {
            for (owner, repo) in [
                ("-acme", "widget"),
                ("acme.com", "widget"),
                ("acme", ""),
                ("acme", "."),
                ("acme", ".."),
                ("acme", "wid get"),
                ("acme", "widgét"),
                ("acme", "widget/x"),
                ("acme", &longest),
            ] {
                assert_eq!(
                    ask(&cache, api, owner, repo).await.0,
                    StatusCode::BAD_REQUEST,
                    "{api:?} {owner}/{repo}"
                );
            }
        }
        assert_eq!(stub.urls(), Vec::<String>::new());
    }

    #[tokio::test]
    async fn dotted_and_longest_names_are_asked_for() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let longest = "a".repeat(100);
        let names = [".github", "next.js", "a_b-c", "...", &longest];
        for repo in names {
            assert_eq!(
                ask(&cache, Api::Summary, "acme", repo).await.0,
                StatusCode::NOT_FOUND,
                "{repo}"
            );
        }
        let asked: Vec<String> = names
            .iter()
            .map(|repo| format!("https://api.github.com/repos/acme/{repo}"))
            .collect();
        assert_eq!(stub.urls(), asked);
    }

    #[tokio::test]
    async fn visitors_held_back_are_told_so() {
        let stub = github();
        let cache = cache(&stub, 0).await;
        for api in Api::ALL {
            assert_eq!(
                ask(&cache, api, "acme", "widget").await.0,
                StatusCode::TOO_MANY_REQUESTS,
                "{api:?}"
            );
        }
        assert_eq!(stub.urls(), Vec::<String>::new());
    }

    #[tokio::test]
    async fn access_github_keeps_from_the_viewers_credential_is_explained() {
        let stub = Stub::new(|request| match request.uri().path() {
            "/repos/acme/sso" => answer(
                403,
                &[(
                    "x-github-sso",
                    "required; url=https://github.com/orgs/acme/sso?authorization_request=abc",
                )],
                "",
            ),
            "/repos/acme/elsewhere" => answer(
                403,
                &[("x-github-sso", "required; url=https://evil.example/sso")],
                "",
            ),
            "/repos/acme/policy" => answer(
                403,
                &[],
                r#"{"message": "The 'acme' organization forbids access via a fine-grained personal access tokens if the token's lifetime is greater than 366 days."}"#,
            ),
            "/repos/acme/secret" => {
                answer(200, &[], r#"{"full_name": "acme/secret", "private": true}"#)
            }
            _ => answer(404, &[], r#"{"message": "Not Found"}"#),
        });
        let cache = cache(&stub, 30).await;
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let signed_in = Viewer::SignedIn {
            user_id: 1,
            sign_in: Secret::new("sign-in".to_owned()),
        };
        let token_user = Viewer::TokenUser {
            user_id: 1,
            github_id: 1,
            credential_id: 1,
            pat: Secret::new("pat".to_owned()),
            sign_in: Secret::new("sign-in".to_owned()),
        };
        let ask = async |viewer: &Viewer, repo: &str| {
            let names = Path(("acme".to_owned(), repo.to_owned()));
            let response = summary(State(cache.clone()), viewer.clone(), names).await;
            let status = response.status();
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
        };

        // Single sign-on, with where to authorize the credential, if that is on GitHub.
        for viewer in [&visitor, &token_user] {
            assert_eq!(
                ask(viewer, "sso").await,
                (
                    StatusCode::FORBIDDEN,
                    json!({
                        "denied": "sso",
                        "url": "https://github.com/orgs/acme/sso?authorization_request=abc"
                    })
                )
            );
        }
        assert_eq!(
            ask(&token_user, "elsewhere").await,
            (
                StatusCode::FORBIDDEN,
                json!({ "denied": "sso", "url": null })
            )
        );

        // A PAT that the organization does not let in.
        assert_eq!(
            ask(&token_user, "policy").await,
            (StatusCode::FORBIDDEN, json!({ "denied": "token" }))
        );
        // Without one, there is no token to explain.
        assert_eq!(
            ask(&signed_in, "policy").await,
            (StatusCode::BAD_GATEWAY, Value::Null)
        );
        // Nor is there anything to explain about what is not found, or private, whoever
        // asks: 404, and nothing about it (FR-ACC-05, AC-02).
        for viewer in [&visitor, &signed_in, &token_user] {
            assert_eq!(
                ask(viewer, "missing").await,
                (StatusCode::NOT_FOUND, Value::Null),
                "{viewer:?}"
            );
        }
        // What GitHub marks private is a token user's alone to see, even if GitHub gave it
        // to another credential (FR-ACC-04).
        for viewer in [&visitor, &signed_in] {
            assert_eq!(
                ask(viewer, "secret").await,
                (StatusCode::NOT_FOUND, Value::Null),
                "{viewer:?}"
            );
        }
        let (status, body) = ask(&token_user, "secret").await;
        assert_eq!(
            (status, &body["visibility"]),
            (StatusCode::OK, &json!("private"))
        );
    }

    #[tokio::test]
    async fn only_signed_in_users_may_refresh_a_dashboard_once_a_minute() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let signed_in = Viewer::SignedIn {
            user_id: 1,
            sign_in: Secret::new("sign-in".to_owned()),
        };
        let ask = async |viewer: &Viewer, owner: &str, repo: &str| {
            let names = Path((owner.to_owned(), repo.to_owned()));
            let response = refresh(State(cache.clone()), viewer.clone(), names).await;
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
            let status = response.status();
            let retry_after = response
                .headers()
                .get(header::RETRY_AFTER)
                .map(|value| value.to_str().unwrap().parse::<u64>().unwrap());
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let body = serde_json::from_slice(&body).unwrap_or(Value::Null);
            (status, retry_after, body)
        };

        assert_eq!(
            ask(&visitor, "acme", "widget").await,
            (StatusCode::UNAUTHORIZED, None, Value::Null)
        );
        assert_eq!(
            ask(&signed_in, "acme", "..").await,
            (StatusCode::BAD_REQUEST, None, Value::Null)
        );
        // To the millisecond, as `until` is told.
        let before = ChronoUtc::now() - TimeDelta::milliseconds(1);
        assert_eq!(
            ask(&signed_in, "acme", "widget").await,
            (StatusCode::NO_CONTENT, None, Value::Null)
        );
        // Once a minute, whatever case the names are in.
        let (status, retry_after, body) = ask(&signed_in, "Acme", "Widget").await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        let until: DateTimeUtc = body["until"].as_str().unwrap().parse().unwrap();
        assert!(
            before + TimeDelta::minutes(1) <= until
                && until <= ChronoUtc::now() + TimeDelta::minutes(1),
            "{until}"
        );
        assert!((59..=60).contains(&retry_after.unwrap()), "{retry_after:?}");
        // Refreshing asks GitHub nothing itself.
        assert_eq!(stub.urls(), Vec::<String>::new());
    }
}
