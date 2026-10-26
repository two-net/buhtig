//! What an organization's dashboard shows of the organization as a whole: its header
//! (FR-ORG-01), with its name as GitHub spells it (FR-NAV-04), its stat cards (FR-ORG-02)
//! and its repository table (FR-ORG-03). The figures and the table are over the
//! repositories that the viewer may see, private and internal ones too for a token user
//! (FR-ORG-09), and at most `limits.org_repositories` of them, those pushed to most
//! recently (FR-ORG-08).

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde_json::{Value, json};
use url::Url;

use crate::accounts::is_account_name;
use crate::cache::{Cache, Cached, Viewer};
use crate::github::{self, List};
use crate::repositories::{data, is_repository_name, link, respond, status, text, visibility};
use crate::visitors::Visitor;

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
/// organization, as for a user's account (FR-SRCH-06), or if it is private (FR-ACC-05).
///
/// Names that cannot be an account's are 400, without asking GitHub (FR-SRCH-04). Any other
/// status means that BuhTig cannot tell now. The dashboard then keeps its URL.
pub async fn summary(
    State(cache): State<Arc<Cache>>,
    visitor: Visitor,
    Path(org): Path<String>,
) -> Response {
    // Everyone is a visitor until sign-in is built (#22). A token user will then read with
    // their PAT (#23). The organization is read for its dashboard, so a visitor's load of
    // that counts once (FR-DATA-10).
    let viewer = Viewer::Visitor(visitor);
    let cached = match organization(&cache, &viewer, &org).await {
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
    visitor: Visitor,
    Path(org): Path<String>,
) -> Response {
    match listed(&cache, visitor, &org).await {
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
    visitor: Visitor,
    Path(org): Path<String>,
) -> Response {
    match listed(&cache, visitor, &org).await {
        Ok(list) => {
            let rows: Vec<Value> = list.items.iter().filter_map(row).collect();
            respond(json!({ "repositories": rows }))
        }
        Err(code) => status(code),
    }
}

/// The repositories of the organization `org` that the viewer may see, as many as BuhTig
/// reads, those pushed to most recently first, or the status that says why there are none:
/// those of [`summary`], since it reads the organization first, or 502 if the repositories
/// cannot be read.
async fn listed(cache: &Cache, visitor: Visitor, org: &str) -> Result<List, StatusCode> {
    // As in `summary`.
    let viewer = Viewer::Visitor(visitor);
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
    let path = github::Path::new(["orgs", org]).expect("an account name is neither empty nor dots");
    data(cache.get(viewer, &format!("/{org}"), &path).await)
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
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for &repository in repositories {
        if let Some(language) = text(repository, "language") {
            *counts.entry(language).or_default() += 1;
        }
    }
    counts
        .into_iter()
        .max_by(|(name, count), (other_name, other_count)| {
            count.cmp(other_count).then(other_name.cmp(name))
        })
        .map(|(name, _)| name)
}

/// A repository as the repository table lists it, unless it has no repository's name.
fn row(repository: &Value) -> Option<Value> {
    let name = text(repository, "name").filter(|name| is_repository_name(name))?;
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
    use url::form_urlencoded;

    use super::*;
    use crate::config::{CacheConfig, DatabaseConfig, LimitsConfig, Secret};
    use crate::db;
    use crate::github::stub::{Stub, answer, client};
    use crate::test_cluster::cluster;

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

    /// A stub GitHub with the organizations `Acme`, `bare`, `odd` and `big`, which has more
    /// repositories than two pages of two, a user `octocat`, and a few odd answers. Like
    /// GitHub, it ignores the case of names in paths.
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
                "/orgs/bare/repos" => answer(200, &[], "[]"),
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
    }

    /// Every part of a dashboard that is read under its organization.
    const APIS: [Api; 3] = [Api::Summary, Api::Stats, Api::Repositories];

    /// The status and body of a visitor's request to `api` for `org`, as JSON, `null` if
    /// there is none, and without the time of fetching, since it is the time the test ran.
    async fn ask(cache: &Arc<Cache>, api: Api, org: &str) -> (StatusCode, Value) {
        let visitor = Visitor::of("203.0.113.1".parse().unwrap(), &HeaderMap::new());
        let name = Path(org.to_owned());
        let response = match api {
            Api::Summary => summary(State(cache.clone()), visitor, name).await,
            Api::Stats => stats(State(cache.clone()), visitor, name).await,
            Api::Repositories => repositories(State(cache.clone()), visitor, name).await,
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
    async fn the_table_and_the_stat_cards_read_the_repositories_once() {
        let stub = github();
        let cache = cache(&stub, 30, 1000).await;
        assert_eq!(ask(&cache, Api::Stats, "acme").await.0, StatusCode::OK);
        let (status, body) = ask(&cache, Api::Repositories, "Acme").await;
        assert_eq!(
            (status, body["repositories"].as_array().unwrap().len()),
            (StatusCode::OK, 5)
        );
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
        for api in [Api::Stats, Api::Repositories] {
            assert_eq!(
                ask(&cache, api, "unlisted").await.0,
                StatusCode::BAD_GATEWAY
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
}
