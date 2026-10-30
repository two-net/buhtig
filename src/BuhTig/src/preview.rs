//! Link previews of dashboards (FR-NAV-06): the title and short description that chat
//! tools show for a link to `/{owner}/{repo}` or `/{org}`, or to one of their tabs, such as
//! `/{owner}/{repo}/issues`, which is previewed as its dashboard is. They read the page
//! without running its script, so BuhTig writes them into the page it serves.
//!
//! A preview tells only what the shared cache holds while it is fresh. That is public
//! (FR-DATA-04), and no older than what a visitor's dashboard shows (FR-ACC-07), so a
//! preview never holds private data. Serving the page never waits for GitHub either: a
//! dashboard that no one has opened within `cache.ttl` has no preview.

use std::sync::Arc;

use serde_json::Value;
use tracing::error;
use url::Url;

use crate::accounts::is_account_name;
use crate::cache::Cache;
use crate::github;
use crate::navigation::{self, Dashboard};
use crate::repositories::is_repository_name;

/// The most characters of a description that a preview shows.
const DESCRIPTION_LENGTH: usize = 200;

/// What a preview says of a repository that does not describe itself, before its name.
const REPOSITORY: &str = "A dashboard of the GitHub repository";

/// What a preview says of an organization that does not describe itself, before its name.
const ORGANIZATION: &str = "A dashboard of the GitHub organization";

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
        let (dashboard, tab) = navigation::dashboard_at(path)?;
        let own = dashboard.path();
        let (name, description, undescribed) = match dashboard {
            Dashboard::Repository { owner, repo } => {
                let data = self.read(&own, ["repos", owner, repo]).await?;
                let name = data
                    .get("full_name")
                    .and_then(Value::as_str)
                    .filter(|name| {
                        name.split_once('/').is_some_and(|(owner, repo)| {
                            is_account_name(owner) && is_repository_name(repo)
                        })
                    })?;
                (name.to_owned(), text(&data, "description"), REPOSITORY)
            }
            Dashboard::Organization { org } => {
                // What the dashboard reads, or else what the search box read before it
                // opened the dashboard (FR-SRCH-06).
                let (data, about) = match self.read(&own, ["orgs", org]).await {
                    Some(data) => (data, "description"),
                    None => {
                        let data = self.read(&own, ["users", org]).await?;
                        // Users have no dashboards (FR-SRCH-06).
                        if data.get("type").and_then(Value::as_str) != Some("Organization") {
                            return None;
                        }
                        // GitHub gives an organization's description as its `bio` here.
                        (data, "bio")
                    }
                };
                let login = data
                    .get("login")
                    .and_then(Value::as_str)
                    .filter(|login| is_account_name(login))?;
                (login.to_owned(), text(&data, about), ORGANIZATION)
            }
        };
        let url = self.public_url.join(&tab.path(&format!("/{name}"))).ok()?;
        Some(Preview {
            description: description.unwrap_or_else(|| format!("{undescribed} {name}.")),
            title: name,
            url,
        })
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

impl Preview {
    /// The `<meta>` tags that chat tools read, Open Graph's and X's, each on a line of its
    /// own. Their values come from GitHub, so they are escaped (NFR-SEC-03).
    pub fn tags(&self) -> String {
        [
            ("name", "description", self.description.as_str()),
            ("property", "og:type", "website"),
            ("property", "og:site_name", "BuhTig"),
            ("property", "og:url", self.url.as_str()),
            ("property", "og:title", &self.title),
            ("property", "og:description", &self.description),
            ("name", "twitter:card", "summary"),
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

/// `text` as an HTML attribute's value in double quotes.
fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            c => escaped.push(c),
        }
    }
    escaped
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
                        "description": " <b>\"Widgets\" & 'more'</b>\n\tfor all "}"#,
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
                "/orgs/acme" => answer(
                    200,
                    &[],
                    r#"{"login": "Acme", "type": "Organization",
                        "description": "We make widgets, and more."}"#,
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
        db::migrate(&db).await.unwrap();
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

    /// Reads what a visitor's dashboard at `dashboard` reads of `segments`, into the shared
    /// cache.
    async fn view(cache: &Cache, dashboard: &str, segments: &[&str]) {
        let visitor = Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ));
        let path = github::Path::new(segments.iter().copied()).unwrap();
        cache.get(&visitor, dashboard, &path).await.unwrap();
    }

    fn preview(title: &str, description: &str) -> Option<Preview> {
        Some(Preview {
            title: title.to_owned(),
            description: description.to_owned(),
            url: Url::parse(&format!("https://buhtig.example.com/{title}")).unwrap(),
        })
    }

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
                 <meta name=\"twitter:card\" content=\"summary\">\n"
            )
        );
    }

    #[tokio::test]
    async fn renamed_repositories_are_previewed_under_their_new_name() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/acme/gadget", &["repos", "acme", "gadget"]).await;
        assert_eq!(
            previews.of("/acme/gadget").await,
            preview("Acme/Widget", "<b>\"Widgets\" & 'more'</b> for all")
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
            preview("Acme", "We make widgets, and more.")
        );
        assert_eq!(
            previews.of("/plain").await,
            preview("Plain", "A dashboard of the GitHub organization Plain.")
        );
    }

    /// As the search box reads them, before it opens their dashboards.
    #[tokio::test]
    async fn organizations_are_previewed_and_users_are_not() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/acme", &["users", "acme"]).await;
        view(&cache, "/octocat", &["users", "octocat"]).await;
        assert_eq!(
            previews.of("/acme").await,
            preview("Acme", "We make widgets.")
        );
        assert_eq!(previews.of("/octocat").await, None);
    }

    #[tokio::test]
    async fn tabs_are_previewed_as_their_dashboards_at_their_own_urls() {
        let stub = github();
        let (previews, cache) = previews(&stub, Duration::from_secs(15 * 60)).await;
        view(&cache, "/acme/gadget", &["repos", "acme", "gadget"]).await;
        view(&cache, "/acme", &["orgs", "acme"]).await;
        let read = stub.urls();
        let widget = "<b>\"Widgets\" & 'more'</b> for all";
        for (path, url) in [
            ("/acme/gadget/issues", "/Acme/Widget/issues"),
            (
                "/acme/gadget/graphs/contributors",
                "/Acme/Widget/graphs/contributors",
            ),
        ] {
            let mut expected = preview("Acme/Widget", widget).unwrap();
            expected.url = Url::parse(&format!("https://buhtig.example.com{url}")).unwrap();
            assert_eq!(previews.of(path).await, Some(expected), "{path}");
        }
        let mut people = preview("Acme", "We make widgets, and more.").unwrap();
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
                "Acme/plain",
                "A dashboard of the GitHub repository Acme/plain."
            )
        );
        assert_eq!(
            previews.of("/acme/blank").await,
            preview(
                "Acme/blank",
                "A dashboard of the GitHub repository Acme/blank."
            )
        );
        assert_eq!(
            previews.of("/plain").await,
            preview("Plain", "A dashboard of the GitHub organization Plain.")
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
        assert_eq!(summary("  a\r\n\tb\u{0}c\u{7f}  "), "a b c");
        assert_eq!(summary(&"é".repeat(200)), "é".repeat(200));
        assert_eq!(summary(&"é".repeat(201)), format!("{}…", "é".repeat(199)));
    }
}
