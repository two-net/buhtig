//! Dashboards' URLs (SRS §4.2). A dashboard's path is its resource's on GitHub:
//! `/{owner}/{repo}` for a repository and `/{org}` for an organization (FR-NAV-01). The
//! paths of GitHub's pages about them lead there too, so that replacing `github.com` with
//! BuhTig's host in a GitHub link opens the matching dashboard (FR-NAV-02).
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

/// The dashboard whose own path `path` is, such as `/owner/repo` or `/org` (FR-NAV-01).
/// `None` for any other path, including those that [`redirect`] leads to a dashboard.
pub fn dashboard_at(path: &str) -> Option<Dashboard<'_>> {
    if dashboard(path).as_deref() != Some(path) {
        return None;
    }
    // A dashboard's own path is `/` and one or two checked names.
    let mut names = path.strip_prefix('/')?.split('/');
    match (names.next(), names.next()) {
        (Some(owner), Some(repo)) => Some(Dashboard::Repository { owner, repo }),
        (Some(org), None) => Some(Dashboard::Organization { org }),
        _ => None,
    }
}

/// The dashboard that `path` leads to when it is not that dashboard's own path, such as
/// `/owner/repo` for `/owner/repo/pull/42` or `/org` for `/orgs/org/people` (FR-NAV-02).
/// `None` for a dashboard's own path, and for any path that does not begin with names that
/// can be GitHub's, such as BuhTig's own pages under `/-/` (FR-NAV-03).
///
/// The names are kept as they are, in their case too. They are checked, so the dashboard
/// returned is always a path on BuhTig, never `//host` or the like. The path is looked at
/// without percent-decoding, since names need no encoding.
pub fn redirect(path: &str) -> Option<String> {
    let dashboard = dashboard(path)?;
    (dashboard != path).then_some(dashboard)
}

/// The dashboard that `path` is the path of, or the path of a page beneath.
fn dashboard(path: &str) -> Option<String> {
    // Empty segments come of a trailing slash, or of doubled ones.
    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    let first = segments.next()?;
    let second = segments.next();
    if first.eq_ignore_ascii_case("orgs")
        && let Some(org) = second
    {
        return is_account_name(org).then(|| format!("/{org}"));
    }
    if !is_account_name(first) {
        return None;
    }
    let Some(repo) = second else {
        return Some(format!("/{first}"));
    };
    // GitHub's URLs to clone a repository end in `.git`.
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    is_repository_name(repo).then(|| format!("/{first}/{repo}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deeper_paths_lead_to_the_repository() {
        for path in [
            "/owner/repo/pull/42",
            "/owner/repo/tree/main/src",
            "/owner/repo/issues",
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
    fn organizations_paths_lead_to_the_organization() {
        for path in [
            "/orgs/acme",
            "/orgs/acme/",
            "/orgs/acme/repositories",
            "/ORGS/acme/people",
            "/acme/",
            "//acme",
        ] {
            assert_eq!(redirect(path).as_deref(), Some("/acme"), "{path}");
        }
    }

    #[test]
    fn names_keep_their_case() {
        assert_eq!(
            redirect("/Owner/Repo/issues").as_deref(),
            Some("/Owner/Repo")
        );
        assert_eq!(redirect("/orgs/Acme/teams").as_deref(), Some("/Acme"));
    }

    #[test]
    fn dashboards_stay_where_they_are() {
        for path in [
            "/",
            "",
            "/acme",
            "/owner/repo",
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
        assert_eq!(
            dashboard_at("/Owner/next.js"),
            Some(Dashboard::Repository {
                owner: "Owner",
                repo: "next.js"
            })
        );
        assert_eq!(
            dashboard_at("/acme"),
            Some(Dashboard::Organization { org: "acme" })
        );
        for path in [
            "/",
            "",
            "/-/about",
            "/owner/repo/",
            "/owner/repo.git",
            "/owner/repo/issues",
            "/orgs/acme",
            "/evil.example/x",
        ] {
            assert_eq!(dashboard_at(path), None, "{path}");
        }
    }

    #[test]
    fn paths_that_are_not_names_lead_nowhere() {
        let long = format!("/{}/repo/issues", "a".repeat(40));
        for path in [
            "//evil.example/x/y",
            "/evil.example/x/y",
            "/orgs/evil.example/x",
            "/owner/../x",
            "/owner/./x",
            "/owner/.git/x",
            "/a%20b/c/d",
            "/owner/re%2Fpo/x",
            "/-owner/repo/x",
            &long,
        ] {
            assert_eq!(redirect(path), None, "{path}");
        }
    }
}
