//! What a repository's dashboard shows of the repository as a whole: its header
//! (FR-REPO-01), with its name as GitHub spells it (FR-NAV-04) and its new one if it was
//! renamed or transferred (FR-NAV-05), its stat cards (FR-REPO-02), its commit activity
//! (FR-REPO-03), its languages (FR-REPO-04) and its top contributors (FR-REPO-05).

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use sea_orm::entity::prelude::DateTimeUtc;
use serde_json::{Value, json};
use tracing::error;
use url::Url;

use crate::accounts::is_account_name;
use crate::cache::{self, Cache, Cached, Outcome, Viewer};
use crate::github;
use crate::visitors::Visitor;

/// The longest repository name GitHub allows.
const MAX_LENGTH: usize = 100;

/// FR-REPO-03: the weeks of commit activity the chart shows.
const WEEKS: usize = 52;

/// FR-REPO-04: the languages the chart names. The rest are "Other".
const LANGUAGES: usize = 8;

/// FR-REPO-05: the contributors the widget lists.
const CONTRIBUTORS: usize = 10;

/// `/-/api/repositories/{owner}/{repo}`: what the dashboard's header shows (FR-REPO-01),
///
/// ```json
/// {"name": "owner/repo", "fetched_at": …, "owner_avatar_url": …, "description": …,
///  "visibility": "public" | "private" | "internal", "archived": …, "template": …,
///  "fork": …, "parent": "owner/repo", "topics": […], "license": …,
///  "default_branch": …, "homepage": …, "created_at": …, "pushed_at": …}
/// ```
///
/// The name is the repository's as GitHub spells it, whatever case it was asked for in
/// (FR-NAV-04), and its new name if it was renamed or transferred, since the client follows
/// GitHub's redirects (FR-NAV-05). `fetched_at` is when GitHub gave what BuhTig knows of the
/// repository, which the dashboard shows (FR-DATA-06). `parent` is the name of the
/// repository a fork was forked from. What GitHub does not say, or says in a form BuhTig
/// does not show, is `null`: links are only to `http` and `https` URLs, and avatars only
/// from `https` ones (NFR-SEC-03). 404 if there is no such repository, or if it is private
/// (FR-ACC-05).
///
/// Names that cannot be a repository's are 400, without asking GitHub (FR-SRCH-04). Any
/// other status means that BuhTig cannot tell now. The dashboard then keeps its URL.
pub async fn summary(
    State(cache): State<Arc<Cache>>,
    visitor: Visitor,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    if !is_account_name(&owner) || !is_repository_name(&repo) {
        return status(StatusCode::BAD_REQUEST);
    }
    // Everyone is a visitor until sign-in is built (#22). A token user will then read
    // with their PAT, which may see private repositories (#23). The repository is read
    // for its dashboard, so a visitor's load of that counts once (FR-DATA-10).
    let viewer = Viewer::Visitor(visitor);
    let cached = match repository(&cache, &viewer, &owner, &repo).await {
        Ok(cached) => cached,
        Err(code) => return status(code),
    };
    let data = &cached.data;
    let Some(name) = data.get("full_name").and_then(Value::as_str) else {
        return status(StatusCode::BAD_GATEWAY);
    };
    let topics: Vec<&str> = data
        .get("topics")
        .and_then(Value::as_array)
        .map(|topics| topics.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    respond(json!({
        "name": name,
        "fetched_at": cached.fetched_at_iso(),
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
        "topics": topics,
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
/// Its statuses are those of [`summary`], since it reads the repository first. A failure
/// to read the rest is 502.
pub async fn stats(
    State(cache): State<Arc<Cache>>,
    visitor: Visitor,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, visitor, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    // GitHub's search counts pull requests apart from issues, in one request that
    // returns at most one of them.
    let pulls = github::Path::new(["search", "issues"])
        .expect("names are neither empty nor dots")
        .query("q", &format!("repo:{} is:pr is:open", repository.name))
        .query("per_page", "1");
    let latest = repository.path(&["releases", "latest"]);
    let (pulls, latest) = tokio::join!(
        cache.get(&repository.viewer, &repository.dashboard, &pulls),
        cache.get_optional(&repository.viewer, &repository.dashboard, &latest),
    );
    let (pulls, latest) = match (data(pulls), data(latest)) {
        (Ok(pulls), Ok(latest)) => (pulls.data, latest.data),
        (Err(code), _) | (_, Err(code)) => return status(code),
    };
    match figures(&repository.data, &pulls, latest.as_ref()) {
        Some(figures) => respond(figures),
        None => status(StatusCode::BAD_GATEWAY),
    }
}

/// `/-/api/repositories/{owner}/{repo}/commit-activity`: how many commits the repository's
/// default branch had in each of the last 52 weeks (FR-REPO-03), oldest first,
///
/// ```json
/// {"weeks": [{"week": "2025-10-26", "commits": 3}, …]}
/// ```
///
/// Each week starts on the Sunday whose date it gives, in UTC, as GitHub counts them. An
/// empty repository has no weeks (FR-REPO-11).
///
/// 202 while GitHub is still computing them: ask again (FR-REPO-10). Its other statuses
/// are those of [`stats`].
pub async fn commit_activity(
    State(cache): State<Arc<Cache>>,
    visitor: Visitor,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, visitor, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    let path = repository.path(&["stats", "commit_activity"]);
    let activity = cache
        .get(&repository.viewer, &repository.dashboard, &path)
        .await;
    let activity = match data(activity) {
        Ok(activity) => activity.data,
        Err(code) => return status(code),
    };
    match weeks(&activity) {
        Some(weeks) => respond(json!({ "weeks": weeks })),
        None => status(StatusCode::BAD_GATEWAY),
    }
}

/// `/-/api/repositories/{owner}/{repo}/languages`: how many bytes of the repository's code
/// are in each language, as GitHub detects them (FR-REPO-04): the 8 with the most, most
/// first, and the rest together,
///
/// ```json
/// {"languages": [{"name": "Rust", "bytes": 120000}, …], "other": 3456}
/// ```
///
/// `other` is apart from the languages named, so that none is taken for a language that
/// GitHub calls "Other". An empty repository has no languages (FR-REPO-11).
///
/// Its statuses are those of [`commit_activity`].
pub async fn languages(
    State(cache): State<Arc<Cache>>,
    visitor: Visitor,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, visitor, &owner, &repo).await {
        Ok(repository) => repository,
        Err(code) => return status(code),
    };
    let path = repository.path(&["languages"]);
    let languages = cache
        .get(&repository.viewer, &repository.dashboard, &path)
        .await;
    let languages = match data(languages) {
        Ok(languages) => languages.data,
        Err(code) => return status(code),
    };
    match shares(&languages) {
        Some(shares) => respond(shares),
        None => status(StatusCode::BAD_GATEWAY),
    }
}

/// `/-/api/repositories/{owner}/{repo}/contributors`: up to 10 of the GitHub accounts with
/// the most commits on the repository's default branch (FR-REPO-05), most first,
///
/// ```json
/// {"contributors": [{"login": …, "avatar_url": …, "url": …, "commits": …}, …],
///  "too_large": false}
/// ```
///
/// `url` is the account's page on GitHub (FR-REPO-12). Bots count too, as on GitHub. What
/// BuhTig does not show or link to is `null` (NFR-SEC-03). GitHub does not list the
/// contributors of its largest repositories: `too_large` then says so, and there are none.
/// An empty repository has none either (FR-REPO-11).
///
/// Its statuses are those of [`commit_activity`].
pub async fn contributors(
    State(cache): State<Arc<Cache>>,
    visitor: Visitor,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let repository = match under(&cache, visitor, &owner, &repo).await {
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
        // The viewer may see the repository, so GitHub refuses the list itself, as it does
        // when the history is too large to count. A rate limit is not a refusal.
        Err(cache::Error::GitHub(github::Error::Forbidden { .. })) => {
            return respond(json!({ "contributors": [], "too_large": true }));
        }
        list => match data(list) {
            Ok(list) => list.data,
            Err(code) => return status(code),
        },
    };
    let mut contributors: Vec<(u64, Value)> = list.items.iter().filter_map(contributor).collect();
    contributors.sort_by(|(one, _), (other, _)| other.cmp(one));
    contributors.truncate(CONTRIBUTORS);
    let contributors: Vec<Value> = contributors.into_iter().map(|(_, data)| data).collect();
    respond(json!({ "contributors": contributors, "too_large": false }))
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
}

impl Under {
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

/// The repository `owner/repo`, read for a visitor as [`summary`] reads it, for what is
/// read under it, or the status that says why it cannot be: those of [`summary`].
async fn under(
    cache: &Cache,
    visitor: Visitor,
    owner: &str,
    repo: &str,
) -> Result<Under, StatusCode> {
    if !is_account_name(owner) || !is_repository_name(repo) {
        return Err(StatusCode::BAD_REQUEST);
    }
    // As in `summary`.
    let viewer = Viewer::Visitor(visitor);
    let data = repository(cache, &viewer, owner, repo).await?.data;
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
    })
}

/// The repository `owner/repo`, as the cache has it for the viewer, or the status that
/// says why it has none.
async fn repository(
    cache: &Cache,
    viewer: &Viewer,
    owner: &str,
    repo: &str,
) -> Result<Cached<Value>, StatusCode> {
    let path = github::Path::new(["repos", owner, repo]).expect("names are neither empty nor dots");
    data(cache.get(viewer, &format!("/{owner}/{repo}"), &path).await)
}

/// The data the cache had, or the status that says why it had none: 202 while GitHub is
/// still computing it, for the dashboard to ask again (FR-REPO-10).
fn data<T>(result: Result<Outcome<T>, cache::Error>) -> Result<Cached<T>, StatusCode> {
    match result {
        Ok(Outcome::Data(cached)) => Ok(cached),
        Ok(Outcome::Computing) => Err(StatusCode::ACCEPTED),
        Err(cache::Error::GitHub(github::Error::NotFound)) => Err(StatusCode::NOT_FOUND),
        Err(cache::Error::GitHub(_)) => Err(StatusCode::BAD_GATEWAY),
        Err(cache::Error::Held(_)) => Err(StatusCode::TOO_MANY_REQUESTS),
        Err(error @ cache::Error::Database(_)) => {
            error!("{error}");
            Err(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

/// The stat cards' figures, from the repository, the search for its open pull requests,
/// and its latest release, if it has one. `None` if GitHub left a count out.
fn figures(repository: &Value, pulls: &Value, latest: Option<&Value>) -> Option<Value> {
    let count = |data: &Value, key| data.get(key).and_then(Value::as_u64);
    let open_pulls = count(pulls, "total_count")?;
    Some(json!({
        "stars": count(repository, "stargazers_count")?,
        "forks": count(repository, "forks_count")?,
        "watchers": count(repository, "subscribers_count")?,
        // The two counts may have been fetched at different times.
        "open_issues": count(repository, "open_issues_count")?.saturating_sub(open_pulls),
        "open_pull_requests": open_pulls,
        "latest_release": latest.and_then(release),
    }))
}

/// A release as its stat card shows it, unless it has no tag.
fn release(release: &Value) -> Option<Value> {
    let tag = text(release, "tag_name")?;
    Some(json!({
        "tag": tag,
        "published_at": text(release, "published_at").or_else(|| text(release, "created_at")),
        "url": page(release.get("html_url")),
    }))
}

/// The weeks of commit activity that GitHub gave, as the chart shows them: the last 52,
/// oldest first. `None` if a week lacks its start or its count. GitHub has no content, or
/// `{}` or `[]`, for an empty repository.
fn weeks(activity: &Value) -> Option<Vec<Value>> {
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
fn contributor(contributor: &Value) -> Option<(u64, Value)> {
    let commits = contributor.get("contributions")?.as_u64()?;
    Some((
        commits,
        json!({
            "login": text(contributor, "login")?,
            "avatar_url": link(contributor.get("avatar_url"), &["https"]),
            "url": page(contributor.get("html_url")),
            "commits": commits,
        }),
    ))
}

/// `value` as a URL to link to, if it is one of a page on GitHub (FR-REPO-12).
fn page(value: Option<&Value>) -> Option<String> {
    link(value, &["https"])
        .filter(|url| Url::parse(url).is_ok_and(|url| url.host_str() == Some("github.com")))
}

/// `owner/repo` as its two names, if it is a repository's.
fn names(full_name: &str) -> Option<(&str, &str)> {
    full_name
        .split_once('/')
        .filter(|(owner, repo)| is_account_name(owner) && is_repository_name(repo))
}

/// The text of `data`'s member `key`, unless it is empty.
fn text<'a>(data: &'a Value, key: &str) -> Option<&'a str> {
    data.get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

/// GitHub's visibility of the repository, from `private` if it gives no other.
fn visibility(data: &Value) -> &'static str {
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
fn link(value: Option<&Value>, schemes: &[&str]) -> Option<String> {
    let url = Url::parse(value?.as_str()?.trim()).ok()?;
    schemes.contains(&url.scheme()).then(|| url.into())
}

fn respond(body: Value) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

fn status(status: StatusCode) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")]).into_response()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::time::Duration;

    use axum::http::HeaderMap;
    use sea_orm::entity::prelude::{ChronoUtc, DateTimeUtc};
    use sea_orm::sea_query::prelude::chrono::TimeDelta;
    use url::form_urlencoded;

    use super::*;
    use crate::config::{CacheConfig, DatabaseConfig, LimitsConfig, Secret};
    use crate::db;
    use crate::github::stub::{Stub, answer, client};
    use crate::test_cluster::cluster;

    /// `Acme/Widget` as GitHub gives it, with all that its dashboard shows.
    const WIDGET: &str = r#"{
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
        "private": true,
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

    /// A stub GitHub with the repositories `Acme/Widget`, `acme/bare` and `acme/odd`, one
    /// that was renamed to `Acme/Widget`, and a few odd answers. Like GitHub, it ignores
    /// the case of names in paths.
    fn github() -> Arc<Stub> {
        Stub::new(|request| {
            let query: HashMap<String, String> =
                form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
                    .into_owned()
                    .collect();
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
                "/repos/acme/busy/stats/commit_activity" => answer(202, &[], "{}"),
                // GitHub does not list its contributors.
                "/repos/acme/huge" => answer(200, &[], r#"{"full_name": "acme/huge"}"#),
                "/repos/acme/huge/contributors" => answer(
                    403,
                    &[],
                    r#"{"message": "The history or contributor list is too large to list contributors for this repository via the API.", "status": "403"}"#,
                ),
                "/repos/acme/widget/stats/commit_activity" => answer(200, &[], &activity()),
                "/repos/acme/widget/languages" => answer(200, &[], LANGUAGES),
                "/repos/acme/widget/contributors" => answer(200, &[], CONTRIBUTORS),
                // As for an empty repository.
                "/repos/acme/bare/stats/commit_activity" | "/repos/acme/bare/contributors" => {
                    answer(204, &[], "")
                }
                "/repos/acme/bare/languages" => answer(200, &[], "{}"),
                "/repos/acme/odd/stats/commit_activity" => answer(
                    200,
                    &[],
                    r#"[{"week": 1761436800, "days": [1, 0, 0, 0, 0, 0, 0]}]"#,
                ),
                "/repos/acme/odd/languages" => answer(200, &[], r#"["Rust"]"#),
                "/repos/acme/odd/contributors" => answer(200, &[], r#"{"login": "alice"}"#),
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
                "/search/issues" => match query.get("q").map(String::as_str) {
                    Some("repo:Acme/Widget is:pr is:open") => answer(
                        200,
                        &[],
                        r#"{"total_count": 12, "incomplete_results": false,
                            "items": [{"number": 7, "pull_request": {}}]}"#,
                    ),
                    Some("repo:acme/bare is:pr is:open") => answer(
                        200,
                        &[],
                        r#"{"total_count": 0, "incomplete_results": false, "items": []}"#,
                    ),
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
    }

    impl Api {
        const ALL: [Api; 5] = [
            Api::Summary,
            Api::Stats,
            Api::CommitActivity,
            Api::Languages,
            Api::Contributors,
        ];
    }

    /// The status and body of a visitor's request to `api` for `owner/repo`.
    async fn request(
        cache: &Arc<Cache>,
        api: Api,
        owner: &str,
        repo: &str,
    ) -> (StatusCode, String) {
        let visitor = Visitor::of("203.0.113.1".parse().unwrap(), &HeaderMap::new());
        let names = Path((owner.to_owned(), repo.to_owned()));
        let cache = State(cache.clone());
        let response = match api {
            Api::Summary => summary(cache, visitor, names).await,
            Api::Stats => stats(cache, visitor, names).await,
            Api::CommitActivity => commit_activity(cache, visitor, names).await,
            Api::Languages => languages(cache, visitor, names).await,
            Api::Contributors => contributors(cache, visitor, names).await,
        };
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
        // Only the summary tells it.
        if body.get("fetched_at").is_some() {
            fetched_at(&body);
            body.as_object_mut().unwrap().remove("fetched_at");
        }
        (status, body)
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
                    // Only from https URLs.
                    "owner_avatar_url": null,
                    "description": null,
                    // GitHub's own words, else `private`.
                    "visibility": "private",
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
        assert_eq!(super::release(&json!({"tag_name": ""})), None);
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
        for _ in 0..2 {
            assert_eq!(
                ask(&cache, Api::CommitActivity, "acme", "busy").await,
                (StatusCode::ACCEPTED, Value::Null)
            );
        }
        // Nothing is cached of what GitHub has yet to compute.
        let asked = stub.urls();
        let computing = "https://api.github.com/repos/acme/busy/stats/commit_activity";
        assert_eq!(
            asked.iter().filter(|url| *url == computing).count(),
            2,
            "{asked:?}"
        );
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
                    "too_large": false,
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
    async fn contributors_github_does_not_list_are_said_to_be_too_many() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::Contributors, "acme", "huge").await,
            (
                StatusCode::OK,
                json!({"contributors": [], "too_large": true})
            )
        );
    }

    #[tokio::test]
    async fn an_empty_repository_has_nothing_to_chart() {
        let stub = github();
        let cache = cache(&stub, 30).await;
        assert_eq!(
            ask(&cache, Api::CommitActivity, "acme", "bare").await,
            (StatusCode::OK, json!({"weeks": []}))
        );
        assert_eq!(
            ask(&cache, Api::Languages, "acme", "bare").await,
            (StatusCode::OK, json!({"languages": [], "other": 0}))
        );
        assert_eq!(
            ask(&cache, Api::Contributors, "acme", "bare").await,
            (
                StatusCode::OK,
                json!({"contributors": [], "too_large": false})
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
        assert_eq!(
            ask(&cache, Api::Stats, "acme", "unsearchable").await.0,
            StatusCode::BAD_GATEWAY
        );
        for api in [Api::CommitActivity, Api::Languages, Api::Contributors] {
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
}
