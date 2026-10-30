//! Dashboards' URLs (SRS §4.2). A dashboard's path is its resource's on GitHub:
//! `/{owner}/{repo}` for a repository and `/{org}` for an organization (FR-NAV-01). Each of
//! its tabs is a page of its own, at the path of GitHub's page about the same: a
//! repository's `/{owner}/{repo}/activity`, `/issues`, `/pulls`, `/graphs/contributors` and
//! `/releases`, and an organization's `/orgs/{org}/repositories` and `/orgs/{org}/people`.
//! The dashboard's own path is its overview. The paths of GitHub's other pages about them
//! lead to the tab that shows the most of what they show, or else to the overview, so that
//! replacing `github.com` with BuhTig's host in a GitHub link opens the matching page
//! (FR-NAV-02).
//!
//! Only the path is looked at here, never GitHub. A dashboard switches its URL to the
//! names as GitHub spells them once it knows them (FR-NAV-04, FR-NAV-05).

use crate::accounts::is_account_name;
use crate::repositories::is_repository_name;

/// A dashboard, by the names in its path, in their case.
#[derive(Debug, PartialEq)]
pub enum Dashboard<'a> {
    Repository { owner: &'a str, repo: &'a str },
    Organization { org: &'a str },
}

impl Dashboard<'_> {
    /// The dashboard's own path, such as `/owner/repo` or `/org`, with the names as they
    /// are.
    pub fn path(&self) -> String {
        match self {
            Dashboard::Repository { owner, repo } => format!("/{owner}/{repo}"),
            Dashboard::Organization { org } => format!("/{org}"),
        }
    }
}

/// A tab of a dashboard: its overview, at the dashboard's own path, or a page beneath it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tab {
    Overview,
    /// A repository's commits and when they came.
    Activity,
    /// A repository's issues.
    Issues,
    /// A repository's pull requests.
    Pulls,
    /// A repository's contributors.
    Contributors,
    /// A repository's releases.
    Releases,
    /// An organization's repositories.
    Repositories,
    /// An organization's members.
    People,
}

impl Tab {
    /// The path of the tab's page on the dashboard whose own path is `dashboard`, such as
    /// `/owner/repo/issues` for `/owner/repo`, or `/orgs/org/people` for `/org`: GitHub's
    /// path for its page about the same, in GitHub's case.
    pub fn path(self, dashboard: &str) -> String {
        let beneath = match self {
            Tab::Overview => return dashboard.to_owned(),
            Tab::Repositories => return format!("/orgs{dashboard}/repositories"),
            Tab::People => return format!("/orgs{dashboard}/people"),
            Tab::Activity => "activity",
            Tab::Issues => "issues",
            Tab::Pulls => "pulls",
            Tab::Contributors => "graphs/contributors",
            Tab::Releases => "releases",
        };
        format!("{dashboard}/{beneath}")
    }
}

/// The dashboard and the tab whose own path `path` is, such as `/owner/repo/issues` or
/// `/org` (FR-NAV-01). `None` for any other path, including those that [`redirect`] leads
/// to a tab.
pub fn dashboard_at(path: &str) -> Option<(Dashboard<'_>, Tab)> {
    let (dashboard, tab) = page(path)?;
    (tab.path(&dashboard.path()) == path).then_some((dashboard, tab))
}

/// The page that `path` leads to when it is not that page's own path, such as
/// `/owner/repo/pulls` for `/owner/repo/pull/42`, `/owner/repo` for
/// `/owner/repo/tree/main`, `/org` for `/orgs/org/teams`, or `/owner/repo/issues` for
/// `/owner/repo/Issues/` (FR-NAV-02). `None` for a tab's own path, and for any path that
/// does not begin with names that can be GitHub's, such as BuhTig's own pages under `/-/`
/// (FR-NAV-03).
///
/// The names are kept as they are, in their case too, and the rest of the page's path is
/// in lowercase, as GitHub writes it. The names are checked, so the page returned is always
/// a path on BuhTig, never `//host` or the like. The path is looked at without
/// percent-decoding, since names need no encoding.
pub fn redirect(path: &str) -> Option<String> {
    let (dashboard, tab) = page(path)?;
    let own = tab.path(&dashboard.path());
    (own != path).then_some(own)
}

/// The dashboard and the tab that `path` is the path of, or leads to.
fn page(path: &str) -> Option<(Dashboard<'_>, Tab)> {
    // Empty segments come of a trailing slash, or of doubled ones.
    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    let first = segments.next()?;
    let second = segments.next();
    let rest: Vec<&str> = segments.collect();
    if first.eq_ignore_ascii_case("orgs")
        && let Some(org) = second
    {
        if !is_account_name(org) {
            return None;
        }
        // Only these two pages are tabs. Any other, such as `teams`, or anything beneath
        // them, leads to the organization's overview.
        let tab = match rest.as_slice() {
            [tab] if tab.eq_ignore_ascii_case("repositories") => Tab::Repositories,
            [tab] if tab.eq_ignore_ascii_case("people") => Tab::People,
            _ => Tab::Overview,
        };
        return Some((Dashboard::Organization { org }, tab));
    }
    if !is_account_name(first) {
        return None;
    }
    let Some(repo) = second else {
        return Some((Dashboard::Organization { org: first }, Tab::Overview));
    };
    // GitHub's URLs to clone a repository end in `.git`.
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    if !is_repository_name(repo) {
        return None;
    }
    Some((Dashboard::Repository { owner: first, repo }, tab(&rest)))
}

/// The tab of a repository's dashboard that shows the most of what GitHub's page at
/// `segments` beneath the repository shows, such as `["pull", "42"]`: the overview for a
/// page that no tab is about, such as its code at `["tree", "main"]`.
fn tab(segments: &[&str]) -> Tab {
    let Some(first) = segments.first() else {
        return Tab::Overview;
    };
    let is = |name: &str| first.eq_ignore_ascii_case(name);
    if is("graphs") {
        // Of GitHub's graphs, only the contributors' have a tab. The others chart activity.
        return match segments.get(1) {
            Some(graph) if graph.eq_ignore_ascii_case("contributors") => Tab::Contributors,
            _ => Tab::Activity,
        };
    }
    if is("activity") || is("commits") || is("commit") || is("pulse") {
        Tab::Activity
    } else if is("issues") {
        Tab::Issues
    } else if is("pulls") || is("pull") {
        Tab::Pulls
    } else if is("releases") || is("tags") {
        Tab::Releases
    } else {
        Tab::Overview
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deeper_paths_lead_to_the_repository() {
        for path in [
            "/owner/repo/tree/main/src",
            "/owner/repo/blob/main/README.md",
            "/owner/repo/wiki",
            "/owner/repo/wiki/Home",
            "/owner/repo/security",
            "/owner/repo/settings",
            "/owner/repo/",
            "/owner/repo.git",
            "/owner/repo.git/",
            "/owner//repo",
        ] {
            assert_eq!(redirect(path).as_deref(), Some("/owner/repo"), "{path}");
        }
        assert_eq!(
            redirect("/vercel/next.js/blob/canary/package.json").as_deref(),
            Some("/vercel/next.js")
        );
    }

    #[test]
    fn githubs_pages_lead_to_the_tab_that_shows_the_same() {
        for (tab, paths) in [
            (
                "/owner/repo/activity",
                &[
                    "/owner/repo/commits",
                    "/owner/repo/commits/main",
                    "/owner/repo/commits/main/src/lib.rs",
                    "/owner/repo/commit/a1b2c3d",
                    "/owner/repo/pulse",
                    "/owner/repo/pulse/monthly",
                    "/owner/repo/graphs",
                    "/owner/repo/graphs/commit-activity",
                    "/owner/repo/graphs/code-frequency",
                    "/owner/repo/activity/",
                    "/owner/repo/Activity",
                    "/owner/repo.git/commits",
                ][..],
            ),
            (
                "/owner/repo/issues",
                &[
                    "/owner/repo/issues/",
                    "/owner/repo/issues/42",
                    "/owner/repo/issues/new",
                    "/owner/repo/Issues",
                    "/owner/repo/ISSUES/7",
                    "/owner/repo.git/issues",
                ],
            ),
            (
                "/owner/repo/pulls",
                &[
                    "/owner/repo/pull/42",
                    "/owner/repo/pull/42/files",
                    "/owner/repo/pulls/",
                    "/owner/repo/pulls/octocat",
                    "/owner/repo/Pulls",
                ],
            ),
            (
                "/owner/repo/graphs/contributors",
                &[
                    "/owner/repo/graphs/contributors/",
                    "/owner/repo/Graphs/Contributors",
                    "/owner/repo/graphs/contributors/x",
                ],
            ),
            (
                "/owner/repo/releases",
                &[
                    "/owner/repo/releases/",
                    "/owner/repo/releases/tag/v1",
                    "/owner/repo/releases/latest",
                    "/owner/repo/tags",
                    "/owner/repo/tags/",
                    "/owner/repo/tags/v1",
                    "/owner/repo/Releases",
                ],
            ),
        ] {
            for path in paths {
                assert_eq!(redirect(path).as_deref(), Some(tab), "{path}");
            }
        }
    }

    #[test]
    fn organizations_paths_lead_to_the_organization() {
        for path in [
            "/orgs/acme",
            "/orgs/acme/",
            "/orgs/acme/teams",
            "/orgs/acme/projects/1",
            "/orgs/acme/repositories/extra",
            "/orgs/acme/people/alice",
            "/acme/",
            "//acme",
        ] {
            assert_eq!(redirect(path).as_deref(), Some("/acme"), "{path}");
        }
    }

    #[test]
    fn organizations_tabs_are_spelled_in_lowercase() {
        for (path, tab) in [
            ("/ORGS/acme/people", "/orgs/acme/people"),
            ("/orgs/acme/People/", "/orgs/acme/people"),
            ("/Orgs/acme/repositories", "/orgs/acme/repositories"),
            ("/orgs//acme/repositories/", "/orgs/acme/repositories"),
        ] {
            assert_eq!(redirect(path).as_deref(), Some(tab), "{path}");
        }
    }

    #[test]
    fn names_keep_their_case() {
        assert_eq!(
            redirect("/Owner/Repo/tree/main").as_deref(),
            Some("/Owner/Repo")
        );
        assert_eq!(
            redirect("/Owner/Repo/Issues").as_deref(),
            Some("/Owner/Repo/issues")
        );
        assert_eq!(redirect("/orgs/Acme/teams").as_deref(), Some("/Acme"));
        assert_eq!(
            redirect("/ORGS/Acme/People").as_deref(),
            Some("/orgs/Acme/people")
        );
    }

    #[test]
    fn dashboards_and_their_tabs_stay_where_they_are() {
        for path in [
            "/",
            "",
            "/acme",
            "/owner/repo",
            "/owner/repo/activity",
            "/owner/repo/issues",
            "/owner/repo/pulls",
            "/owner/repo/graphs/contributors",
            "/owner/repo/releases",
            "/Owner/Repo/issues",
            "/orgs/acme/repositories",
            "/orgs/acme/people",
            "/orgs/Acme/people",
            "/vercel/next.js",
            "/owner/.github",
            // An account's name, as far as BuhTig can tell.
            "/orgs",
        ] {
            assert_eq!(redirect(path), None, "{path}");
        }
    }

    #[test]
    fn buhtigs_own_pages_stay_where_they_are() {
        for path in [
            "/-",
            "/-/",
            "/-/about",
            "/-/settings/x/y",
            "/-/auth/callback",
        ] {
            assert_eq!(redirect(path), None, "{path}");
        }
    }

    #[test]
    fn dashboards_are_known_by_their_own_paths() {
        let repository = Dashboard::Repository {
            owner: "Owner",
            repo: "next.js",
        };
        assert_eq!(
            dashboard_at("/Owner/next.js"),
            Some((repository, Tab::Overview))
        );
        assert_eq!(
            dashboard_at("/acme"),
            Some((Dashboard::Organization { org: "acme" }, Tab::Overview))
        );
        for path in [
            "/",
            "",
            "/-/about",
            "/owner/repo/",
            "/owner/repo.git",
            "/owner/repo/pull/42",
            "/owner/repo/Issues",
            "/owner/repo/issues/",
            "/owner/repo/graphs",
            "/orgs/acme",
            "/orgs/acme/teams",
            "/ORGS/acme/people",
            "/orgs/acme/people/",
            "/evil.example/x",
        ] {
            assert_eq!(dashboard_at(path), None, "{path}");
        }
    }

    #[test]
    fn tabs_are_known_by_their_own_paths() {
        let widget = || Dashboard::Repository {
            owner: "Acme",
            repo: "Widget",
        };
        for (path, tab) in [
            ("/Acme/Widget/activity", Tab::Activity),
            ("/Acme/Widget/issues", Tab::Issues),
            ("/Acme/Widget/pulls", Tab::Pulls),
            ("/Acme/Widget/graphs/contributors", Tab::Contributors),
            ("/Acme/Widget/releases", Tab::Releases),
        ] {
            assert_eq!(dashboard_at(path), Some((widget(), tab)), "{path}");
            assert_eq!(tab.path("/Acme/Widget"), path);
        }
        for (path, tab) in [
            ("/orgs/Acme/repositories", Tab::Repositories),
            ("/orgs/Acme/people", Tab::People),
        ] {
            assert_eq!(
                dashboard_at(path),
                Some((Dashboard::Organization { org: "Acme" }, tab)),
                "{path}"
            );
            assert_eq!(tab.path("/Acme"), path);
        }
        assert_eq!(widget().path(), "/Acme/Widget");
        assert_eq!(Tab::Overview.path("/Acme/Widget"), "/Acme/Widget");
    }

    #[test]
    fn paths_that_are_not_names_lead_nowhere() {
        let long = format!("/{}/repo/issues", "a".repeat(40));
        for path in [
            "//evil.example/x/y",
            "/evil.example/x/y",
            "/orgs/evil.example/x",
            "/orgs/evil.example/people",
            "/owner/../x",
            "/owner/./x",
            "/owner/.git/x",
            "/owner/.git/issues",
            "/a%20b/c/d",
            "/owner/re%2Fpo/x",
            "/-owner/repo/x",
            &long,
        ] {
            assert_eq!(redirect(path), None, "{path}");
            assert_eq!(dashboard_at(path), None, "{path}");
        }
    }
}
