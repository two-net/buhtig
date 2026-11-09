//! What a user's dashboard shows of the user: their header (FR-USER-01), with their login as
//! GitHub spells it (FR-NAV-04), and, as an organization's dashboard shows them, stat cards
//! (FR-USER-02), a repository table, languages, top repositories and activity charts
//! (FR-USER-04). The figures, the table and the charts are over the repositories that the
//! user owns and the viewer may see, at most `limits.org_repositories` of them, those pushed
//! to most recently (FR-USER-05).
//!
//! GitHub lists a user's private repositories to the user's own credentials alone, at a path
//! that names no one (`/user/repos`), and never among the repositories that it lists as
//! theirs to anyone. So a token user's own dashboard shows their private repositories too,
//! read with their PAT alone and kept in their private cache, and anyone else's shows
//! public ones only (FR-USER-06).
//!
//! The table's commit activity, and refreshing the dashboard, are as an organization's,
//! since they need only the account's name: see [`crate::organizations::commit_activity`] and
//! [`crate::organizations::refresh`].

use std::collections::HashSet;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use sea_orm::entity::prelude::ChronoUtc;
use serde_json::{Value, json};

use crate::accounts::is_account_name;
use crate::cache::{self, Cache, Outcome, Viewer};
use crate::github::{self, List};
use crate::organizations::{
    REPOSITORY_FIELDS, covered, figures, language_chart, login, pushes, table, time, top, website,
    years,
};
use crate::repositories::{Dating, data, denied, link, respond, stale, status, text};

/// `/-/api/users/{login}`: what the dashboard's header shows (FR-USER-01),
///
/// ```json
/// {"name": "octocat", "fetched_at": …, "stale": null | "held" | "github", "avatar_url": …,
///  "display_name": …, "bio": …, "company": …, "location": …, "website": …,
///  "created_at": …, "followers": 20, "following": 3}
/// ```
///
/// The name is the user's login as GitHub spells it, whatever case it was asked for in
/// (FR-NAV-04), and `display_name` the name they go by, if they give one. `fetched_at` and
/// `stale` are as for an organization's header ([`crate::organizations::summary`]), and so is
/// `website`, from what the user gives as theirs. `company` is what they write, which BuhTig
/// shows as text. What GitHub does not say, or says in a form BuhTig does not show, is
/// `null`, or 0 for a count: links are only to `http` and `https` URLs, and avatars only from
/// `https` ones (NFR-SEC-03). Nothing else of the profile is told, such as an email address
/// (DR-01).
///
/// 404 if there is no such account, or if it is an organization's, which has a dashboard of
/// its own. Names that cannot be an account's are 400, without asking GitHub (FR-SRCH-04).
/// Its other statuses are those of an organization's header.
pub async fn summary(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(name): Path<String>,
) -> Response {
    if !is_account_name(&name) {
        return status(StatusCode::BAD_REQUEST);
    }
    let result = read(&cache, &viewer, &name).await;
    if let Some(denied) = denied(&viewer, &result, cache.github_host()) {
        return denied;
    }
    let cached = match data(result) {
        Ok(cached) => cached,
        Err(code) => return status(code),
    };
    let data = &cached.data;
    let login = match user_login(data) {
        Ok(login) => login,
        Err(code) => return status(code),
    };
    let count = |key| data.get(key).and_then(Value::as_u64).unwrap_or(0);
    respond(json!({
        "name": login,
        "fetched_at": cached.fetched_at_iso(),
        "stale": stale(&cached),
        "avatar_url": link(data.get("avatar_url"), &["https"]),
        "display_name": text(data, "name"),
        "bio": text(data, "bio"),
        "company": text(data, "company"),
        "location": text(data, "location"),
        "website": website(data.get("blog")),
        "created_at": text(data, "created_at"),
        "followers": count("followers"),
        "following": count("following"),
    }))
}

/// `/-/api/users/{login}/stats`: what the dashboard's stat cards show (FR-USER-02), as for
/// an organization ([`crate::organizations::stats`]), over the repositories that the user owns and
/// the viewer may see: their private ones too if the viewer is the user, with a PAT
/// (FR-USER-06). `internal` is then 0, since only organizations have internal ones. A user
/// with more than `limits.org_repositories` repositories is figured over that many, those
/// pushed to most recently, and `truncated` then says so (FR-USER-05). `fetched_at` and
/// `stale` say when the repositories were fetched, as [`listed`] tells it.
///
/// Its statuses are those of [`summary`], since it reads the user first. A failure to read
/// their repositories is 502.
pub async fn stats(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(login): Path<String>,
) -> Response {
    match listed(&cache, viewer, &login).await {
        Ok((list, dating)) => respond(dating.apply(figures(&list))),
        Err(code) => status(code),
    }
}

/// `/-/api/users/{login}/repositories`: what the dashboard's repository table lists
/// (FR-USER-04), as for an organization ([`crate::organizations::repositories`]): the repositories
/// that [`stats`] figures over, pushed to most recently first.
///
/// Its statuses are those of [`stats`].
pub async fn repositories(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(login): Path<String>,
) -> Response {
    match listed(&cache, viewer, &login).await {
        Ok((list, dating)) => respond(covered(table(&list), &list, dating)),
        Err(code) => status(code),
    }
}

/// `/-/api/users/{login}/languages`: how many of the user's repositories have each primary
/// language (FR-USER-04), as for an organization ([`crate::organizations::languages`]).
///
/// Its statuses are those of [`stats`].
pub async fn languages(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(login): Path<String>,
) -> Response {
    match listed(&cache, viewer, &login).await {
        Ok((list, dating)) => respond(covered(language_chart(&list), &list, dating)),
        Err(code) => status(code),
    }
}

/// `/-/api/users/{login}/top-repositories`: the 10 of the user's repositories with the most
/// stars (FR-USER-04), as for an organization ([`crate::organizations::top_repositories`]).
///
/// Its statuses are those of [`stats`].
pub async fn top_repositories(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(login): Path<String>,
) -> Response {
    match listed(&cache, viewer, &login).await {
        Ok((list, dating)) => respond(covered(top(&list), &list, dating)),
        Err(code) => status(code),
    }
}

/// `/-/api/users/{login}/last-push`: how many of the user's repositories were last pushed to
/// in each period before now (FR-USER-04), as for an organization
/// ([`crate::organizations::last_push`]).
///
/// Its statuses are those of [`stats`].
pub async fn last_push(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(login): Path<String>,
) -> Response {
    match listed(&cache, viewer, &login).await {
        Ok((list, dating)) => respond(covered(pushes(&list, ChronoUtc::now()), &list, dating)),
        Err(code) => status(code),
    }
}

/// `/-/api/users/{login}/created-per-year`: how many of the user's repositories were created
/// in each year (FR-USER-04), as for an organization ([`crate::organizations::created_per_year`]).
///
/// Its statuses are those of [`stats`].
pub async fn created_per_year(
    State(cache): State<Arc<Cache>>,
    viewer: Viewer,
    Path(login): Path<String>,
) -> Response {
    match listed(&cache, viewer, &login).await {
        Ok((list, dating)) => respond(covered(years(&list, ChronoUtc::now()), &list, dating)),
        Err(code) => status(code),
    }
}

/// The repositories that the user `name` owns and the viewer may see, as many as BuhTig
/// reads, those pushed to most recently first, and when they were fetched, or the status that
/// says why there are none: those of [`summary`], since it reads the user first, or 502 if the
/// repositories cannot be read. Of two lists merged, they were fetched when the earlier was,
/// as [`Dating`] tells it.
///
/// Those that GitHub lists as the user's, to anyone, are public. If the viewer is the user,
/// with a PAT, their private ones are read too, as GitHub lists them to the user alone, and
/// the two lists are one ([`merged`]). Without them, as once GitHub rejects the PAT, the
/// public ones are all there is, as for anyone else.
async fn listed(cache: &Cache, viewer: Viewer, name: &str) -> Result<(List, Dating), StatusCode> {
    if !is_account_name(name) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let profile = data(read(cache, &viewer, name).await)?.data;
    let login = user_login(&profile)?;
    let dashboard = format!("/{name}");
    let limit = cache.org_repositories();
    // By the name GitHub gave, so that the list is cached once whatever case the dashboard
    // was opened in.
    let public = github::Path::new(["users", login, "repos"])
        .expect("an account name is neither empty nor dots")
        .query("type", "owner")
        .query("sort", "pushed");
    let public = cache.get_list_of(&viewer, &dashboard, &public, limit, &REPOSITORY_FIELDS);
    if !is_own(&viewer, &profile) {
        return data(public.await).map(|list| {
            let dating = Dating::of(&list);
            (list.data, dating)
        });
    }
    let private = github::Path::new(["user", "repos"])
        .expect("`user` is neither empty nor dots")
        .query("affiliation", "owner")
        .query("visibility", "private")
        .query("sort", "pushed");
    let private = cache.get_own_list_of(&viewer, &dashboard, &private, limit, &REPOSITORY_FIELDS);
    let (public, private) = tokio::join!(public, private);
    let public = data(public)?;
    let dating = Dating::of(&public);
    let public = public.data;
    let private = match private {
        // The PAT no longer sees them, or no longer works, so the viewer sees what anyone
        // does. A rejected PAT is marked invalid, for them to replace (FR-PAT-07).
        Err(cache::Error::GitHub(
            github::Error::BadCredentials
            | github::Error::NotFound
            | github::Error::Forbidden { .. }
            | github::Error::SsoRequired { .. },
        )) => return Ok((public, dating)),
        // Figures without them would be wrong, with no word of it: GitHub's failure is told
        // instead, as for any part of the dashboard.
        private => data(private)?,
    };
    let dating = dating.and(Dating::of(&private));
    Ok((merged(public, private.data, limit), dating))
}

/// The user `name` as the cache has it for the viewer: their public profile, the same for
/// everyone, read for their dashboard, and so shared but for a token user, as the account's
/// kind is read ([`crate::accounts::kind`]). `name` must be an account name.
async fn read(cache: &Cache, viewer: &Viewer, name: &str) -> Result<Outcome<Value>, cache::Error> {
    let path =
        github::Path::new(["users", name]).expect("an account name is neither empty nor dots");
    cache.get(viewer, &format!("/{name}"), &path).await
}

/// The user's login, as GitHub spells it: 404 if the account is no user's, such as an
/// organization's, and 502 if GitHub does not say.
fn user_login(profile: &Value) -> Result<&str, StatusCode> {
    match profile.get("type").and_then(Value::as_str) {
        Some("User") => login(profile).ok_or(StatusCode::BAD_GATEWAY),
        Some(_) => Err(StatusCode::NOT_FOUND),
        None => Err(StatusCode::BAD_GATEWAY),
    }
}

/// Whether the viewer is the user of `profile`, with a PAT: the same GitHub account, which
/// keeps its ID when its login changes.
fn is_own(viewer: &Viewer, profile: &Value) -> bool {
    match viewer {
        Viewer::TokenUser { github_id, .. } => {
            profile.get("id").and_then(Value::as_i64) == Some(*github_id)
        }
        Viewer::Visitor(_) | Viewer::SignedIn { .. } => false,
    }
}

/// A user's public and private repositories as one list, as GitHub would list them all to
/// the user: pushed to most recently first, and at most `limit` of them. Each list is in
/// GitHub's order, which is kept, and of repositories pushed to at the same time, the public
/// one comes first. One whose push GitHub does not tell comes last. A repository in both,
/// as one made public or private between the reads of the two, is there once, where it
/// comes first.
///
/// Each list holds the `limit` pushed to most recently, if it is truncated, so those of the
/// two together are among them. The whole is truncated if either is, or if there are more
/// than `limit` of them together (FR-USER-05).
fn merged(public: List, private: List, limit: usize) -> List {
    let mut truncated = public.truncated || private.truncated;
    let mut public = public.items.into_iter().peekable();
    let mut private = private.items.into_iter().peekable();
    let pushed = |item: &Value| time(item, "pushed_at");
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    loop {
        let from_private = match (public.peek(), private.peek()) {
            (None, None) => break,
            (Some(_), None) => false,
            (None, Some(_)) => true,
            (Some(public), Some(private)) => pushed(private) > pushed(public),
        };
        let next = if from_private {
            private.next()
        } else {
            public.next()
        };
        let Some(item) = next else { break };
        let name = text(&item, "name").map(str::to_ascii_lowercase);
        if name.is_none_or(|name| seen.insert(name)) {
            items.push(item);
        }
    }
    if items.len() > limit {
        items.truncate(limit);
        truncated = true;
    }
    List { items, truncated }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::body::Bytes;
    use axum::http::header::{self, AUTHORIZATION};
    use axum::http::{HeaderMap, Request};
    use sea_orm::entity::prelude::DateTimeUtc;
    use sea_orm::{
        ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    };
    use url::Url;

    use super::*;
    use crate::config::{CacheConfig, DatabaseConfig, LimitsConfig, Secret};
    use crate::db;
    use crate::entity::cache_entry::{self, Scope};
    use crate::entity::{credential, user};
    use crate::github::stub::{Stub, answer, client};
    use crate::test_cluster::cluster;
    use crate::visitors::Visitor;

    /// Mona's GitHub account ID, which her PAT is of.
    const MONA_ID: i64 = 583231;

    /// `Mona` as GitHub gives her, with all that her header shows, and what it does not.
    const MONA: &str = r#"{
        "login": "Mona",
        "id": 583231,
        "type": "User",
        "avatar_url": "https://avatars.githubusercontent.com/u/583231?v=4",
        "name": "Mona Lisa",
        "company": "@github",
        "blog": "mona.example",
        "location": "San Francisco",
        "email": "mona@example.com",
        "bio": "Octocat's best friend",
        "public_repos": 3,
        "followers": 1200,
        "following": 9,
        "created_at": "2011-01-25T18:44:36Z"
    }"#;

    /// A user with as little as GitHub gives, and some odd values.
    const BARE: &str = r#"{
        "login": "bare",
        "id": 2,
        "type": "User",
        "avatar_url": "http://avatars.example/bare.png",
        "name": "",
        "company": null,
        "blog": "javascript:alert(1)",
        "location": null,
        "bio": null,
        "created_at": "2026-10-20T08:00:00Z"
    }"#;

    /// Mona's repositories, as GitHub lists them as hers to anyone: public ones, pushed to
    /// most recently first.
    const MONAS: &str = r#"[
        {"name": "widget", "full_name": "Mona/widget", "private": false, "visibility": "public",
         "language": "Rust", "stargazers_count": 40, "forks_count": 4, "open_issues_count": 2,
         "pushed_at": "2026-10-20T08:00:00Z", "created_at": "2020-01-01T00:00:00Z"},
        {"name": "flipped", "full_name": "Mona/flipped", "private": false,
         "visibility": "public", "pushed_at": "2026-06-01T08:00:00Z"},
        {"name": "gadget", "full_name": "Mona/gadget", "private": false, "visibility": "public",
         "language": "Go", "stargazers_count": 2, "pushed_at": "2025-01-01T08:00:00Z"}
    ]"#;

    /// Mona's private repositories, as GitHub lists them to her own PAT alone.
    const MONAS_PRIVATE: &str = r#"[
        {"name": "diary", "full_name": "Mona/diary", "private": true, "visibility": "private",
         "language": "Rust", "stargazers_count": 0, "pushed_at": "2026-10-21T08:00:00Z"},
        {"name": "flipped", "full_name": "Mona/flipped", "private": true,
         "visibility": "private", "pushed_at": "2026-06-01T08:00:00Z"},
        {"name": "notes", "full_name": "Mona/notes", "private": true, "visibility": "private",
         "pushed_at": "2025-06-01T08:00:00Z"}
    ]"#;

    /// A stub GitHub with the users `Mona` and `bare`, the organization `Acme`, and a few odd
    /// answers. Like GitHub, it ignores the case of names. `/user/repos` is Mona's private
    /// repositories to her PAT, which `pat` is, and what a sign-in credential would get: a
    /// list of public ones, which no one else must be served.
    fn github() -> Arc<Stub> {
        Stub::new(|request: &Request<Bytes>| {
            let pat = request
                .headers()
                .get(AUTHORIZATION)
                .is_some_and(|value| value == "Bearer pat");
            match request.uri().path().to_ascii_lowercase().as_str() {
                "/users/mona" => answer(200, &[], MONA),
                "/users/bare" => answer(200, &[], BARE),
                "/users/acme" => answer(200, &[], r#"{"login": "Acme", "type": "Organization"}"#),
                "/users/nameless" => answer(200, &[], r#"{"type": "User"}"#),
                "/users/typeless" => answer(200, &[], r#"{"login": "typeless"}"#),
                "/users/broken" => answer(500, &[], r#"{"message": "Server Error"}"#),
                "/users/mona/repos" => answer(200, &[], MONAS),
                "/users/bare/repos" => answer(200, &[], "[]"),
                "/user/repos" if pat => answer(200, &[], MONAS_PRIVATE),
                "/user/repos" => answer(200, &[], r#"[{"name": "someone", "private": false}]"#),
                _ => answer(404, &[], r#"{"message": "Not Found"}"#),
            }
        })
    }

    /// A cache on a database of its own, in front of `stub`, that lets each visitor make
    /// `visitor_fetches` dashboard loads an hour, and reads up to `limit` repositories.
    async fn cache(
        stub: &Arc<Stub>,
        visitor_fetches: u32,
        limit: u32,
    ) -> (Arc<Cache>, DatabaseConnection) {
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
            db.clone(),
            Arc::new(client(stub)),
            &CacheConfig {
                ttl: Duration::from_secs(15 * 60),
                retention: Duration::from_secs(30 * 24 * 60 * 60),
            },
            &LimitsConfig {
                org_repositories: limit,
                visitor_fetches_per_hour: visitor_fetches,
            },
        ));
        (cache, db)
    }

    /// The user with the GitHub account `github_id`, signed in with a PAT, `pat`, which
    /// their rows in the database are for.
    async fn token_user(db: &DatabaseConnection, github_id: i64) -> Viewer {
        let user = user::ActiveModel {
            github_id: Set(github_id),
            login: Set(format!("user{github_id}")),
            name: Set(None),
            avatar_url: Set(format!(
                "https://avatars.githubusercontent.com/u/{github_id}"
            )),
            created_at: Set(ChronoUtc::now()),
            last_sign_in_at: Set(ChronoUtc::now()),
            ..Default::default()
        }
        .insert(db)
        .await
        .unwrap();
        let pat = credential::ActiveModel {
            user_id: Set(user.id),
            kind: Set(credential::Kind::Pat),
            encrypted_value: Set(vec![1, 2, 3]),
            status: Set(Some(credential::PatStatus::Valid)),
            ..Default::default()
        }
        .insert(db)
        .await
        .unwrap();
        Viewer::TokenUser {
            user_id: user.id,
            github_id,
            credential_id: pat.id,
            pat: Secret::new("pat".to_owned()),
            sign_in: Secret::new("sign-in".to_owned()),
        }
    }

    fn visitor() -> Viewer {
        Viewer::Visitor(Visitor::of(
            "203.0.113.1".parse().unwrap(),
            &HeaderMap::new(),
        ))
    }

    /// What a dashboard asks about its user.
    #[derive(Clone, Copy, Debug)]
    enum Api {
        Summary,
        Stats,
        Repositories,
        Languages,
        TopRepositories,
        LastPush,
        CreatedPerYear,
    }

    /// Every part of a dashboard that is read under its user.
    const APIS: [Api; 7] = [
        Api::Summary,
        Api::Stats,
        Api::Repositories,
        Api::Languages,
        Api::TopRepositories,
        Api::LastPush,
        Api::CreatedPerYear,
    ];

    /// The status and body of the viewer's request to `api` for `login`, as JSON, `null` if
    /// there is none, and without the time of fetching, since it is the time the test ran.
    async fn ask_as(
        cache: &Arc<Cache>,
        viewer: &Viewer,
        api: Api,
        login: &str,
    ) -> (StatusCode, Value) {
        let state = State(cache.clone());
        let viewer = viewer.clone();
        let name = Path(login.to_owned());
        let response = match api {
            Api::Summary => summary(state, viewer, name).await,
            Api::Stats => stats(state, viewer, name).await,
            Api::Repositories => repositories(state, viewer, name).await,
            Api::Languages => languages(state, viewer, name).await,
            Api::TopRepositories => top_repositories(state, viewer, name).await,
            Api::LastPush => last_push(state, viewer, name).await,
            Api::CreatedPerYear => created_per_year(state, viewer, name).await,
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
        if let Some(fetched_at) = body.as_object_mut().unwrap().remove("fetched_at") {
            let text = fetched_at.as_str().unwrap();
            assert!(text.ends_with('Z') && text.len() == 24, "{text}");
            text.parse::<DateTimeUtc>().unwrap();
        }
        (status, body)
    }

    async fn ask(cache: &Arc<Cache>, api: Api, login: &str) -> (StatusCode, Value) {
        ask_as(cache, &visitor(), api, login).await
    }

    /// The names of the repositories in the table that `viewer` is shown of `login`.
    async fn names(cache: &Arc<Cache>, viewer: &Viewer, login: &str) -> Vec<String> {
        let (status, body) = ask_as(cache, viewer, Api::Repositories, login).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        body["repositories"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                format!(
                    "{} {}",
                    row["name"].as_str().unwrap(),
                    row["visibility"].as_str().unwrap()
                )
            })
            .collect()
    }

    fn list(items: &str, truncated: bool) -> List {
        List {
            items: serde_json::from_str(items).unwrap(),
            truncated,
        }
    }

    #[tokio::test]
    async fn the_header_shows_the_user_as_github_spells_them() {
        let stub = github();
        let (cache, _) = cache(&stub, 30, 1000).await;
        assert_eq!(
            ask(&cache, Api::Summary, "mona").await,
            (
                StatusCode::OK,
                json!({
                    "name": "Mona",
                    "stale": null,
                    "avatar_url": "https://avatars.githubusercontent.com/u/583231?v=4",
                    "display_name": "Mona Lisa",
                    "bio": "Octocat's best friend",
                    "company": "@github",
                    "location": "San Francisco",
                    "website": "https://mona.example/",
                    "created_at": "2011-01-25T18:44:36Z",
                    "followers": 1200,
                    "following": 9,
                })
            )
        );
        // What BuhTig does not show or link to is null, and a count GitHub does not tell, 0.
        assert_eq!(
            ask(&cache, Api::Summary, "bare").await,
            (
                StatusCode::OK,
                json!({
                    "name": "bare",
                    "stale": null,
                    "avatar_url": null,
                    "display_name": null,
                    "bio": null,
                    "company": null,
                    "location": null,
                    "website": null,
                    "created_at": "2026-10-20T08:00:00Z",
                    "followers": 0,
                    "following": 0,
                })
            )
        );
    }

    #[tokio::test]
    async fn the_header_reads_the_profile_that_the_accounts_kind_did() {
        let stub = github();
        let (cache, _) = cache(&stub, 30, 1000).await;
        let kind =
            crate::accounts::kind(State(cache.clone()), visitor(), Path("mona".to_owned())).await;
        assert_eq!(kind.status(), StatusCode::OK);
        assert_eq!(ask(&cache, Api::Summary, "mona").await.0, StatusCode::OK);
        assert_eq!(stub.urls(), ["https://api.github.com/users/mona"]);
    }

    #[tokio::test]
    async fn what_github_cannot_tell_is_not_an_answer() {
        let stub = github();
        let (cache, _) = cache(&stub, 30, 1000).await;
        for api in APIS {
            for (login, status) in [
                // An organization has a dashboard of its own.
                ("acme", StatusCode::NOT_FOUND),
                ("nobody", StatusCode::NOT_FOUND),
                ("broken", StatusCode::BAD_GATEWAY),
                ("nameless", StatusCode::BAD_GATEWAY),
                ("typeless", StatusCode::BAD_GATEWAY),
            ] {
                assert_eq!(
                    ask(&cache, api, login).await,
                    (status, Value::Null),
                    "{api:?} {login}"
                );
            }
            for login in ["", "-mona", "mona.com", "mo na", &"a".repeat(40)] {
                assert_eq!(
                    ask(&cache, api, login).await,
                    (StatusCode::BAD_REQUEST, Value::Null),
                    "{api:?} {login}"
                );
            }
        }
        // None of the repositories of what is not a user's were asked for.
        assert!(
            stub.urls().iter().all(|url| !url.contains("/repos")),
            "{:?}",
            stub.urls()
        );
    }

    #[tokio::test]
    async fn the_charts_are_over_the_users_own_repositories() {
        let stub = github();
        let (cache, _) = cache(&stub, 30, 1000).await;
        assert_eq!(
            ask(&cache, Api::Stats, "MONA").await,
            (
                StatusCode::OK,
                json!({
                    "repositories": 3, "private": 0, "internal": 0, "stars": 42, "forks": 4,
                    "open_issues_and_pull_requests": 2, "top_language": "Go", "truncated": false,
                    "stale": null,
                })
            )
        );
        let (status, top) = ask(&cache, Api::TopRepositories, "mona").await;
        assert_eq!(
            (status, top),
            (
                StatusCode::OK,
                json!({
                    "repositories": [{"name": "widget", "stars": 40}, {"name": "gadget", "stars": 2}],
                    "truncated": false,
                    "repositories_read": 3,
                    "stale": null,
                })
            )
        );
        for api in [Api::Languages, Api::LastPush, Api::CreatedPerYear] {
            assert_eq!(ask(&cache, api, "mona").await.0, StatusCode::OK, "{api:?}");
        }
        // The profile, as the URL spells the name, and the repositories that GitHub lists as
        // the user's, by the name it gave, once.
        assert_eq!(
            stub.urls(),
            [
                "https://api.github.com/users/MONA",
                "https://api.github.com/users/Mona/repos?type=owner&sort=pushed&per_page=100",
                "https://api.github.com/users/mona",
            ]
        );
    }

    #[tokio::test]
    async fn the_user_with_a_pat_sees_their_private_repositories_too() {
        let stub = github();
        let (cache, db) = cache(&stub, 30, 1000).await;
        let mona = token_user(&db, MONA_ID).await;
        assert_eq!(
            names(&cache, &mona, "mona").await,
            [
                "diary private",
                "widget public",
                "flipped public",
                "notes private",
                "gadget public"
            ]
        );
        let (_, stats) = ask_as(&cache, &mona, Api::Stats, "mona").await;
        assert_eq!(
            (stats["repositories"].as_u64(), stats["private"].as_u64()),
            (Some(5), Some(2))
        );
        // Her private ones, with her PAT alone, and kept for her alone.
        let private: Vec<_> = stub
            .requests()
            .into_iter()
            .filter(|(url, _)| url.starts_with("https://api.github.com/user/repos"))
            .map(|(url, headers)| (url, headers[AUTHORIZATION].to_str().unwrap().to_owned()))
            .collect();
        assert_eq!(
            private,
            [(
                "https://api.github.com/user/repos?affiliation=owner&visibility=private&sort=pushed&per_page=100".to_owned(),
                "Bearer pat".to_owned()
            )]
        );
        let shared = cache_entry::Entity::find()
            .filter(cache_entry::Column::Scope.eq(Scope::Shared.key()))
            .all(&db)
            .await
            .unwrap();
        assert!(shared.is_empty(), "{shared:?}");
    }

    #[tokio::test]
    async fn no_one_else_sees_the_users_private_repositories() {
        let stub = github();
        let (cache, db) = cache(&stub, 30, 1000).await;
        let someone = token_user(&db, 7).await;
        let signed_in = Viewer::SignedIn {
            user_id: 1,
            sign_in: Secret::new("sign-in".to_owned()),
        };
        for viewer in [visitor(), signed_in, someone] {
            assert_eq!(
                names(&cache, &viewer, "mona").await,
                ["widget public", "flipped public", "gadget public"],
                "{viewer:?}"
            );
        }
        assert!(
            stub.urls().iter().all(|url| !url.contains("/user/")),
            "{:?}",
            stub.urls()
        );
    }

    #[tokio::test]
    async fn once_github_rejects_the_pat_the_user_sees_what_anyone_does() {
        // Mona's PAT no longer works: her sign-in credential reads what is public, and
        // nothing about her alone.
        let stub = Stub::new(|request: &Request<Bytes>| {
            let pat = request.headers()[AUTHORIZATION] == "Bearer pat";
            match request.uri().path() {
                _ if pat => answer(401, &[], r#"{"message": "Bad credentials"}"#),
                "/users/mona" => answer(200, &[], MONA),
                "/users/Mona/repos" => answer(200, &[], MONAS),
                "/user/repos" => answer(200, &[], r#"[{"name": "someone", "private": false}]"#),
                _ => answer(404, &[], "{}"),
            }
        });
        let (cache, db) = cache(&stub, 30, 1000).await;
        let mona = token_user(&db, MONA_ID).await;
        assert_eq!(
            names(&cache, &mona, "mona").await,
            ["widget public", "flipped public", "gadget public"]
        );
        let sent: Vec<_> = stub
            .requests()
            .into_iter()
            .filter(|(url, _)| url.starts_with("https://api.github.com/user/repos"))
            .map(|(_, headers)| headers[AUTHORIZATION].to_str().unwrap().to_owned())
            .collect();
        assert_eq!(sent, ["Bearer pat"]);
        let keys: Vec<String> = cache_entry::Entity::find()
            .all(&db)
            .await
            .unwrap()
            .into_iter()
            .map(|entry| entry.resource_key)
            .collect();
        assert!(
            keys.iter().all(|key| !key.starts_with("/user/")),
            "{keys:?}"
        );
    }

    #[tokio::test]
    async fn the_users_private_repositories_github_cannot_tell_are_no_answer() {
        let stub = Stub::new(|request: &Request<Bytes>| match request.uri().path() {
            "/users/mona" => answer(200, &[], MONA),
            "/users/Mona/repos" => answer(200, &[], MONAS),
            _ => answer(500, &[], r#"{"message": "Server Error"}"#),
        });
        let (cache, db) = cache(&stub, 30, 1000).await;
        let mona = token_user(&db, MONA_ID).await;
        assert_eq!(
            ask_as(&cache, &mona, Api::Stats, "mona").await,
            (StatusCode::BAD_GATEWAY, Value::Null)
        );
    }

    #[tokio::test]
    async fn a_visitors_whole_dashboard_is_one_load() {
        let stub = github();
        // One load an hour.
        let (cache, _) = cache(&stub, 1, 1000).await;
        let kind =
            crate::accounts::kind(State(cache.clone()), visitor(), Path("mona".to_owned())).await;
        assert_eq!(kind.status(), StatusCode::OK);
        for api in APIS {
            assert_eq!(ask(&cache, api, "mona").await.0, StatusCode::OK, "{api:?}");
        }
        let activity = crate::organizations::commit_activity(
            State(cache.clone()),
            visitor(),
            Path(("mona".to_owned(), "widget".to_owned())),
        )
        .await;
        // GitHub has none for it here, but asking it was part of the same load.
        assert_eq!(activity.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            ask(&cache, Api::Summary, "bare").await.0,
            StatusCode::TOO_MANY_REQUESTS
        );
    }

    #[tokio::test]
    async fn users_with_more_repositories_than_the_limit_are_figured_over_the_latest() {
        let stub = github();
        let (cache, db) = cache(&stub, 30, 2).await;
        let (_, stats) = ask(&cache, Api::Stats, "mona").await;
        assert_eq!(
            (stats["repositories"].as_u64(), stats["truncated"].as_bool()),
            (Some(2), Some(true))
        );
        let mona = token_user(&db, MONA_ID).await;
        assert_eq!(
            names(&cache, &mona, "mona").await,
            ["diary private", "widget public"]
        );
    }

    #[test]
    fn the_two_lists_are_merged_as_github_would_list_them() {
        let public = r#"[
            {"name": "b", "pushed_at": "2026-10-20T00:00:00Z"},
            {"name": "Same", "pushed_at": "2026-10-10T00:00:00Z"},
            {"name": "d", "pushed_at": "2026-10-01T00:00:00Z"},
            {"name": "never"}
        ]"#;
        let private = r#"[
            {"name": "a", "pushed_at": "2026-10-21T00:00:00Z"},
            {"name": "same", "pushed_at": "2026-10-10T00:00:00Z"},
            {"name": "c", "pushed_at": "2026-10-05T00:00:00Z"},
            {"name": "hidden"}
        ]"#;
        let names = |list: &List| -> Vec<String> {
            list.items
                .iter()
                .map(|item| item["name"].as_str().unwrap().to_owned())
                .collect()
        };
        let all = merged(list(public, false), list(private, false), 10);
        assert_eq!(names(&all), ["a", "b", "Same", "c", "d", "never", "hidden"]);
        assert!(!all.truncated);

        // Cut to the limit, and truncated then, or if either list was.
        let cut = merged(list(public, false), list(private, false), 3);
        assert_eq!(
            (names(&cut), cut.truncated),
            (
                vec!["a".to_owned(), "b".to_owned(), "Same".to_owned()],
                true
            )
        );
        assert!(merged(list(public, true), list("[]", false), 10).truncated);
        assert!(merged(list("[]", false), list(private, true), 10).truncated);
        assert_eq!(
            merged(list("[]", false), list("[]", false), 10),
            List {
                items: vec![],
                truncated: false
            }
        );
    }
}
