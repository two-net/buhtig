//! Link previews of dashboards (FR-NAV-06): the title and short description that chat
//! tools show for a link to `/{owner}/{repo}` or `/{org}`, or to one of their tabs, such as
//! `/{owner}/{repo}/issues`, which is previewed as its dashboard is. They read the page
//! without running its script, so BuhTig writes them into the page it serves.
//!
//! A preview's image is its resource's card (FR-NAV-07), which [`crate::card`] draws from
//! what [`Previews::card`] reads, at `/-/preview/{owner}/{repo}.png` or `/-/preview/{name}.png`,
//! and as SVG at `.svg`, for READMEs to embed.
//!
//! A preview, and a card, tell only what the shared cache holds while it is fresh. That is
//! public (FR-DATA-04), and no older than what a visitor's dashboard shows (FR-ACC-07), so a
//! preview never holds private data. Serving the page never waits for GitHub either: a
//! dashboard that no one has opened within `cache.ttl` has no preview, and its card shows
//! its name alone.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sea_orm::entity::prelude::ChronoUtc;
use sea_orm::sea_query::prelude::chrono::TimeDelta;
use serde_json::Value;
use tracing::{error, info};
use url::Url;

use crate::accounts::is_account_name;
use crate::cache::Cache;
use crate::card::{self, Card, Facts, escape};
use crate::github;
use crate::navigation::{self, Dashboard, Tab};
use crate::organizations::{self, REPOSITORY_FIELDS};
use crate::repositories::{self, is_repository_name};
use crate::throttle::Throttle;
use crate::visitors::Visitor;

/// How many PNG cards each client may have drawn in [`DRAWN_WINDOW`]: more than chat tools
/// fetch for the links shared, and few enough that no client keeps BuhTig busy drawing
/// (NFR-CAP-01).
const DRAWN: usize = 30;
const DRAWN_WINDOW: TimeDelta = TimeDelta::minutes(1);

/// The most characters of a description that a preview shows.
const DESCRIPTION_LENGTH: usize = 200;

/// What a preview says of a repository that does not describe itself, before its name.
const REPOSITORY: &str = "A dashboard of the GitHub repository";

/// What a preview says of an organization that does not describe itself, before its name.
const ORGANIZATION: &str = "A dashboard of the GitHub organization";

/// What a preview says of a user who does not describe themselves, before their login.
const USER: &str = "A dashboard of the GitHub user";

pub struct Previews {
    cache: Arc<Cache>,
    /// Where BuhTig is reached, which a preview's URL starts with.
    public_url: Url,
}

#[derive(Debug, PartialEq)]
pub struct Preview {
    /// The resource's name as GitHub spells it, such as `owner/repo` or `org`.
    title: String,
    description: String,
    /// The URL of the dashboard's tab, with the names as GitHub spells them (FR-NAV-04).
    url: Url,
    /// The URL of the resource's card as PNG (FR-NAV-07), with the names as the page's URL
    /// spells them, which the shared cache holds what the card shows under.
    image: Url,
}

/// What the shared cache holds, fresh, of a dashboard's resource.
struct Known {
    /// Its name as GitHub spells it, such as `owner/repo` or `org`.
    name: String,
    /// What it says of itself, or else what a preview says of it.
    description: String,
    kind: Kind,
    /// What GitHub gave of it.
    data: Value,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Repository,
    Organization,
    User,
}

impl Previews {
    pub fn new(cache: Arc<Cache>, public_url: Url) -> Previews {
        Previews { cache, public_url }
    }

    /// The preview of the dashboard's tab at `path`, or `None` if `path` is no tab's own,
    /// or if the shared cache holds nothing fresh about its dashboard's resource. Each of a
    /// dashboard's tabs is previewed as the dashboard is, but for its URL.
    ///
    /// The names are GitHub's, from what it returned, so a repository that was renamed or
    /// transferred is previewed under its new name (FR-NAV-05).
    pub async fn of(&self, path: &str) -> Option<Preview> {
        let (dashboard, mut tab) = navigation::dashboard_at(path)?;
        let known = self.known(&dashboard).await?;
        if known.kind == Kind::User {
            // A user's tabs are all at their own path, as on GitHub.
            tab = Tab::Overview;
        }
        let url = self
            .public_url
            .join(&tab.path(&format!("/{}", known.name)))
            .ok()?;
        let image = self
            .public_url
            .join(&format!("/-/preview{}.png", dashboard.path()))
            .ok()?;
        Some(Preview {
            title: known.name,
            description: known.description,
            url,
            image,
        })
    }

    /// The card of the dashboard's resource (FR-NAV-07): what the shared cache holds of it
    /// while it is fresh, as [`Previews::of`] reads it, or else its name alone, as
    /// `dashboard` spells it. It is looked for as `dashboard` spells it, and then in
    /// lowercase, as names are most often typed: GitHub's names ignore case, and all that
    /// the shared cache holds is public (FR-DATA-04). GitHub is never asked.
    pub async fn card(&self, dashboard: &Dashboard<'_>) -> Card {
        let lowercase = match dashboard {
            Dashboard::Repository { owner, repo } => {
                (owner.to_ascii_lowercase(), Some(repo.to_ascii_lowercase()))
            }
            Dashboard::Account { name } => (name.to_ascii_lowercase(), None),
        };
        let lowercase = match &lowercase {
            (owner, Some(repo)) => Dashboard::Repository { owner, repo },
            (name, None) => Dashboard::Account { name },
        };
        let mut found = None;
        for dashboard in [dashboard, &lowercase] {
            if let Some(known) = self.known(dashboard).await {
                found = Some((dashboard, known));
                break;
            }
            if lowercase == *dashboard {
                break;
            }
        }
        let Some((dashboard, known)) = found else {
            let name = dashboard.path()[1..].to_owned();
            return Card { name, facts: None };
        };
        let facts = self.facts(&dashboard.path(), &known).await;
        Card {
            name: known.name,
            facts: Some(facts),
        }
    }

    /// The host, and port if any, that BuhTig is reached at, as a card shows it.
    pub fn host(&self) -> String {
        host(&self.public_url)
    }

    /// What the shared cache holds, fresh, of the dashboard's resource: what its dashboard
    /// reads first, which tells which kind of resource it is.
    async fn known(&self, dashboard: &Dashboard<'_>) -> Option<Known> {
        let own = dashboard.path();
        match dashboard {
            Dashboard::Repository { owner, repo } => {
                let data = self.read(&own, ["repos", owner, repo]).await?;
                let name = data
                    .get("full_name")
                    .and_then(Value::as_str)
                    .filter(|name| {
                        name.split_once('/').is_some_and(|(owner, repo)| {
                            is_account_name(owner) && is_repository_name(repo)
                        })
                    })?
                    .to_owned();
                let description =
                    text(&data, "description").unwrap_or_else(|| format!("{REPOSITORY} {name}."));
                Some(Known {
                    name,
                    description,
                    kind: Kind::Repository,
                    data,
                })
            }
            Dashboard::Account { name } => {
                // What an organization's dashboard reads, or else what an account's reads
                // first, which a user's dashboard reads too (FR-SRCH-06).
                let (data, about, kind) = match self.read(&own, ["orgs", name]).await {
                    Some(data) => (data, "description", Kind::Organization),
                    None => {
                        let data = self.read(&own, ["users", name]).await?;
                        // GitHub gives an organization's description as its `bio` here.
                        match data.get("type").and_then(Value::as_str) {
                            Some("Organization") => (data, "bio", Kind::Organization),
                            Some("User") => (data, "bio", Kind::User),
                            _ => return None,
                        }
                    }
                };
                let login = data
                    .get("login")
                    .and_then(Value::as_str)
                    .filter(|login| is_account_name(login))?
                    .to_owned();
                let undescribed = match kind {
                    Kind::User => USER,
                    _ => ORGANIZATION,
                };
                let description =
                    text(&data, about).unwrap_or_else(|| format!("{undescribed} {login}."));
                Some(Known {
                    name: login,
                    description,
                    kind,
                    data,
                })
            }
        }
    }

    /// What a card of `known`, the resource of the dashboard at `dashboard`, shows: what its
    /// dashboard's figures are, of what the shared cache holds fresh.
    async fn facts(&self, dashboard: &str, known: &Known) -> Facts {
        let count = |key| known.data.get(key).and_then(Value::as_u64);
        let mut facts = Facts {
            description: known.description.clone(),
            ..Facts::default()
        };
        let list = match known.kind {
            Kind::Repository => {
                facts.stars = count("stargazers_count");
                facts.forks = count("forks_count");
                facts.language = text(&known.data, "language");
                // Under the names GitHub gave, as the dashboard reads it.
                if let Some((owner, repo)) = known.name.split_once('/') {
                    let segments = ["repos", owner, repo, "stats", "commit_activity"];
                    facts.activity = self
                        .read(dashboard, segments)
                        .await
                        .as_ref()
                        .and_then(repositories::weeks)
                        .map(|weeks| {
                            weeks
                                .iter()
                                .map(|week| week.get("commits").and_then(Value::as_u64))
                                .collect::<Option<Vec<u64>>>()
                        })
                        .unwrap_or_default();
                }
                return facts;
            }
            // As the dashboards read them, by the names GitHub gave.
            Kind::Organization => github::Path::new(["orgs", &known.name, "repos"])
                .map(|path| path.query("sort", "pushed")),
            Kind::User => github::Path::new(["users", &known.name, "repos"])
                .map(|path| path.query("type", "owner").query("sort", "pushed")),
        };
        let Ok(list) = list else {
            return facts;
        };
        let limit = self.cache.org_repositories();
        let list = match self
            .cache
            .fresh_shared_list(dashboard, &list, limit, &REPOSITORY_FIELDS)
            .await
        {
            Ok(list) => list,
            Err(error) => {
                error!("cannot read a preview card's repositories: {error}");
                None
            }
        };
        if let Some(list) = list {
            let figures = organizations::figures(&list);
            let count = |key| figures.get(key).and_then(Value::as_u64);
            facts.repositories = count("repositories").map(|repositories| {
                let truncated = figures.get("truncated").and_then(Value::as_bool);
                (repositories, truncated == Some(true))
            });
            facts.stars = count("stars");
            facts.forks = count("forks");
            facts.language = text(&figures, "top_language");
        }
        facts
    }

    /// What the shared cache holds, fresh, for a dashboard's resource at `segments`.
    async fn read<'a>(
        &self,
        dashboard: &str,
        segments: impl IntoIterator<Item = &'a str>,
    ) -> Option<Value> {
        let resource = github::Path::new(segments).ok()?;
        match self.cache.fresh_shared(dashboard, &resource).await {
            Ok(data) => data,
            Err(error) => {
                error!("cannot read a link preview: {error}");
                None
            }
        }
    }
}

/// What serving cards takes (FR-NAV-07).
#[derive(Clone)]
pub struct Cards {
    /// What tells what cards show, unless there are no cards: in private mode, nothing is
    /// shown to visitors (FR-ACC-03), and no one else needs a card.
    previews: Option<Arc<Previews>>,
    /// How many PNG cards each client has had drawn lately.
    drawn: Arc<Throttle>,
}

impl Cards {
    pub fn new(previews: Option<Arc<Previews>>) -> Cards {
        Cards {
            previews,
            drawn: Arc::new(Throttle::new(DRAWN, DRAWN_WINDOW)),
        }
    }

    /// The card of `dashboard`'s resource, as `format`, for `client`.
    async fn serve(&self, dashboard: &Dashboard<'_>, format: Format, client: &Visitor) -> Response {
        let Some(previews) = &self.previews else {
            return StatusCode::NOT_FOUND.into_response();
        };
        let now = ChronoUtc::now();
        if format == Format::Png
            && let Err(until) = self.drawn.admit(client, now)
        {
            info!("turned a card away: too many drawn for one client in a minute");
            let seconds = (until - now).num_seconds().max(1);
            return (
                StatusCode::TOO_MANY_REQUESTS,
                [(header::RETRY_AFTER, HeaderValue::from(seconds))],
            )
                .into_response();
        }
        let svg = previews.card(dashboard).await.svg(&previews.host());
        let (content_type, body) = match format {
            Format::Svg => ("image/svg+xml; charset=utf-8", svg.into_bytes()),
            Format::Png => match card::png(svg).await {
                Ok(png) => ("image/png", png),
                Err(error) => {
                    error!("cannot draw a card: {error}");
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }
            },
        };
        (
            [
                (header::CONTENT_TYPE, content_type),
                // Asked again each time, so that no copy, such as a README's image proxy's,
                // shows a card for longer than the shared cache holds what it shows
                // (FR-ACC-07).
                (header::CACHE_CONTROL, "no-cache"),
            ],
            body,
        )
            .into_response()
    }
}

/// What a card is asked for as.
#[derive(Clone, Copy, PartialEq)]
enum Format {
    /// For READMEs and browsers.
    Svg,
    /// For chat tools, which take no SVG.
    Png,
}

/// The name in `file`, a card's, such as `name.svg` or `repo.png`, and the format asked
/// for.
fn card_file(file: &str) -> Option<(&str, Format)> {
    file.strip_suffix(".svg")
        .map(|name| (name, Format::Svg))
        .or_else(|| file.strip_suffix(".png").map(|name| (name, Format::Png)))
}

/// `/-/preview/{name}.svg` or `/-/preview/{name}.png`: the card of the dashboard of an
/// organization or a user (FR-NAV-07), as [`Previews::card`] tells it. 404 for anything
/// that names none, and in private mode.
pub async fn account_card(
    State(cards): State<Cards>,
    client: Visitor,
    Path(file): Path<String>,
) -> Response {
    match card_file(&file) {
        Some((name, format)) if is_account_name(name) => {
            cards
                .serve(&Dashboard::Account { name }, format, &client)
                .await
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `/-/preview/{owner}/{repo}.svg` or `.png`: the card of a repository's dashboard, as
/// [`account_card`] is an account's.
pub async fn repository_card(
    State(cards): State<Cards>,
    client: Visitor,
    Path((owner, file)): Path<(String, String)>,
) -> Response {
    match card_file(&file) {
        Some((repo, format)) if is_account_name(&owner) && is_repository_name(repo) => {
            let dashboard = Dashboard::Repository {
                owner: &owner,
                repo,
            };
            cards.serve(&dashboard, format, &client).await
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

impl Preview {
    /// The `<meta>` tags that chat tools read, Open Graph's and X's, each on a line of its
    /// own. Their values come from GitHub, so they are escaped (NFR-SEC-03).
    pub fn tags(&self) -> String {
        let alt = format!("{} {}", self.title, card::ON_BUHTIG);
        let (width, height) = (card::WIDTH.to_string(), card::HEIGHT.to_string());
        [
            ("name", "description", self.description.as_str()),
            ("property", "og:type", "website"),
            ("property", "og:site_name", "BuhTig"),
            ("property", "og:url", self.url.as_str()),
            ("property", "og:title", &self.title),
            ("property", "og:description", &self.description),
            ("property", "og:image", self.image.as_str()),
            ("property", "og:image:type", "image/png"),
            ("property", "og:image:width", &width),
            ("property", "og:image:height", &height),
            ("property", "og:image:alt", &alt),
            ("name", "twitter:card", "summary_large_image"),
        ]
        .iter()
        .map(|(attribute, key, value)| {
            format!(
                "<meta {attribute}=\"{key}\" content=\"{}\">\n",
                escape(value)
            )
        })
        .collect()
    }
}

/// The host of `url`, and its port if it has one.
fn host(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default();
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_owned(),
    }
}

/// The text of `data`'s member `key` as a preview shows it, if it has any.
fn text(data: &Value, key: &str) -> Option<String> {
    data.get(key)
        .and_then(Value::as_str)
        .map(summary)
        .filter(|text| !text.is_empty())
}

/// `text` on one line, with its control characters as spaces, and cut to
/// [`DESCRIPTION_LENGTH`] characters.
fn summary(text: &str) -> String {
    let line = text
        .split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if line.chars().count() <= DESCRIPTION_LENGTH {
        return line;
    }
    let mut cut: String = line.chars().take(DESCRIPTION_LENGTH - 1).collect();
    cut.truncate(cut.trim_end().len());
    cut.push('…');
    cut
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::http::HeaderMap;

    use super::*;
    use crate::cache::Viewer;
    use crate::config::{CacheConfig, DatabaseConfig, LimitsConfig, Secret};
    use crate::db;
    use crate::github::stub::{Stub, answer, client};
    use crate::test_cluster::cluster;
    use crate::visitors::Visitor;

    /// A stub GitHub with a few repositories and accounts, one renamed and some oddly
    /// described. Like GitHub, it ignores the case of names.
    fn github() -> Arc<Stub> {
        Stub::new(|request| {
            let long = "word ".repeat(100);
            match request.uri().path().to_ascii_lowercase().as_str() {
                "/repos/acme/widget" | "/repositories/42" => answer(
                    200,
                    &[],
                    r#"{"full_name": "Acme/Widget", "private": false,
                        "description": " <b>\"Widgets\" & 'more'</b>\n\tfor all ",
                        "stargazers_count": 12345, "forks_count": 1, "language": "Rust"}"#,
                ),
                "/repos/acme/widget/stats/commit_activity" => answer(
                    200,
                    &[],
                    r#"[{"total": 5, "week": 1700000000, "days": [0, 1, 1, 1, 1, 1, 0]},
                        {"total": 0, "week": 1699395200, "days": [0, 0, 0, 0, 0, 0, 0]},
                        {"total": 2, "week": 1700604800, "days": [0, 1, 1, 0, 0, 0, 0]}]"#,
                ),
                "/repos/acme/gadget" => answer(
                    301,
                    &[("location", "https://api.github.com/repositories/42")],
                    r#"{"message": "Moved Permanently"}"#,
                ),
                "/repos/acme/plain" => answer(
                    200,
                    &[],
                    r#"{"full_name": "Acme/plain", "private": false, "description": null}"#,
                ),
                "/repos/acme/blank" => answer(
                    200,
                    &[],
                    r#"{"full_name": "Acme/blank", "private": false, "description": " \n "}"#,
                ),
                "/repos/acme/long" => answer(
                    200,
                    &[],
                    &format!(r#"{{"full_name": "Acme/long", "description": "{long}"}}"#),
                ),
                "/repos/acme/odd" => answer(200, &[], r#"{"full_name": "../evil"}"#),
                // What GitHub would tell no visitor, and the shared cache keeps none of.
                "/repos/acme/secret" => answer(
                    200,
                    &[],
                    r#"{"full_name": "Acme/secret", "private": true, "description": "Ours."}"#,
                ),
                "/orgs/acme" => answer(
                    200,
                    &[],
                    r#"{"login": "Acme", "type": "Organization",
                        "description": "We make widgets, and more."}"#,
                ),
                "/orgs/acme/repos" => answer(
                    200,
                    &[],
                    r#"[{"name": "Widget", "stargazers_count": 10, "forks_count": 2,
                         "language": "Rust", "private": false, "visibility": "public"},
                        {"name": "gizmo", "stargazers_count": 5, "forks_count": 1,
                         "language": "Go", "private": false, "visibility": "public"},
                        {"name": "docs", "stargazers_count": 1, "forks_count": 0,
                         "language": "Rust", "private": false, "visibility": "public"}]"#,
                ),
                "/orgs/plain" => answer(
                    200,
                    &[],
                    r#"{"login": "Plain", "type": "Organization", "description": null}"#,
                ),
                "/users/acme" => answer(
                    200,
                    &[],
                    r#"{"login": "Acme", "type": "Organization", "bio": "We make widgets."}"#,
                ),
                "/users/plain" => answer(
                    200,
                    &[],
                    r#"{"login": "Plain", "type": "Organization", "bio": null}"#,
                ),
                "/users/octocat" => answer(
                    200,
                    &[],
                    r#"{"login": "octocat", "type": "User", "bio": "A cat."}"#,
                ),
                "/users/octocat/repos" => answer(
                    200,
                    &[],
                    r#"[{"name": "hello", "stargazers_count": 7, "forks_count": 1,
                         "language": "Ruby", "private": false, "visibility": "public"}]"#,
                ),
                "/users/quiet" => answer(
                    200,
                    &[],
                    r#"{"login": "Quiet", "type": "User", "bio": null}"#,
                ),
                "/users/robot" => answer(200, &[], r#"{"login": "robot", "type": "Bot"}"#),
                _ => answer(404, &[], r#"{"message": "Not Found"}"#),
            }
        })
    }

    /// Previews from a cache on a database of its own, in front of `stub`, that keeps data
    /// fresh for `ttl`.
    async fn previews(stub: &Arc<Stub>, ttl: Duration) -> (Previews, Arc<Cache>) {
        let cluster = cluster();
        let database = cluster.create_database();
        let db = db::connect(&DatabaseConfig {
            url: Secret::new(Url::parse(&cluster.url(&database)).unwrap()),
            max_connections: 5,
        })
        .await
        .unwrap();
        db::migrate(&db, crate::config::GITHUB_COM).await.unwrap();
        let cache = Arc::new(Cache::new(
            db,
            Arc::new(client(stub)),
            &CacheConfig {
                ttl,
                retention: Duration::from_secs(30 * 24 * 60 * 60),
            },
            &LimitsConfig {
                org_repositories: 1000,
                visitor_fetches_per_hour: 30,
            },
        ));
        let public_url = Url::parse("https://buhtig.example.com").unwrap();
        (Previews::new(cache.clone(), public_url), cache)
    }

    fn visitor() -> Viewer {
        Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ))
    }

    /// Reads what a visitor's dashboard at `dashboard` reads of `segments`, into the shared
    /// cache.
    async fn view(cache: &Cache, dashboard: &str, segments: &[&str]) {
        let path = github::Path::new(segments.iter().copied()).unwrap();
        cache.get(&visitor(), dashboard, &path).await.unwrap();
    }

    /// Reads the repositories that a visitor's dashboard at `dashboard` reads at `path`,
    /// into the shared cache, as an organization's or a user's does.
    async fn view_list(cache: &Cache, dashboard: &str, path: github::Path) {
        let limit = cache.org_repositories();
        cache
            .get_list_of(&visitor(), dashboard, &path, limit, &REPOSITORY_FIELDS)
            .await
            .unwrap();
    }

    /// The preview of `title`'s dashboard, served at `/{served}`.
    fn preview(served: &str, title: &str, description: &str) -> Option<Preview> {
        Some(Preview {
            title: title.to_owned(),
            description: description.to_owned(),
            url: Url::parse(&format!("https://buhtig.example.com/{title}")).unwrap(),
            image: Url::parse(&format!(
                "https://buhtig.example.com/-/preview/{served}.png"
            ))
            .unwrap(),
        })
    }

    const WIDGET: &str = "<b>\"Widgets\" & 'more'</b> for all";

    #[tokio::test]
    async fn repositories_are_previewed_with_their_text_escaped() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/Acme/Widget", &["repos", "Acme", "Widget"]).await;
        let description = "&lt;b&gt;&quot;Widgets&quot; &amp; &#39;more&#39;&lt;/b&gt; for all";
        assert_eq!(
            previews.of("/Acme/Widget").await.unwrap().tags(),
            format!(
                "<meta name=\"description\" content=\"{description}\">\n\
                 <meta property=\"og:type\" content=\"website\">\n\
                 <meta property=\"og:site_name\" content=\"BuhTig\">\n\
                 <meta property=\"og:url\" content=\"https://buhtig.example.com/Acme/Widget\">\n\
                 <meta property=\"og:title\" content=\"Acme/Widget\">\n\
                 <meta property=\"og:description\" content=\"{description}\">\n\
                 <meta property=\"og:image\" \
                 content=\"https://buhtig.example.com/-/preview/Acme/Widget.png\">\n\
                 <meta property=\"og:image:type\" content=\"image/png\">\n\
                 <meta property=\"og:image:width\" content=\"1200\">\n\
                 <meta property=\"og:image:height\" content=\"630\">\n\
                 <meta property=\"og:image:alt\" content=\"Acme/Widget on BuhTig\">\n\
                 <meta name=\"twitter:card\" content=\"summary_large_image\">\n"
            )
        );
    }

    /// Its URL is GitHub's spelling, but its image's is the page's, which the card's data is
    /// held under.
    #[tokio::test]
    async fn renamed_repositories_are_previewed_under_their_new_name() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/acme/gadget", &["repos", "acme", "gadget"]).await;
        assert_eq!(
            previews.of("/acme/gadget").await,
            preview("acme/gadget", "Acme/Widget", WIDGET)
        );
    }

    #[tokio::test]
    async fn organizations_are_previewed_from_what_their_dashboard_reads() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/acme", &["users", "acme"]).await;
        view(&cache, "/acme", &["orgs", "acme"]).await;
        view(&cache, "/plain", &["orgs", "plain"]).await;
        assert_eq!(
            previews.of("/acme").await,
            preview("acme", "Acme", "We make widgets, and more.")
        );
        assert_eq!(
            previews.of("/plain").await,
            preview(
                "plain",
                "Plain",
                "A dashboard of the GitHub organization Plain."
            )
        );
    }

    /// As an account's dashboard reads them first, before it knows which kind it is.
    #[tokio::test]
    async fn organizations_and_users_are_previewed() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        for name in ["acme", "octocat", "quiet", "robot"] {
            view(&cache, &format!("/{name}"), &["users", name]).await;
        }
        assert_eq!(
            previews.of("/acme").await,
            preview("acme", "Acme", "We make widgets.")
        );
        assert_eq!(
            previews.of("/octocat").await,
            preview("octocat", "octocat", "A cat.")
        );
        assert_eq!(
            previews.of("/quiet").await,
            preview("quiet", "Quiet", "A dashboard of the GitHub user Quiet.")
        );
        // A user's tabs are at their own path: an organization's paths lead there.
        assert_eq!(
            previews.of("/orgs/octocat/repositories").await,
            preview("octocat", "octocat", "A cat.")
        );
        // Neither an organization nor a user.
        assert_eq!(previews.of("/robot").await, None);
    }

    #[tokio::test]
    async fn tabs_are_previewed_as_their_dashboards_at_their_own_urls() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/acme/gadget", &["repos", "acme", "gadget"]).await;
        view(&cache, "/acme", &["orgs", "acme"]).await;
        let read = stub.urls();
        for (path, url) in [
            ("/acme/gadget/issues", "/Acme/Widget/issues"),
            (
                "/acme/gadget/graphs/contributors",
                "/Acme/Widget/graphs/contributors",
            ),
        ] {
            let mut expected = preview("acme/gadget", "Acme/Widget", WIDGET).unwrap();
            expected.url = Url::parse(&format!("https://buhtig.example.com{url}")).unwrap();
            assert_eq!(previews.of(path).await, Some(expected), "{path}");
        }
        let mut people = preview("acme", "Acme", "We make widgets, and more.").unwrap();
        people.url = Url::parse("https://buhtig.example.com/orgs/Acme/people").unwrap();
        assert_eq!(previews.of("/orgs/acme/people").await, Some(people));
        // Only a tab's own path is previewed: others lead there first.
        for path in [
            "/acme/gadget/pull/1",
            "/acme/gadget/Issues",
            "/orgs/acme/teams",
        ] {
            assert_eq!(previews.of(path).await, None, "{path}");
        }
        assert_eq!(stub.urls(), read);
    }

    #[tokio::test]
    async fn what_does_not_describe_itself_is_described() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        for repo in ["plain", "blank"] {
            view(&cache, &format!("/acme/{repo}"), &["repos", "acme", repo]).await;
        }
        view(&cache, "/plain", &["users", "plain"]).await;
        assert_eq!(
            previews.of("/acme/plain").await,
            preview(
                "acme/plain",
                "Acme/plain",
                "A dashboard of the GitHub repository Acme/plain."
            )
        );
        assert_eq!(
            previews.of("/acme/blank").await,
            preview(
                "acme/blank",
                "Acme/blank",
                "A dashboard of the GitHub repository Acme/blank."
            )
        );
        assert_eq!(
            previews.of("/plain").await,
            preview(
                "plain",
                "Plain",
                "A dashboard of the GitHub organization Plain."
            )
        );
    }

    #[tokio::test]
    async fn long_descriptions_are_cut() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/acme/long", &["repos", "acme", "long"]).await;
        let description = previews.of("/acme/long").await.unwrap().description;
        assert_eq!(description.chars().count(), 200, "{description}");
        assert!(description.ends_with(" word…"), "{description}");
    }

    #[tokio::test]
    async fn only_what_the_shared_cache_holds_is_previewed() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/acme/odd", &["repos", "acme", "odd"]).await;
        let read = stub.urls();
        for path in [
            "/Acme/Widget",
            "/acme",
            "/acme/odd",
            "/-/about",
            "/Acme/Widget/issues",
            "/",
        ] {
            assert_eq!(previews.of(path).await, None, "{path}");
        }
        assert_eq!(stub.urls(), read);
    }

    #[tokio::test]
    async fn stale_data_is_not_previewed() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::ZERO).await;
        view(&cache, "/Acme/Widget", &["repos", "Acme", "Widget"]).await;
        assert_eq!(previews.of("/Acme/Widget").await, None);
    }

    #[test]
    fn descriptions_are_one_line_without_control_characters() {
        assert_eq!(summary("  a\r\n\tb\u{0}c\u{7}\u{7f}  "), "a b c");
        assert_eq!(summary(&"é".repeat(200)), "é".repeat(200));
        assert_eq!(summary(&"é".repeat(201)), format!("{}…", "é".repeat(199)));
    }

    fn repository<'a>(owner: &'a str, repo: &'a str) -> Dashboard<'a> {
        Dashboard::Repository { owner, repo }
    }

    fn account(name: &str) -> Dashboard<'_> {
        Dashboard::Account { name }
    }

    fn unknown(name: &str) -> Card {
        Card {
            name: name.to_owned(),
            facts: None,
        }
    }

    /// FR-NAV-07: what a repository's dashboard shows, as GitHub names it, whether the card
    /// is asked for as the dashboard was opened or in another case.
    #[tokio::test]
    async fn repository_cards_show_what_the_shared_cache_holds() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/acme/widget", &["repos", "acme", "widget"]).await;
        let activity = ["repos", "Acme", "Widget", "stats", "commit_activity"];
        view(&cache, "/acme/widget", &activity).await;
        let read = stub.urls();
        let widget = Card {
            name: "Acme/Widget".to_owned(),
            facts: Some(Facts {
                description: WIDGET.to_owned(),
                repositories: None,
                stars: Some(12345),
                forks: Some(1),
                language: Some("Rust".to_owned()),
                // The oldest first.
                activity: Some(vec![0, 5, 2]),
            }),
        };
        for (owner, repo) in [("acme", "widget"), ("Acme", "Widget"), ("ACME", "widget")] {
            let card = previews.card(&repository(owner, repo)).await;
            assert_eq!(card, widget, "{owner}/{repo}");
        }
        assert_eq!(stub.urls(), read);
    }

    #[tokio::test]
    async fn renamed_repositories_have_cards_under_their_new_name() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/acme/gadget", &["repos", "acme", "gadget"]).await;
        let card = previews.card(&repository("acme", "gadget")).await;
        assert_eq!(card.name, "Acme/Widget");
        // Its commits were not read for its dashboard, so the card has none.
        assert_eq!(card.facts.unwrap().activity, None);
    }

    /// FR-NAV-07: what an organization's or a user's dashboard totals, without activity.
    #[tokio::test]
    async fn account_cards_total_their_repositories() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/acme", &["orgs", "acme"]).await;
        let acme = github::Path::new(["orgs", "Acme", "repos"]).unwrap();
        view_list(&cache, "/acme", acme.query("sort", "pushed")).await;
        view(&cache, "/octocat", &["users", "octocat"]).await;
        let octocat = github::Path::new(["users", "octocat", "repos"]).unwrap();
        let octocat = octocat.query("type", "owner").query("sort", "pushed");
        view_list(&cache, "/octocat", octocat).await;
        // Its repositories are not read.
        view(&cache, "/plain", &["orgs", "plain"]).await;
        let read = stub.urls();
        assert_eq!(
            previews.card(&account("acme")).await,
            Card {
                name: "Acme".to_owned(),
                facts: Some(Facts {
                    description: "We make widgets, and more.".to_owned(),
                    repositories: Some((3, false)),
                    stars: Some(16),
                    forks: Some(3),
                    language: Some("Rust".to_owned()),
                    activity: None,
                }),
            }
        );
        assert_eq!(
            previews.card(&account("octocat")).await,
            Card {
                name: "octocat".to_owned(),
                facts: Some(Facts {
                    description: "A cat.".to_owned(),
                    repositories: Some((1, false)),
                    stars: Some(7),
                    forks: Some(1),
                    language: Some("Ruby".to_owned()),
                    activity: None,
                }),
            }
        );
        assert_eq!(
            previews.card(&account("plain")).await,
            Card {
                name: "Plain".to_owned(),
                facts: Some(Facts {
                    description: "A dashboard of the GitHub organization Plain.".to_owned(),
                    ..Facts::default()
                }),
            }
        );
        assert_eq!(stub.urls(), read);
    }

    /// FR-NAV-07, FR-DATA-04: what is not in the shared cache, fresh, is not shown, and
    /// GitHub is not asked: the card has the name it was asked for, and nothing else.
    #[tokio::test]
    async fn cards_of_what_is_not_known_have_names_alone() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        // GitHub marks it private, so the shared cache keeps none of it, whatever the
        // visitor is answered.
        let secret = github::Path::new(["repos", "acme", "secret"]).unwrap();
        let _ = cache.get(&visitor(), "/acme/secret", &secret).await;
        view(&cache, "/robot", &["users", "robot"]).await;
        view(&cache, "/acme/odd", &["repos", "acme", "odd"]).await;
        let read = stub.urls();
        assert_eq!(
            previews.card(&repository("acme", "secret")).await,
            unknown("acme/secret")
        );
        assert_eq!(
            previews.card(&repository("Acme", "Widget")).await,
            unknown("Acme/Widget")
        );
        assert_eq!(previews.card(&account("robot")).await, unknown("robot"));
        assert_eq!(previews.card(&account("acme")).await, unknown("acme"));
        assert_eq!(
            previews.card(&repository("acme", "odd")).await,
            unknown("acme/odd")
        );
        assert_eq!(stub.urls(), read);
    }

    #[tokio::test]
    async fn stale_data_has_no_card() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::ZERO).await;
        view(&cache, "/acme/widget", &["repos", "acme", "widget"]).await;
        assert_eq!(
            previews.card(&repository("acme", "widget")).await,
            unknown("acme/widget")
        );
    }

    /// NFR-CAP-01: each client may have only so many cards drawn as PNG a minute. An SVG is
    /// not drawn.
    #[tokio::test]
    async fn clients_may_have_only_so_many_pngs_drawn() {
        let stub = github();
        let (previews, _) = previews(&stub, Duration::from_secs(15 * 60)).await;
        let cards = Cards {
            previews: Some(Arc::new(previews)),
            drawn: Arc::new(Throttle::new(1, DRAWN_WINDOW)),
        };
        let client = |address: &str| Visitor::of(address.parse().unwrap(), &HeaderMap::new());
        let (one, other) = (client("203.0.113.1"), client("203.0.113.2"));
        let acme = account("acme");
        let drawn = cards.serve(&acme, Format::Png, &one).await;
        assert_eq!(drawn.status(), StatusCode::OK);
        assert_eq!(drawn.headers()[header::CONTENT_TYPE], "image/png");
        let refused = cards.serve(&acme, Format::Png, &one).await;
        assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
        let after: i64 = refused.headers()[header::RETRY_AFTER]
            .to_str()
            .unwrap()
            .parse()
            .unwrap();
        assert!((1..=60).contains(&after), "{after}");
        let svg = cards.serve(&acme, Format::Svg, &one).await;
        assert_eq!(svg.status(), StatusCode::OK);
        assert_eq!(
            cards.serve(&acme, Format::Png, &other).await.status(),
            StatusCode::OK
        );
    }

    #[test]
    fn cards_show_where_buhtig_is() {
        for (url, shown) in [
            ("https://buhtig.example.com", "buhtig.example.com"),
            ("https://buhtig.example.com:8443", "buhtig.example.com:8443"),
            ("http://localhost:8080", "localhost:8080"),
        ] {
            assert_eq!(host(&Url::parse(url).unwrap()), shown, "{url}");
        }
    }
}
