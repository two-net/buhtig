//! What an organization's dashboard shows of the organization as a whole: its header
//! (FR-ORG-01), with its name as GitHub spells it (FR-NAV-04), its stat cards (FR-ORG-02),
//! its repository table (FR-ORG-03), its languages (FR-ORG-04), its top repositories
//! (FR-ORG-05), its activity (FR-ORG-06) and its members (FR-ORG-07). The figures, the table
//! and the charts are over the repositories that the viewer may see, private and internal
//! ones too for a token user (FR-ORG-09), and at most `limits.org_repositories` of them, those
//! pushed to most recently (FR-ORG-08). The members are those that the viewer may see: those
//! who show their membership publicly, and others too for a token user (FR-ACC-04).

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
use sea_orm::sea_query::prelude::chrono::{Datelike, TimeDelta};
use serde_json::{Value, json};
use url::Url;

use crate::accounts::is_account_name;
use crate::cache::{self, Cache, Cached, Outcome, Viewer};
use crate::github::{self, List};
use crate::repositories::{
    data, denied, is_repository_name, link, page, respond, status, text, visibility,
};

/// FR-ORG-04: the languages the chart names. The rest are "Other".
const LANGUAGES: usize = 8;

/// FR-ORG-05: the repositories the top-repositories chart shows.
const TOP_REPOSITORIES: usize = 10;

/// FR-ORG-06: the days within which a repository was last pushed to for each period of the
/// last-push chart but the last, which is of those pushed to longer ago.
const PERIODS: [i64; 3] = [7, 30, 365];

/// FR-ORG-07: the members whose avatars the members widget shows.
const MEMBERS: usize = 24;

/// What is kept of each of an organization's repositories: what its dashboard shows of them
/// (FR-ORG-02 to FR-ORG-06), so that a large organization's list is small to cache and to
/// read. `private` and `visibility` tell which are private or internal (FR-ORG-09).
const REPOSITORY_FIELDS: [&str; 13] = [
    "name",
    "full_name",
    "description",
    "language",
    "stargazers_count",
    "forks_count",
    "open_issues_count",
    "pushed_at",
    "created_at",
    "fork",
    "archived",
    "private",
    "visibility",
];

/// `/-/api/organizations/{org}`: what the dashboard's header shows (FR-ORG-01),
///
/// ```json
/// {"name": "org", "fetched_at": …, "avatar_url": …, "display_name": …, "description": …,
///  "location": …, "website": …, "created_at": …, "verified": false}
/// ```
///
/// The name is the organization's login as GitHub spells it, whatever case it was asked for
/// in (FR-NAV-04), and `display_name` the name it goes by, if it gives one. `fetched_at` is
/// when GitHub gave what BuhTig knows of it, which the dashboard shows (FR-DATA-06).
/// `website` is the one it gives, with `https://` before it if it names no scheme, as
/// organizations often write it. `verified` is whether GitHub has verified it. What GitHub
/// does not say, or says in a form BuhTig does not show, is `null`: links are only to `http`
/// and `https` URLs, and avatars only from `https` ones (NFR-SEC-03). 404 if there is no such
/// organization, as for a user's account (FR-SRCH-06), or if it is private (FR-ACC-05). 403
/// when GitHub keeps it from the viewer's credential, with why, as [`denied`] tells it
/// (FR-PAT-08).
///
/// Names that cannot be an account's are 400, without asking GitHub (FR-SRCH-04). Any other
/// status means that BuhTig cannot tell now. The dashboard then keeps its URL.
pub async fn summary(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(org): Path<String>,
) -> Response {
    // A token user reads with their PAT (FR-PAT-06). The organization is read for its
    // dashboard, so a visitor's load of that counts once (FR-DATA-10).
    if !is_account_name(&org) {
        return status(StatusCode::BAD_REQUEST);
    }
    let result = read(&cache, &viewer, &org).await;
    if let Some(denied) = denied(&viewer, &result) {
        return denied;
    }
    let cached = match data(result) {
        Ok(cached) => cached,
        Err(code) => return status(code),
    };
    let data = &cached.data;
    let Some(login) = login(data) else {
        return status(StatusCode::BAD_GATEWAY);
    };
    respond(json!({
        "name": login,
        "fetched_at": cached.fetched_at_iso(),
        "avatar_url": link(data.get("avatar_url"), &["https"]),
        "display_name": text(data, "name"),
        "description": text(data, "description"),
        "location": text(data, "location"),
        "website": website(data.get("blog")),
        "created_at": text(data, "created_at"),
        "verified": data.get("is_verified").and_then(Value::as_bool).unwrap_or(false),
    }))
}

/// `/-/api/organizations/{org}/stats`: what the dashboard's stat cards show (FR-ORG-02),
///
/// ```json
/// {"repositories": …, "private": …, "internal": …, "stars": …, "forks": …,
///  "open_issues_and_pull_requests": …, "top_language": "Rust" | null, "truncated": false}
/// ```
///
/// The figures are over the organization's repositories that the viewer may see, of which
/// `private` and `internal` are so (FR-ORG-09). Open issues and pull requests are one
/// figure, as GitHub counts them. `top_language` is the primary language of the most
/// repositories, `null` if none has one. An organization with more than
/// `limits.org_repositories` repositories is figured over that many, those pushed to most
/// recently, and `truncated` then says so (FR-ORG-08).
///
/// Its statuses are those of [`summary`], since it reads the organization first. A failure
/// to read its repositories is 502.
pub async fn stats(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(org): Path<String>,
) -> Response {
    match listed(&cache, viewer, &org).await {
        Ok(list) => respond(figures(&list)),
        Err(code) => status(code),
    }
}

/// `/-/api/organizations/{org}/repositories`: what the dashboard's repository table lists
/// (FR-ORG-03),
///
/// ```json
/// {"repositories": [{"name": "widget", "description": …, "language": "Rust" | null,
///   "stars": …, "forks": …, "open_issues_and_pull_requests": …, "pushed_at": …,
///   "fork": false, "archived": false, "visibility": "public"}]}
/// ```
///
/// The repositories are those that [`stats`] figures over, in the order GitHub gives them,
/// pushed to most recently first. The dashboard sorts, filters and pages them itself. Each
/// `name` is the repository's alone, without the organization's, and `visibility` is
/// `public`, `private` or `internal` (FR-ORG-09). What GitHub does not say is `null`, or 0
/// for a figure, and an item without a repository's name is left out.
///
/// Its statuses are those of [`stats`].
pub async fn repositories(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(org): Path<String>,
) -> Response {
    match listed(&cache, viewer, &org).await {
        Ok(list) => {
            let rows: Vec<Value> = list.items.iter().filter_map(row).collect();
            respond(json!({ "repositories": rows }))
        }
        Err(code) => status(code),
    }
}

/// `/-/api/organizations/{org}/languages`: how many of the organization's repositories have
/// each primary language (FR-ORG-04): the 8 languages of the most, most first, and the
/// repositories of the rest together,
///
/// ```json
/// {"languages": [{"name": "Rust", "repositories": 12}, …], "other": 5}
/// ```
///
/// The repositories are those that [`stats`] figures over, but for those without a primary
/// language. Of languages with as many repositories, the first by name comes first. `other`
/// is apart from the languages named, so that none is taken for a language that GitHub
/// calls "Other".
///
/// Its statuses are those of [`stats`].
pub async fn languages(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(org): Path<String>,
) -> Response {
    match listed(&cache, viewer, &org).await {
        Ok(list) => respond(language_chart(&list)),
        Err(code) => status(code),
    }
}

/// `/-/api/organizations/{org}/top-repositories`: the 10 of the organization's repositories
/// with the most stars (FR-ORG-05), most first,
///
/// ```json
/// {"repositories": [{"name": "widget", "stars": 1200}, …]}
/// ```
///
/// The repositories are those that [`stats`] figures over, but for those without stars, and
/// of those with as many stars, the first by name comes first. Each `name` is the
/// repository's alone, as in [`repositories`], and an item without a repository's name is
/// left out.
///
/// Its statuses are those of [`stats`].
pub async fn top_repositories(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(org): Path<String>,
) -> Response {
    match listed(&cache, viewer, &org).await {
        Ok(list) => respond(top(&list)),
        Err(code) => status(code),
    }
}

/// `/-/api/organizations/{org}/last-push`: how many of the organization's repositories were
/// last pushed to in each period before now (FR-ORG-06),
///
/// ```json
/// {"last_7_days": 3, "last_30_days": 5, "last_12_months": 20, "older": 12}
/// ```
///
/// Each repository counts in one period alone: `last_30_days` are those pushed to within 30
/// days but not within 7, `last_12_months` those pushed to within 365 days but not within 30,
/// and `older` the rest. The repositories are those that [`stats`] figures over, but for any
/// whose last push GitHub does not tell.
///
/// Its statuses are those of [`stats`].
pub async fn last_push(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(org): Path<String>,
) -> Response {
    match listed(&cache, viewer, &org).await {
        Ok(list) => respond(pushes(&list, ChronoUtc::now())),
        Err(code) => status(code),
    }
}

/// `/-/api/organizations/{org}/created-per-year`: how many of the organization's repositories
/// were created in each year, in UTC (FR-ORG-06), from the year of the first to this one,
/// oldest first,
///
/// ```json
/// {"years": [{"year": 2015, "repositories": 3}, …]}
/// ```
///
/// A year in which none was created is there too, with 0. The repositories are those that
/// [`stats`] figures over, but for any whose creation GitHub does not tell. Without such
/// repositories, there are no years.
///
/// Its statuses are those of [`stats`].
pub async fn created_per_year(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(org): Path<String>,
) -> Response {
    match listed(&cache, viewer, &org).await {
        Ok(list) => respond(years(&list, ChronoUtc::now())),
        Err(code) => status(code),
    }
}

/// `/-/api/organizations/{org}/members`: how many of the organization's members the viewer
/// may see, and the first 24 of them, in the order GitHub gives them (FR-ORG-07),
///
/// ```json
/// {"count": 30, "members": [{"login": "alice", "avatar_url": …, "url": …}, …]}
/// ```
///
/// Which members the viewer may see is told in [`members_path`]. `url` is the member's page
/// on GitHub. What BuhTig does not show or link to is `null` (NFR-SEC-03), and an item
/// without a login is left out, though it counts, as GitHub counts it. GitHub tells no
/// count, so it is asked for apart when there are more than 24.
///
/// Its statuses are those of [`summary`], since it reads the organization first. A failure
/// to read its members, or to count them, is 502.
pub async fn members(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(org): Path<String>,
) -> Response {
    match member_list(&cache, &viewer, &org).await {
        Ok(body) => respond(body),
        Err(code) => status(code),
    }
}

/// What [`members`] answers for the organization `org`, or the status that says why it
/// cannot.
async fn member_list(cache: &Cache, viewer: &Viewer, org: &str) -> Result<Value, StatusCode> {
    let organization = organization(cache, viewer, org).await?.data;
    let login = login(&organization).ok_or(StatusCode::BAD_GATEWAY)?;
    // By the name GitHub gave, as in `listed`.
    let path = members_path(viewer, login);
    let dashboard = format!("/{org}");
    let list = data(cache.get_list(viewer, &dashboard, &path, MEMBERS).await)?.data;
    let listed = u64::try_from(list.items.len()).unwrap_or(u64::MAX);
    let count = if list.truncated {
        // The count is cached apart from the list, so it may be older. It is never fewer
        // than the list shows.
        data(cache.get_count(viewer, &dashboard, &path).await)?
            .data
            .max(listed)
    } else {
        listed
    };
    let members: Vec<Value> = list.items.iter().filter_map(member).collect();
    Ok(json!({ "count": count, "members": members }))
}

/// The list of the organization's members that the viewer may see. Members may keep their
/// membership private, and GitHub lists them too for another member's credential. So a
/// viewer served from the shared cache, which holds only public information (FR-DATA-04),
/// reads only the members who show their membership publicly. A token user reads all that
/// their PAT may see (FR-ACC-04).
fn members_path(viewer: &Viewer, login: &str) -> github::Path {
    let list = match viewer {
        Viewer::TokenUser { .. } => "members",
        Viewer::Visitor(_) | Viewer::SignedIn { .. } => "public_members",
    };
    github::Path::new(["orgs", login, list]).expect("an account name is neither empty nor dots")
}

/// The repositories of the organization `org` that the viewer may see, as many as BuhTig
/// reads, those pushed to most recently first, or the status that says why there are none:
/// those of [`summary`], since it reads the organization first, or 502 if the repositories
/// cannot be read.
async fn listed(cache: &Cache, viewer: Viewer, org: &str) -> Result<List, StatusCode> {
    let organization = organization(cache, &viewer, org).await?.data;
    let login = login(&organization).ok_or(StatusCode::BAD_GATEWAY)?;
    // By the name GitHub gave, so that the list is cached once whatever case the dashboard
    // was opened in. GitHub lists them all, private and internal ones too, that the
    // credential may see.
    let path = github::Path::new(["orgs", login, "repos"])
        .expect("an account name is neither empty nor dots")
        .query("sort", "pushed");
    let list = cache
        .get_list_of(
            &viewer,
            &format!("/{org}"),
            &path,
            cache.org_repositories(),
            &REPOSITORY_FIELDS,
        )
        .await;
    data(list).map(|list| list.data)
}

/// The organization `org`, as the cache has it for the viewer, or the status that says why
/// it has none.
async fn organization(
    cache: &Cache,
    viewer: &Viewer,
    org: &str,
) -> Result<Cached<Value>, StatusCode> {
    if !is_account_name(org) {
        return Err(StatusCode::BAD_REQUEST);
    }
    data(read(cache, viewer, org).await)
}

/// What the cache has of the organization `org` for the viewer. `org` must be an account
/// name.
async fn read(cache: &Cache, viewer: &Viewer, org: &str) -> Result<Outcome<Value>, cache::Error> {
    let path = github::Path::new(["orgs", org]).expect("an account name is neither empty nor dots");
    cache.get(viewer, &format!("/{org}"), &path).await
}

/// The organization's login, as GitHub spells it, if it can be an account's.
fn login(organization: &Value) -> Option<&str> {
    organization
        .get("login")
        .and_then(Value::as_str)
        .filter(|login| is_account_name(login))
}

/// The stat cards' figures, from the organization's repositories.
fn figures(list: &List) -> Value {
    let repositories: Vec<&Value> = list.items.iter().filter(|item| item.is_object()).collect();
    let sum = |key| {
        repositories.iter().fold(0u64, |sum, repository| {
            sum.saturating_add(repository.get(key).and_then(Value::as_u64).unwrap_or(0))
        })
    };
    let count = |kind| {
        repositories
            .iter()
            .filter(|repository| visibility(repository) == kind)
            .count()
    };
    json!({
        "repositories": repositories.len(),
        "private": count("private"),
        "internal": count("internal"),
        "stars": sum("stargazers_count"),
        "forks": sum("forks_count"),
        "open_issues_and_pull_requests": sum("open_issues_count"),
        "top_language": top_language(&repositories),
        "truncated": list.truncated,
    })
}

/// The primary language of the most repositories, and of those the first by name. `None`
/// if no repository has one.
fn top_language<'a>(repositories: &[&'a Value]) -> Option<&'a str> {
    language_counts(repositories.iter().copied())
        .first()
        .map(|(name, _)| *name)
}

/// How many repositories have each primary language, the language of the most first, and of
/// those with as many the first by name.
fn language_counts<'a>(repositories: impl IntoIterator<Item = &'a Value>) -> Vec<(&'a str, usize)> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for repository in repositories {
        if let Some(language) = text(repository, "language") {
            *counts.entry(language).or_default() += 1;
        }
    }
    let mut counts: Vec<(&str, usize)> = counts.into_iter().collect();
    counts.sort_by(|(name, count), (other_name, other_count)| {
        other_count.cmp(count).then(name.cmp(other_name))
    });
    counts
}

/// The languages chart's figures, from the organization's repositories: the 8 languages of
/// the most repositories, and how many repositories the rest have together.
fn language_chart(list: &List) -> Value {
    let mut counts = language_counts(&list.items);
    let other: usize = counts.iter().skip(LANGUAGES).map(|(_, count)| count).sum();
    counts.truncate(LANGUAGES);
    let languages: Vec<Value> = counts
        .into_iter()
        .map(|(name, repositories)| json!({ "name": name, "repositories": repositories }))
        .collect();
    json!({ "languages": languages, "other": other })
}

/// The repositories that the top-repositories chart shows, with their stars.
fn top(list: &List) -> Value {
    let mut starred: Vec<(&str, u64)> = list
        .items
        .iter()
        .filter_map(|repository| {
            let stars = repository.get("stargazers_count")?.as_u64()?;
            Some((repository_name(repository)?, stars))
        })
        .filter(|(_, stars)| *stars > 0)
        .collect();
    starred.sort_by(|(name, stars), (other_name, other_stars)| {
        other_stars.cmp(stars).then(name.cmp(other_name))
    });
    starred.truncate(TOP_REPOSITORIES);
    let repositories: Vec<Value> = starred
        .into_iter()
        .map(|(name, stars)| json!({ "name": name, "stars": stars }))
        .collect();
    json!({ "repositories": repositories })
}

/// How many repositories were last pushed to in each period before `now`. One pushed to
/// after `now`, as by a clock ahead of BuhTig's, was pushed to within the first.
fn pushes(list: &List, now: DateTimeUtc) -> Value {
    let mut periods = [0u64; PERIODS.len() + 1];
    for pushed in list.items.iter().filter_map(|item| time(item, "pushed_at")) {
        let age = now - pushed;
        let period = PERIODS
            .iter()
            .position(|days| age < TimeDelta::days(*days))
            .unwrap_or(PERIODS.len());
        periods[period] += 1;
    }
    json!({
        "last_7_days": periods[0],
        "last_30_days": periods[1],
        "last_12_months": periods[2],
        "older": periods[3],
    })
}

/// How many repositories were created in each year, from the year of the first to that of
/// `now`, or to that of the last if it is later, as by a clock ahead of BuhTig's.
fn years(list: &List, now: DateTimeUtc) -> Value {
    let mut counts: BTreeMap<i32, u64> = BTreeMap::new();
    for created in list
        .items
        .iter()
        .filter_map(|item| time(item, "created_at"))
    {
        *counts.entry(created.year()).or_default() += 1;
    }
    let years: Vec<Value> = match (counts.first_key_value(), counts.last_key_value()) {
        (Some((&first, _)), Some((&last, _))) => (first..=last.max(now.year()))
            .map(|year| {
                let repositories = counts.get(&year).copied().unwrap_or(0);
                json!({ "year": year, "repositories": repositories })
            })
            .collect(),
        _ => Vec::new(),
    };
    json!({ "years": years })
}

/// The time of `data`'s member `key`, if it tells one.
fn time(data: &Value, key: &str) -> Option<DateTimeUtc> {
    text(data, key)?.parse().ok()
}

/// The repository's name, without the organization's, if it can be a repository's.
fn repository_name(repository: &Value) -> Option<&str> {
    text(repository, "name").filter(|name| is_repository_name(name))
}

/// A repository as the repository table lists it, unless it has no repository's name.
fn row(repository: &Value) -> Option<Value> {
    let name = repository_name(repository)?;
    let figure = |key| repository.get(key).and_then(Value::as_u64).unwrap_or(0);
    let flag = |key| repository.get(key) == Some(&Value::Bool(true));
    Some(json!({
        "name": name,
        "description": text(repository, "description"),
        "language": text(repository, "language"),
        "stars": figure("stargazers_count"),
        "forks": figure("forks_count"),
        "open_issues_and_pull_requests": figure("open_issues_count"),
        "pushed_at": text(repository, "pushed_at"),
        "fork": flag("fork"),
        "archived": flag("archived"),
        "visibility": visibility(repository),
    }))
}

/// A member as the members widget shows them, unless GitHub left out their login.
fn member(member: &Value) -> Option<Value> {
    Some(json!({
        "login": text(member, "login")?,
        "avatar_url": link(member.get("avatar_url"), &["https"]),
        "url": page(member.get("html_url")),
    }))
}

/// The website that GitHub gives, as a URL to link to: as it is, if it is an `http` or
/// `https` one, or with `https://` before it, if it names no scheme, as `acme.example` does
/// (NFR-SEC-03).
fn website(value: Option<&Value>) -> Option<String> {
    let blog = value?.as_str()?.trim();
    match Url::parse(blog) {
        Err(url::ParseError::RelativeUrlWithoutBase) if !blog.is_empty() => {
            Url::parse(&format!("https://{blog}")).ok().map(Into::into)
        }
        _ => link(value, &["http", "https"]),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::time::Duration;

    use axum::http::{HeaderMap, header};
    use sea_orm::entity::prelude::DateTimeUtc;
    use sea_orm::sea_query::prelude::chrono::SecondsFormat;
    use url::form_urlencoded;

    use super::*;
    use crate::config::{CacheConfig, DatabaseConfig, LimitsConfig, Secret};
    use crate::db;
    use crate::github::stub::{Stub, answer, client};
    use crate::test_cluster::cluster;
    use crate::visitors::Visitor;

    /// `Acme` as GitHub gives it, with all that its header shows.
    const ACME: &str = r#"{
        "login": "Acme",
        "type": "Organization",
        "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4",
        "name": "Acme Corporation",
        "description": "Widgets for everyone",
        "location": "Springfield",
        "blog": "https://acme.example/blog",
        "created_at": "2010-04-01T10:00:00Z",
        "is_verified": true,
        "public_repos": 5
    }"#;

    /// An organization with as little as GitHub gives.
    const BARE: &str = r#"{
        "login": "bare",
        "type": "Organization",
        "name": null,
        "description": null,
        "location": null,
        "blog": "",
        "created_at": "2026-10-20T08:00:00Z",
        "is_verified": false
    }"#;

    /// An organization that says odd things, which the header must not show as they are.
    const ODD: &str = r#"{
        "login": "odd",
        "avatar_url": "http://avatars.example/u/2",
        "name": "",
        "description": "",
        "location": 7,
        "blog": "javascript:alert(1)",
        "is_verified": "yes"
    }"#;

    /// The repositories of `Acme`, pushed to most recently first, with one that GitHub
    /// would not give.
    const REPOSITORIES: &str = r#"[
        {"name": "widget", "full_name": "Acme/widget", "private": false, "visibility": "public",
         "owner": {"login": "Acme"}, "html_url": "https://github.com/Acme/widget",
         "description": "Widgets", "language": "Rust", "stargazers_count": 1200,
         "forks_count": 30, "open_issues_count": 12, "fork": false, "archived": false,
         "pushed_at": "2026-10-20T08:00:00Z", "created_at": "2015-03-01T10:00:00Z"},
        {"name": "gadget", "full_name": "Acme/gadget", "private": false, "visibility": "public",
         "language": "TypeScript", "stargazers_count": 300, "forks_count": 12,
         "open_issues_count": 5, "fork": true, "archived": false},
        {"name": "sprocket", "full_name": "Acme/sprocket", "private": false,
         "visibility": "public", "language": "Rust", "stargazers_count": 45, "forks_count": 3,
         "open_issues_count": 0, "fork": false, "archived": true},
        {"name": "docs", "full_name": "Acme/docs", "private": false, "visibility": "public",
         "language": null, "stargazers_count": 5, "forks_count": 1, "open_issues_count": 2},
        {"name": "odd", "full_name": "Acme/odd", "stargazers_count": "many"},
        "odd"
    ]"#;

    /// The public members of `Acme`, with some that the widget must not show as they are.
    const ACME_MEMBERS: &str = r#"[
        {"login": "alice", "id": 2, "type": "User", "site_admin": false,
         "avatar_url": "https://avatars.githubusercontent.com/u/2?v=4",
         "html_url": "https://github.com/alice"},
        {"login": "bob", "avatar_url": "https://avatars.githubusercontent.com/u/3?v=4",
         "html_url": "https://github.com/bob"},
        {"login": "mallory", "avatar_url": "http://avatars.example/u/4",
         "html_url": "https://evil.example/mallory"},
        {"login": "", "html_url": "https://github.com/ghost"},
        "odd"
    ]"#;

    /// A stub GitHub with the organizations `Acme`, `bare`, `odd` and `big`, which has more
    /// repositories than two pages of two and 57 public members, a user `octocat`, and a few
    /// odd answers. Like GitHub, it ignores the case of names in paths.
    fn github() -> Arc<Stub> {
        Stub::new(|request| {
            let query: HashMap<String, String> =
                form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
                    .into_owned()
                    .collect();
            match request.uri().path().to_ascii_lowercase().as_str() {
                "/orgs/acme" => answer(200, &[], ACME),
                "/orgs/bare" => answer(200, &[], BARE),
                "/orgs/odd" => answer(200, &[], ODD),
                "/orgs/big" => answer(200, &[], r#"{"login": "big"}"#),
                "/orgs/nameless" => answer(200, &[], r#"{"name": "Nameless"}"#),
                "/orgs/broken" => answer(500, &[], r#"{"message": "Server Error"}"#),
                "/orgs/unlisted" => answer(200, &[], r#"{"login": "unlisted"}"#),
                "/orgs/unlisted/repos" => answer(500, &[], r#"{"message": "Server Error"}"#),
                "/orgs/acme/repos" => answer(200, &[], REPOSITORIES),
                "/orgs/bare/repos" | "/orgs/bare/public_members" => answer(200, &[], "[]"),
                "/orgs/acme/public_members" => answer(200, &[], ACME_MEMBERS),
                "/orgs/unlisted/public_members" => {
                    answer(500, &[], r#"{"message": "Server Error"}"#)
                }
                "/orgs/big/public_members" => match query.get("per_page").map(String::as_str) {
                    Some("1") => answer(
                        200,
                        &[(
                            "link",
                            r#"<https://api.github.com/orgs/big/public_members?per_page=1&page=2>; rel="next", <https://api.github.com/orgs/big/public_members?per_page=1&page=57>; rel="last""#,
                        )],
                        r#"[{"login": "m1"}]"#,
                    ),
                    _ => {
                        let members: Vec<String> = (1..=24)
                            .map(|n| format!(r#"{{"login": "m{n}"}}"#))
                            .collect();
                        answer(
                            200,
                            &[(
                                "link",
                                r#"<https://api.github.com/orgs/big/public_members?per_page=24&page=2>; rel="next""#,
                            )],
                            &format!("[{}]", members.join(",")),
                        )
                    }
                },
                "/orgs/big/repos" => {
                    let next = r#"<https://api.github.com/orgs/big/repos?sort=pushed&per_page=2&page=2>; rel="next""#;
                    match query.get("page").map(String::as_str) {
                        None => answer(
                            200,
                            &[("link", next)],
                            r#"[{"name": "new", "stargazers_count": 1, "language": "Go"},
                                {"name": "newer", "stargazers_count": 2, "language": "C"}]"#,
                        ),
                        Some(_) => answer(
                            200,
                            &[],
                            r#"[{"name": "old", "stargazers_count": 4, "language": "Go"}]"#,
                        ),
                    }
                }
                _ => answer(404, &[], r#"{"message": "Not Found"}"#),
            }
        })
    }

    /// A cache on a database of its own, in front of `stub`, that lets each visitor make
    /// `visitor_fetches` dashboard loads an hour, and reads up to `org_repositories` of an
    /// organization's repositories.
    async fn cache(stub: &Arc<Stub>, visitor_fetches: u32, org_repositories: u32) -> Arc<Cache> {
        let cluster = cluster();
        let database = cluster.create_database();
        let db = db::connect(&DatabaseConfig {
            url: Secret::new(Url::parse(&cluster.url(&database)).unwrap()),
            max_connections: 5,
        })
        .await
        .unwrap();
        db::migrate(&db).await.unwrap();
        Arc::new(Cache::new(
            db,
            Arc::new(client(stub)),
            &CacheConfig {
                ttl: Duration::from_secs(15 * 60),
                retention: Duration::from_secs(30 * 24 * 60 * 60),
            },
            &LimitsConfig {
                org_repositories,
                visitor_fetches_per_hour: visitor_fetches,
            },
        ))
    }

    /// What a dashboard asks about its organization.
    #[derive(Clone, Copy, Debug)]
    enum Api {
        Summary,
        Stats,
        Repositories,
        Languages,
        TopRepositories,
        LastPush,
        CreatedPerYear,
        Members,
    }

    /// Every part of a dashboard that is read under its organization.
    const APIS: [Api; 8] = [
        Api::Summary,
        Api::Stats,
        Api::Repositories,
        Api::Languages,
        Api::TopRepositories,
        Api::LastPush,
        Api::CreatedPerYear,
        Api::Members,
    ];

    /// Every part of a dashboard that is read from the organization's repositories.
    const LISTED: [Api; 6] = [
        Api::Stats,
        Api::Repositories,
        Api::Languages,
        Api::TopRepositories,
        Api::LastPush,
        Api::CreatedPerYear,
    ];

    /// The status and body of a visitor's request to `api` for `org`, as JSON, `null` if
    /// there is none, and without the time of fetching, since it is the time the test ran.
    async fn ask(cache: &Arc<Cache>, api: Api, org: &str) -> (StatusCode, Value) {
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let name = Path(org.to_owned());
        let response = match api {
            Api::Summary => summary(State(cache.clone()), visitor, name).await,
            Api::Stats => stats(State(cache.clone()), visitor, name).await,
            Api::Repositories => repositories(State(cache.clone()), visitor, name).await,
            Api::Languages => languages(State(cache.clone()), visitor, name).await,
            Api::TopRepositories => top_repositories(State(cache.clone()), visitor, name).await,
            Api::LastPush => last_push(State(cache.clone()), visitor, name).await,
            Api::CreatedPerYear => created_per_year(State(cache.clone()), visitor, name).await,
            Api::Members => members(State(cache.clone()), visitor, name).await,
        };
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        if body.is_empty() {
            return (status, Value::Null);
        }
        let mut body: Value = serde_json::from_slice(&body).unwrap();
        // Only the summary tells it, as JavaScript writes it.
        if let Some(fetched_at) = body.as_object_mut().unwrap().remove("fetched_at") {
            let text = fetched_at.as_str().unwrap();
            assert!(text.ends_with('Z') && text.len() == 24, "{text}");
            text.parse::<DateTimeUtc>().unwrap();
        }
        (status, body)
    }

    #[tokio::test]
    async fn the_header_shows_what_github_says_of_the_organization() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        assert_eq!(
            ask(&cache, Api::Summary, "acme").await,
            (
                StatusCode::OK,
                json!({
                    "name": "Acme",
                    "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4",
                    "display_name": "Acme Corporation",
                    "description": "Widgets for everyone",
                    "location": "Springfield",
                    "website": "https://acme.example/blog",
                    "created_at": "2010-04-01T10:00:00Z",
                    "verified": true,
                })
            )
        );
        assert_eq!(
            ask(&cache, Api::Summary, "bare").await,
            (
                StatusCode::OK,
                json!({
                    "name": "bare",
                    "avatar_url": null,
                    "display_name": null,
                    "description": null,
                    "location": null,
                    "website": null,
                    "created_at": "2026-10-20T08:00:00Z",
                    "verified": false,
                })
            )
        );
    }

    #[tokio::test]
    async fn what_the_header_cannot_show_safely_is_left_out() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        assert_eq!(
            ask(&cache, Api::Summary, "odd").await,
            (
                StatusCode::OK,
                json!({
                    "name": "odd",
                    // Only from https URLs.
                    "avatar_url": null,
                    "display_name": null,
                    "description": null,
                    "location": null,
                    // Links only to http and https URLs (NFR-SEC-03).
                    "website": null,
                    "created_at": null,
                    "verified": false,
                })
            )
        );
    }

    #[test]
    fn websites_without_a_scheme_are_taken_as_https() {
        let site = |blog: &str| website(Some(&json!(blog)));
        assert_eq!(
            site("acme.example").as_deref(),
            Some("https://acme.example/")
        );
        assert_eq!(
            site(" acme.example/blog ").as_deref(),
            Some("https://acme.example/blog")
        );
        assert_eq!(
            site("http://acme.example").as_deref(),
            Some("http://acme.example/")
        );
        for blog in [
            "",
            " ",
            "javascript:alert(1)",
            "mailto:hello@acme.example",
            "ftp://acme.example",
            "acme example",
        ] {
            assert_eq!(site(blog), None, "{blog}");
        }
        assert_eq!(website(Some(&json!(7))), None);
        assert_eq!(website(None), None);
    }

    #[tokio::test]
    async fn names_are_spelled_as_github_spells_them() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        for org in ["Acme", "acme", "ACME"] {
            let (status, body) = ask(&cache, Api::Summary, org).await;
            assert_eq!((status, &body["name"]), (StatusCode::OK, &json!("Acme")));
        }
    }

    #[tokio::test]
    async fn stat_cards_add_up_the_repositories() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        let acme = json!({
            "repositories": 5,
            "private": 0,
            "internal": 0,
            "stars": 1550,
            "forks": 46,
            "open_issues_and_pull_requests": 19,
            "top_language": "Rust",
            "truncated": false,
        });
        assert_eq!(
            ask(&cache, Api::Stats, "acme").await,
            (StatusCode::OK, acme.clone())
        );

        // The repositories are asked for by the name as GitHub spells it, the most recently
        // pushed first, and are then cached.
        assert_eq!(
            ask(&cache, Api::Stats, "ACME").await,
            (StatusCode::OK, acme)
        );
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/orgs/acme",
                "https://api.github.com/orgs/Acme/repos?sort=pushed&per_page=100",
                "https://api.github.com/orgs/ACME",
            ]
        );
    }

    #[tokio::test]
    async fn an_organization_without_repositories_has_none_to_count() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        assert_eq!(
            ask(&cache, Api::Stats, "bare").await,
            (
                StatusCode::OK,
                json!({
                    "repositories": 0,
                    "private": 0,
                    "internal": 0,
                    "stars": 0,
                    "forks": 0,
                    "open_issues_and_pull_requests": 0,
                    "top_language": null,
                    "truncated": false,
                })
            )
        );
    }

    #[tokio::test]
    async fn only_the_repositories_pushed_to_last_count_past_the_limit() {
        let stub = github();
        let limited = cache(&stub, 30, 2).await;
        assert_eq!(
            ask(&limited, Api::Stats, "big").await,
            (
                StatusCode::OK,
                json!({
                    "repositories": 2,
                    "private": 0,
                    "internal": 0,
                    "stars": 3,
                    "forks": 0,
                    "open_issues_and_pull_requests": 0,
                    // Of one repository each, the first by name.
                    "top_language": "C",
                    "truncated": true,
                })
            )
        );
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/orgs/big",
                "https://api.github.com/orgs/big/repos?sort=pushed&per_page=2",
            ]
        );

        // Within the limit, every one counts.
        let all = cache(&stub, 30, 3).await;
        let (status, body) = ask(&all, Api::Stats, "big").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            (
                &body["repositories"],
                &body["top_language"],
                &body["truncated"]
            ),
            (&json!(3), &json!("Go"), &json!(false))
        );
    }

    #[test]
    fn private_and_internal_repositories_are_counted_apart() {
        let list = List {
            items: vec![
                json!({"name": "a", "private": false, "visibility": "public", "language": "Go"}),
                json!({"name": "b", "private": true, "visibility": "private", "language": "C"}),
                json!({"name": "c", "private": true, "language": "C"}),
                json!({"name": "d", "private": true, "visibility": "internal"}),
                json!({"name": "e", "language": ""}),
            ],
            truncated: false,
        };
        let figures = figures(&list);
        assert_eq!(
            (
                &figures["repositories"],
                &figures["private"],
                &figures["internal"],
                &figures["top_language"]
            ),
            (&json!(5), &json!(2), &json!(1), &json!("C"))
        );
    }

    #[tokio::test]
    async fn the_table_lists_each_repository() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        let expected = |name: &str, language: Option<&str>, figures: [u64; 3]| {
            json!({
                "name": name,
                "description": null,
                "language": language,
                "stars": figures[0],
                "forks": figures[1],
                "open_issues_and_pull_requests": figures[2],
                "pushed_at": null,
                "fork": false,
                "archived": false,
                "visibility": "public",
            })
        };
        let mut widget = expected("widget", Some("Rust"), [1200, 30, 12]);
        widget["description"] = json!("Widgets");
        widget["pushed_at"] = json!("2026-10-20T08:00:00Z");
        let mut gadget = expected("gadget", Some("TypeScript"), [300, 12, 5]);
        gadget["fork"] = json!(true);
        let mut sprocket = expected("sprocket", Some("Rust"), [45, 3, 0]);
        sprocket["archived"] = json!(true);
        assert_eq!(
            ask(&cache, Api::Repositories, "acme").await,
            (
                StatusCode::OK,
                json!({
                    // In the order GitHub gives them, pushed to most recently first.
                    "repositories": [
                        widget,
                        gadget,
                        sprocket,
                        expected("docs", None, [5, 1, 2]),
                        // What GitHub does not say is 0, as the stat cards count it.
                        expected("odd", None, [0, 0, 0]),
                    ],
                })
            )
        );
    }

    #[tokio::test]
    async fn the_table_the_stat_cards_and_the_charts_read_the_repositories_once() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        assert_eq!(ask(&cache, Api::Stats, "acme").await.0, StatusCode::OK);
        let (status, body) = ask(&cache, Api::Repositories, "Acme").await;
        assert_eq!(
            (status, body["repositories"].as_array().unwrap().len()),
            (StatusCode::OK, 5)
        );
        for api in LISTED {
            assert_eq!(ask(&cache, api, "Acme").await.0, StatusCode::OK, "{api:?}");
        }
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/orgs/acme",
                "https://api.github.com/orgs/Acme/repos?sort=pushed&per_page=100",
                "https://api.github.com/orgs/Acme",
            ]
        );
    }

    #[tokio::test]
    async fn the_table_lists_only_the_repositories_pushed_to_last_past_the_limit() {
        let stub = github();
        let cache = cache(&stub, 30, 2).await;
        let (status, body) = ask(&cache, Api::Repositories, "big").await;
        let names: Vec<&str> = body["repositories"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect();
        assert_eq!((status, names), (StatusCode::OK, vec!["new", "newer"]));
    }

    #[test]
    fn rows_mark_private_and_internal_repositories_and_need_a_name() {
        let visibility = |repository: Value| row(&repository).unwrap()["visibility"].clone();
        assert_eq!(
            visibility(json!({"name": "a", "private": false, "visibility": "public"})),
            "public"
        );
        assert_eq!(
            visibility(json!({"name": "b", "private": true, "visibility": "private"})),
            "private"
        );
        assert_eq!(visibility(json!({"name": "c", "private": true})), "private");
        assert_eq!(
            visibility(json!({"name": "d", "private": true, "visibility": "internal"})),
            "internal"
        );
        for repository in [
            json!({}),
            json!({"name": ""}),
            json!({"name": ".."}),
            json!({"name": "a b"}),
            json!({"name": "acme/widget"}),
            json!({"name": 7}),
            json!("widget"),
        ] {
            assert_eq!(row(&repository), None, "{repository}");
        }
    }

    #[tokio::test]
    async fn the_languages_chart_counts_the_repositories_of_each_language() {
        let stub = github();
        let all = cache(&stub, 30, 1000).await;
        assert_eq!(
            ask(&all, Api::Languages, "acme").await,
            (
                StatusCode::OK,
                json!({
                    // Those without a primary language are not counted.
                    "languages": [
                        {"name": "Rust", "repositories": 2},
                        {"name": "TypeScript", "repositories": 1},
                    ],
                    "other": 0,
                })
            )
        );

        // Past the limit, only the repositories pushed to last count (FR-ORG-08).
        let limited = cache(&stub, 30, 2).await;
        assert_eq!(
            ask(&limited, Api::Languages, "big").await,
            (
                StatusCode::OK,
                json!({
                    "languages": [
                        {"name": "C", "repositories": 1},
                        {"name": "Go", "repositories": 1},
                    ],
                    "other": 0,
                })
            )
        );
    }

    #[test]
    fn languages_past_the_8_of_the_most_repositories_are_other() {
        let languages = [
            "Rust", "Rust", "Rust", "Go", "Go", "J", "I", "H", "G", "F", "E", "D", "C",
        ];
        let list = List {
            items: languages
                .iter()
                .map(|language| json!({"name": "r", "language": language}))
                .chain([
                    json!({"name": "s", "language": null}),
                    json!({"name": "t", "language": ""}),
                    json!({"name": "u", "language": 7}),
                    json!({"name": "v"}),
                    json!("Rust"),
                ])
                .collect(),
            truncated: false,
        };
        assert_eq!(
            language_chart(&list),
            json!({
                // Of those with as many, the first by name.
                "languages": [
                    {"name": "Rust", "repositories": 3},
                    {"name": "Go", "repositories": 2},
                    {"name": "C", "repositories": 1},
                    {"name": "D", "repositories": 1},
                    {"name": "E", "repositories": 1},
                    {"name": "F", "repositories": 1},
                    {"name": "G", "repositories": 1},
                    {"name": "H", "repositories": 1},
                ],
                // I and J.
                "other": 2,
            })
        );
    }

    #[tokio::test]
    async fn the_top_repositories_are_those_with_the_most_stars() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        assert_eq!(
            ask(&cache, Api::TopRepositories, "acme").await,
            (
                StatusCode::OK,
                json!({
                    // Not `odd`, of which GitHub does not tell the stars.
                    "repositories": [
                        {"name": "widget", "stars": 1200},
                        {"name": "gadget", "stars": 300},
                        {"name": "sprocket", "stars": 45},
                        {"name": "docs", "stars": 5},
                    ],
                })
            )
        );
    }

    #[test]
    fn the_top_repositories_are_10_with_stars() {
        let repository = |name: &str, stars: u64| json!({"name": name, "stargazers_count": stars});
        let mut items: Vec<Value> = (1..=11)
            .map(|stars| repository(&format!("r{stars:02}"), stars))
            .collect();
        items.extend([
            repository("a-tie", 11),
            repository("unstarred", 0),
            repository("a b", 100),
            json!({"name": "unknown"}),
            json!({"stargazers_count": 100}),
        ]);
        let chart = top(&List {
            items,
            truncated: false,
        });
        let names: Vec<(&str, u64)> = chart["repositories"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                (
                    row["name"].as_str().unwrap(),
                    row["stars"].as_u64().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            names,
            [
                // Of those with as many, the first by name.
                ("a-tie", 11),
                ("r11", 11),
                ("r10", 10),
                ("r09", 9),
                ("r08", 8),
                ("r07", 7),
                ("r06", 6),
                ("r05", 5),
                ("r04", 4),
                ("r03", 3),
            ]
        );

        let unstarred = List {
            items: vec![repository("unstarred", 0)],
            truncated: false,
        };
        assert_eq!(top(&unstarred), json!({"repositories": []}));
    }

    #[test]
    fn each_repository_counts_in_the_period_of_its_last_push() {
        let now: DateTimeUtc = "2026-10-26T12:00:00Z".parse().unwrap();
        let pushed = |ago: TimeDelta| json!({"pushed_at": (now - ago).to_rfc3339_opts(SecondsFormat::Secs, true)});
        let list = List {
            items: vec![
                // As by a clock ahead of BuhTig's.
                pushed(TimeDelta::hours(-1)),
                pushed(TimeDelta::zero()),
                pushed(TimeDelta::days(7) - TimeDelta::seconds(1)),
                pushed(TimeDelta::days(7)),
                pushed(TimeDelta::days(30) - TimeDelta::seconds(1)),
                pushed(TimeDelta::days(30)),
                pushed(TimeDelta::days(365) - TimeDelta::seconds(1)),
                pushed(TimeDelta::days(365)),
                pushed(TimeDelta::days(10 * 365)),
                // GitHub does not tell when these were pushed to.
                json!({"pushed_at": null}),
                json!({"pushed_at": "yesterday"}),
                json!({"pushed_at": 7}),
                json!({}),
                json!("2026-10-26T12:00:00Z"),
            ],
            truncated: false,
        };
        assert_eq!(
            pushes(&list, now),
            json!({
                "last_7_days": 3,
                "last_30_days": 2,
                "last_12_months": 2,
                "older": 2,
            })
        );
    }

    #[test]
    fn repositories_are_counted_by_the_year_they_were_created_in() {
        let now: DateTimeUtc = "2026-10-26T12:00:00Z".parse().unwrap();
        let created = |at: &str| json!({"created_at": at});
        let list = List {
            items: vec![
                created("2019-05-01T10:00:00Z"),
                created("2019-12-31T23:59:59Z"),
                // 2021 in UTC.
                created("2020-12-31T23:30:00-05:00"),
                created("2023-06-01T10:00:00Z"),
                json!({"created_at": null}),
                json!({"created_at": "last year"}),
                json!({}),
            ],
            truncated: false,
        };
        let year =
            |year: i32, repositories: u64| json!({"year": year, "repositories": repositories});
        assert_eq!(
            years(&list, now),
            json!({
                // Every year to this one, with or without any.
                "years": [
                    year(2019, 2),
                    year(2020, 0),
                    year(2021, 1),
                    year(2022, 0),
                    year(2023, 1),
                    year(2024, 0),
                    year(2025, 0),
                    year(2026, 0),
                ],
            })
        );

        // As by a clock ahead of BuhTig's.
        let ahead = List {
            items: vec![
                created("2025-01-01T00:00:00Z"),
                created("2027-01-01T00:00:00Z"),
            ],
            truncated: false,
        };
        assert_eq!(
            years(&ahead, now),
            json!({"years": [year(2025, 1), year(2026, 0), year(2027, 1)]})
        );

        let undated = List {
            items: vec![json!({"name": "widget"})],
            truncated: false,
        };
        assert_eq!(years(&undated, now), json!({"years": []}));
    }

    #[tokio::test]
    async fn the_activity_charts_count_the_repositories_that_github_dates() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        // Of Acme's repositories, GitHub tells only when `widget` was pushed to, in 2026, and
        // created, in 2015.
        let (status, pushes) = ask(&cache, Api::LastPush, "acme").await;
        assert_eq!(status, StatusCode::OK);
        let periods = ["last_7_days", "last_30_days", "last_12_months", "older"];
        assert_eq!(pushes.as_object().unwrap().len(), periods.len());
        let counted: u64 = periods
            .iter()
            .map(|period| pushes[period].as_u64().unwrap())
            .sum();
        assert_eq!(counted, 1);

        let (status, created) = ask(&cache, Api::CreatedPerYear, "acme").await;
        assert_eq!(status, StatusCode::OK);
        let years = created["years"].as_array().unwrap();
        assert_eq!(years[0], json!({"year": 2015, "repositories": 1}));
        assert_eq!(
            years.last().unwrap()["year"],
            json!(ChronoUtc::now().year())
        );
        assert_eq!(
            years.len(),
            usize::try_from(ChronoUtc::now().year() - 2014).unwrap()
        );
        assert!(years[1..].iter().all(|year| year["repositories"] == 0));
    }

    #[tokio::test]
    async fn an_organization_without_repositories_has_nothing_to_chart() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        for (api, expected) in [
            (Api::Languages, json!({"languages": [], "other": 0})),
            (Api::TopRepositories, json!({"repositories": []})),
            (
                Api::LastPush,
                json!({"last_7_days": 0, "last_30_days": 0, "last_12_months": 0, "older": 0}),
            ),
            (Api::CreatedPerYear, json!({"years": []})),
        ] {
            assert_eq!(
                ask(&cache, api, "bare").await,
                (StatusCode::OK, expected),
                "{api:?}"
            );
        }
    }

    #[tokio::test]
    async fn the_members_widget_shows_the_members_github_lists() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        assert_eq!(
            ask(&cache, Api::Members, "acme").await,
            (
                StatusCode::OK,
                json!({
                    // Those without a login count too, as GitHub counts them.
                    "count": 5,
                    "members": [
                        {
                            "login": "alice",
                            "avatar_url": "https://avatars.githubusercontent.com/u/2?v=4",
                            "url": "https://github.com/alice",
                        },
                        {
                            "login": "bob",
                            "avatar_url": "https://avatars.githubusercontent.com/u/3?v=4",
                            "url": "https://github.com/bob",
                        },
                        // Avatars only from https URLs, and links only to pages on GitHub
                        // (NFR-SEC-03).
                        {"login": "mallory", "avatar_url": null, "url": null},
                    ],
                })
            )
        );
        // The public members alone, by the name as GitHub spells it. They fit on one page, so
        // they are not counted apart.
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/orgs/acme",
                "https://api.github.com/orgs/Acme/public_members?per_page=24",
            ]
        );

        assert_eq!(
            ask(&cache, Api::Members, "bare").await,
            (StatusCode::OK, json!({"count": 0, "members": []}))
        );
    }

    #[tokio::test]
    async fn more_than_24_members_are_counted_apart() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        let (status, body) = ask(&cache, Api::Members, "big").await;
        let logins: Vec<String> = body["members"]
            .as_array()
            .unwrap()
            .iter()
            .map(|member| member["login"].as_str().unwrap().to_owned())
            .collect();
        let first: Vec<String> = (1..=24).map(|n| format!("m{n}")).collect();
        assert_eq!(
            (status, &body["count"], logins),
            (StatusCode::OK, &json!(57), first)
        );

        // Both are then cached.
        assert_eq!(ask(&cache, Api::Members, "big").await, (status, body));
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/orgs/big",
                "https://api.github.com/orgs/big/public_members?per_page=24",
                "https://api.github.com/orgs/big/public_members?per_page=1",
            ]
        );
    }

    #[test]
    fn only_token_users_see_members_who_keep_their_membership_private() {
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
            credential_id: 1,
            pat: Secret::new("pat".to_owned()),
            sign_in: Secret::new("sign-in".to_owned()),
        };
        for viewer in [visitor, signed_in] {
            assert_eq!(
                members_path(&viewer, "Acme").to_string(),
                "/orgs/Acme/public_members",
                "{viewer:?}"
            );
        }
        assert_eq!(
            members_path(&token_user, "Acme").to_string(),
            "/orgs/Acme/members"
        );
    }

    #[tokio::test]
    async fn what_github_cannot_tell_is_not_an_answer() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        for api in APIS {
            // A user's account is no organization (FR-SRCH-06).
            assert_eq!(ask(&cache, api, "octocat").await.0, StatusCode::NOT_FOUND);
            assert_eq!(ask(&cache, api, "nobody").await.0, StatusCode::NOT_FOUND);
            assert_eq!(ask(&cache, api, "broken").await.0, StatusCode::BAD_GATEWAY);
            assert_eq!(
                ask(&cache, api, "nameless").await.0,
                StatusCode::BAD_GATEWAY
            );
        }
        for api in LISTED.into_iter().chain([Api::Members]) {
            assert_eq!(
                ask(&cache, api, "unlisted").await.0,
                StatusCode::BAD_GATEWAY,
                "{api:?}"
            );
        }
    }

    #[tokio::test]
    async fn names_that_cannot_be_accounts_are_not_asked_for() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        for api in APIS {
            for org in ["", "-acme", "acme.com", "ac me", &"a".repeat(40)] {
                assert_eq!(
                    ask(&cache, api, org).await.0,
                    StatusCode::BAD_REQUEST,
                    "{org}"
                );
            }
        }
        assert_eq!(stub.urls(), Vec::<String>::new());
    }

    #[tokio::test]
    async fn visitors_held_back_are_told_so() {
        let stub = github();
        let cache = cache(&stub, 0, 1000).await;
        for api in APIS {
            assert_eq!(
                ask(&cache, api, "acme").await.0,
                StatusCode::TOO_MANY_REQUESTS
            );
        }
        assert_eq!(stub.urls(), Vec::<String>::new());
    }

    #[tokio::test]
    async fn an_organization_github_keeps_from_the_viewer_is_explained() {
        let stub = Stub::new(|request| match request.uri().path() {
            "/orgs/acme" => answer(
                403,
                &[(
                    "x-github-sso",
                    "required; url=https://github.com/orgs/acme/sso?authorization_request=abc",
                )],
                "",
            ),
            _ => answer(404, &[], r#"{"message": "Not Found"}"#),
        });
        let cache = cache(&stub, 30, 1000).await;
        let (status, body) = ask(&cache, Api::Summary, "acme").await;
        assert_eq!(
            (status, body),
            (
                StatusCode::FORBIDDEN,
                json!({
                    "denied": "sso",
                    "url": "https://github.com/orgs/acme/sso?authorization_request=abc"
                })
            )
        );
        // Names that cannot be an account's are still refused before GitHub is asked.
        assert_eq!(
            ask(&cache, Api::Summary, "-acme").await.0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(stub.urls(), ["https://api.github.com/orgs/acme"]);
    }
}
