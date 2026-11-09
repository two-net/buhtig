# BuhTig — Software Requirements Specification

**Product:** BuhTig, a GitHub dashboard  
**Document:** Software Requirements Specification (SRS), version 1.0 — draft for review  
**Date:** 2026-10-20

> **Technology-neutral.** This SRS does not choose programming languages, frameworks, libraries, or hosting. The only technologies it names — PostgreSQL and the use of an ORM — are constraints taken from the product brief.

## Contents

- [1. Introduction](#1-introduction)
- [2. Overall description](#2-overall-description)
- [3. External interface requirements](#3-external-interface-requirements)
- [4. Functional requirements](#4-functional-requirements)
- [5. Data requirements](#5-data-requirements)
- [6. Non-functional requirements](#6-non-functional-requirements)
- [7. Acceptance scenarios](#7-acceptance-scenarios)
- [8. Out of scope](#8-out-of-scope)
- [9. Open issues](#9-open-issues)
- [Appendix A. Traceability to the brief](#appendix-a-traceability-to-the-brief)

---

## 1. Introduction

### 1.1 Purpose

This document specifies what BuhTig must do and the constraints it must respect. It is written for the people who will design, build, test, and operate BuhTig, and it is the reference for deciding when a release is complete.

### 1.2 Product scope

BuhTig turns a GitHub URL into an animated dashboard. On a minimalist, search-engine-style home page, a user pastes a repository URL (e.g., `https://github.com/owner/repo`) or an account URL, an organization's or a user's (e.g., `https://github.com/org`), into a single box and presses Enter. BuhTig then shows activity, contributors, languages, issues, pull requests, and releases at a glance.

Anyone can explore public repositories, organizations and users without an account. Signing in with GitHub adds personal features. A signed-in user may also add a personal access token, so that BuhTig can show the private repositories and organization data that token can see, and their own private repositories on their own dashboard. Alternatively, an operator can run the whole instance in private mode, where every page requires sign-in.

**Goals**

- **G1 — One step to insight.** Paste a URL, press Enter, see the dashboard.
- **G2 — Delightful, never in the way.** Purposeful animation that never slows anyone down or shuts anyone out.
- **G3 — Simple to run.** One application, one PostgreSQL database, one configuration file.
- **G4 — Safe with private data.** People see private data only when their own GitHub credentials allow it.

BuhTig is read-only: it never changes anything on GitHub. Its name is "GitHub" spelled backwards. BuhTig is an independent product, not affiliated with or endorsed by GitHub.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| Resource | A GitHub repository, organization or user that BuhTig can show a dashboard for. An organization or a user is an *account*. |
| Dashboard | The BuhTig page that visualizes one resource. |
| Visitor | Someone using BuhTig without signing in. |
| Signed-in user | Someone signed in to BuhTig with their GitHub account. |
| Token user | A signed-in user who has saved a valid personal access token. |
| Operator | The person or team who installs and runs a BuhTig instance. |
| PAT | Personal access token: a token a user creates on GitHub that lets an application call GitHub on their behalf. |
| Sign-in credential | The access token GitHub issues to BuhTig when a user signs in. |
| Shared cache | Cached GitHub data that contains only public information and may be served to anyone. |
| Private cache | Cached GitHub data fetched with a user's PAT, served only to that user. |
| Observation | What a repository's stat cards showed when BuhTig read them from GitHub, kept so that its dashboard can tell how they changed (FR-DATA-13). It belongs to a cache scope as the data it was made of does. |
| TTL | Time to live: how long cached data is considered fresh. |
| Auto-migration | Automatic creation and update of the database schema when BuhTig starts. |
| ORM | Object-relational mapper: the layer through which the application reads and writes the database. |
| Partitioning | Splitting one logical table across several physical tables or databases. BuhTig does not use it. |

### 1.4 References

- ISO/IEC/IEEE 29148, *Systems and software engineering — Life cycle processes — Requirements engineering* (structure of this SRS).
- GitHub Docs: REST and GraphQL APIs, OAuth apps, personal access tokens, and rate limits. <https://docs.github.com>
- W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*.

### 1.5 Conventions

- Every requirement has a unique ID and uses **shall**. Prefixes: `FR` functional, `NFR` non-functional, `UI` user interface, `IF` external interface, `CON` constraint, `A` assumption, `DR` data rule, `AC` acceptance scenario, `OI` open issue.
- Priorities use MoSCoW. **Must** means required for release. **Should** means expected; it may slip only with a documented reason. **Could** means if time allows. Items deliberately left out are listed in §8.
- `{owner}`, `{repo}`, and `{org}` are placeholders. Configuration keys are written `section.key` and defined in Table 4-3.

---

## 2. Overall description

### 2.1 Product perspective

BuhTig is a new, self-contained web application with exactly two runtime dependencies. GitHub supplies all displayed data and user identity. One PostgreSQL database holds all persistent state.

```
                         +---------------------+
                         |  Browser (UI only)  |
                         +---------------------+
                                    |
                                    | HTTPS
                                    v
+-------------+          +---------------------+           +--------------+
| config file | -------> |    BuhTig server    | --------> |    GitHub    |
|  (one file) | at start |  (one application)  |   HTTPS   | API, sign-in |
+-------------+          +---------------------+           +--------------+
                                    |
                                    | ORM
                                    v
                         +---------------------+
                         |     PostgreSQL      |
                         |  (all state, 1 DB)  |
                         +---------------------+
```

The browser talks only to BuhTig, except during sign-in, when it is redirected to GitHub and back. The BuhTig server makes every GitHub API call, so GitHub credentials never reach the browser. Housekeeping runs inside the same application, so there is no separate worker, queue, or cache server.

### 2.2 Product functions

- **Search:** one box that takes a repository, organization or user URL (§4.1, §4.2).
- **Dashboards:** animated views of a repository (§4.3), or of an organization or a user (§4.4).
- **Comparison:** two repositories, or two organizations or users, side by side (§4.14).
- **Accounts:** sign-in with GitHub (§4.5) and an optional personal access token (§4.6).
- **Access:** public and private access rules and modes (§4.7).
- **Personal shortcuts:** history and pinned dashboards (§4.8).
- **Data:** GitHub retrieval with caching in PostgreSQL, and observations of how repositories' figures change (§4.9).
- **Motion:** animation throughout the UI (§4.10).
- **Operation:** one config file, auto-migration, and a health check (§4.11–§4.13).

### 2.3 User classes

| Class | What they can access | Typical goal |
|---|---|---|
| Visitor | Public mode only. Dashboards of public repositories, organizations and users, with public data only. | Size up a project before using or contributing to it. |
| Signed-in user | Everything a visitor can, plus history, pins, and manual refresh. GitHub requests count against the user's own rate limit. Still public data only. | Keep an eye on projects they care about. |
| Token user | Everything a signed-in user can, plus private and internal repositories and organization data their PAT can access, and their own private repositories on their own dashboard. | Monitor their team's private repositories. |
| Operator | No in-app role. Controls the instance through the config file and the database. | Run BuhTig with minimal effort. |

### 2.4 Operating environment

- **Client:** the two latest major versions of Chrome, Edge, Firefox, and Safari, on desktop and mobile, at widths from 360 px.
- **Server:** one host (physical, virtual, or container) that can run the application, reach the database, and make outbound HTTPS requests to GitHub.
- **Database:** one PostgreSQL database on a major version still supported by the PostgreSQL project at release time (OI-04).
- **Network:** HTTPS is terminated in front of BuhTig by the hosting environment (A-06).

### 2.5 Design and implementation constraints

| ID | Constraint |
|---|---|
| CON-01 | **Technology-neutral.** Languages, frameworks, UI, chart and animation libraries, the ORM product, and hosting are design decisions. They are bounded by the constraints below. |
| CON-02 | **PostgreSQL only.** All persistent state lives in a single PostgreSQL database. |
| CON-03 | **ORM.** Application code accesses the database only through an ORM. The ORM's entity definitions are the single source of truth for the schema. Hand-written SQL is not used, and any unavoidable exception is documented in the code. |
| CON-04 | **Auto-migration.** The schema is created and updated automatically at startup (§4.12). There is no manual migration step, migration command, or separate migration job. |
| CON-05 | **No partitioning.** No table partitioning, sharding, or splitting data across databases. The expected volume (§5.3) fits comfortably in plain tables. |
| CON-06 | **Simple architecture.** One deployable application plus PostgreSQL, and nothing else: no separate cache server, message queue, search engine, worker service, object storage, or secret manager. A single instance is the norm; scaling out is not a goal. |
| CON-07 | **Single configuration file.** Every setting, including sensitive ones, comes from one file. No environment variables, `.env` files, secret stores, or vaults (§4.11). |
| CON-08 | **Read-only.** BuhTig never performs write operations on GitHub. |
| CON-09 | **One GitHub host.** An instance reads from, and signs users in through, one GitHub host: github.com by default, or the GitHub Enterprise Server host in `github.host` (Table 4-3). A database holds data from that host alone (FR-DB-11). |
| CON-10 | **Original branding.** The layout may echo Google's home page, but BuhTig uses its own wordmark and visual identity. It does not use Google's or GitHub's logos, marks, or trade dress. |

### 2.6 Assumptions and dependencies

| ID | Assumption or dependency |
|---|---|
| A-01 | "No secret" in the brief means **no separate secret mechanism**. Sensitive values (the GitHub OAuth client secret, the database password, and the encryption key) live in the single config file, protected by file permissions (OI-02). |
| A-02 | "Private and public" means: (a) public data can be viewed without signing in; (b) personal features and private data require sign-in; and (c) an operator can switch the whole instance to private mode, where every page requires sign-in (OI-03). |
| A-03 | Signing in only identifies the user and gives them their own GitHub rate limit. Access to private data comes only from the user's optional PAT, so BuhTig never asks for broad permissions at sign-in (OI-07). |
| A-04 | The operator registers BuhTig as an OAuth application on the GitHub host of CON-09, with the callback URL `{server.public_url}/-/auth/callback`. The operator copies its client ID and client secret into the config file. |
| A-05 | The operator provides a PostgreSQL server and a role allowed to create and alter tables in BuhTig's database. That database is either empty or does not exist yet, in which case BuhTig creates it (FR-DB-10) and the role must also be allowed to create databases (`CREATEDB`). |
| A-06 | TLS is terminated by the hosting environment (a reverse proxy, platform, or load balancer). BuhTig may listen on plain HTTP behind it. |
| A-07 | One application instance serves all users. Running a second instance against the same database is not a goal, but it must not corrupt data (FR-DB-06). |
| A-08 | BuhTig depends on GitHub's API and sign-in being available. GitHub's rate limits are far lower for unauthenticated requests than for authenticated ones, and they bound how many uncached dashboards visitors can load (§4.9). |

---

## 3. External interface requirements

### 3.1 User interface

BuhTig looks like GitHub, after its open-source Primer design system, so that its users feel at home. A visitor's home page is a hero around the search box. A signed-in user's home page lists their dashboards beside the search box. Every other page has a slim header with the wordmark on the left, then breadcrumbs, the search box and the account. Dashboards have tabs below the header, at the paths of the matching pages on GitHub. On every page, a command palette opens over it from the keyboard (FR-SRCH-12).

**Home page for visitors (wireframe)**

```
+-----------------------------------------------------------------------+
| BuhTig   About  Privacy                                    [ Sign in ] |
|                                                                       |
|                                BuhTig                                 |
|                 Every GitHub repository, at a glance                  |
|       +-----------------------------------------+ [Show dashboard]    |
|       | github.com/owner/repo or github.com/org |                     |
|       +-----------------------------------------+                     |
|          Try  owner/repo  owner/another  org/repo   [Surprise me]     |
|                                                                       |
|  Repository dashboards   Organization insights   Private when needed  |
| BuhTig   About   Privacy                    Not affiliated with GitHub |
+-----------------------------------------------------------------------+
```

**Home page for signed-in users (wireframe)**

```
+-----------------------------------------------------------------------+
| BuhTig                               [ Type / to open a dashboard ] (@) |
+-----------------+-------------------------------------+---------------+
| Top dashboards  | Home                                | Private repos |
| [Find a dash…]  | [ search box          ][Show dash.] | (token state) |
| * owner/repo    | Recently viewed on this BuhTig      | Keyboard      |
|   org           | +---------------------------------+ | shortcuts     |
|   owner/other   | | owner/repo        viewed 3m ago | |               |
|                 | +---------------------------------+ |               |
+-----------------+-------------------------------------+---------------+
```

**Repository dashboard (wireframe)**

```
+-----------------------------------------------------------------------+
| BuhTig  owner / repo                   [ github.com/owner/repo ]  (@) |
| Overview  Activity  Issues 12  Pull requests 3  Contributors 40  ... |
+-----------------------------------------------------------------------+
| (av) repo [Public]           Updated 4 min ago [Refresh] [Pin] [GitHub]|
+-------------------------------------------------+---------------------+
| Overview: Stars Forks Watching Issues PRs Release| About, topics,      |
|           issues and pull requests by state      | license, dates      |
| Commit activity (52 weeks)                       | Releases            |
| Recent commits                                   | Contributors        |
| Recent issues and pull requests                  | Languages           |
+-------------------------------------------------+---------------------+
```

| ID | Requirement | Priority |
|---|---|---|
| UI-01 | Every screen shall have one obvious primary action, generous whitespace, and a restrained palette. | Must |
| UI-02 | A visitor's home page shall center the BuhTig wordmark, the search box, and a primary "Show dashboard" button, with "Surprise me" (FR-SRCH-10) and repositories to try (FR-SRCH-11) below. A signed-in user's home page shall show the search box with their shortcuts beside it (FR-SRCH-08). The top-right corner shall hold "Sign in" or, when signed in, the user's avatar with a menu (Home, Settings, Sign out) that says whether BuhTig has a personal access token of theirs. | Must |
| UI-03 | The dashboard header shall show the wordmark (linking home), breadcrumbs of the resource, the search box pre-filled with the current resource, and "Sign in" or the avatar menu. Below it, the dashboard's tabs shall show how many items each has, once known. | Must |
| UI-04 | Page titles shall be "BuhTig" on the home page and "{owner}/{repo} · BuhTig", "{org} · BuhTig" or "{user} · BuhTig" on dashboards, and "{first} vs {second} · BuhTig" on comparisons (§4.14). | Must |
| UI-05 | Dashboard widgets shall sit in a main column with a sidebar, which collapses to one column below 1012 px. | Must |
| UI-06 | Large numbers shall be shown compactly (e.g., 12.3k) and dates relatively (e.g., "3 days ago"). Exact values shall appear on hover and focus. All numbers and dates shall be formatted for the browser's locale. | Must |
| UI-07 | Light and dark themes shall follow the operating system's preference. | Should |
| UI-08 | The visitor's home-page footer shall link to the About and Privacy pages and state that BuhTig is not affiliated with GitHub. | Should |

### 3.2 Software interfaces

| ID | Requirement | Priority |
|---|---|---|
| IF-01 | **GitHub API (REST and/or GraphQL), read-only,** at `github.api_url`. BuhTig shall handle pagination, rate-limit responses, statistics GitHub is still computing, redirects for renamed or transferred repositories, and "not found" answers for resources the caller cannot access. It shall follow pagination links and redirects only within that API. | Must |
| IF-02 | **GitHub sign-in** shall use the OAuth 2.0 web application flow on `github.host` and request the minimum permissions needed to identify the user (FR-AUTH-02). | Must |
| IF-03 | **PostgreSQL** shall be accessed only through the ORM, with connection settings taken only from the config file. | Must |

### 3.3 Communication interfaces

| ID | Requirement | Priority |
|---|---|---|
| IF-04 | Browsers shall reach BuhTig over HTTPS. `server.public_url` shall use `https://` unless its host is `localhost`. | Must |
| IF-05 | All requests to GitHub shall use HTTPS, and go to `github.host` and `github.api_url` alone. | Must |
| IF-06 | BuhTig's HTTP endpoints serve its own UI only, but for the cards of FR-NAV-07, whose URLs are stable so that they can be embedded elsewhere. They are not a supported public API in this release. | Must |

---

## 4. Functional requirements

### 4.1 Search

| ID | Requirement | Priority |
|---|---|---|
| FR-SRCH-01 | The home page shall provide a single input that accepts a GitHub repository, organization or user URL in any form listed in Table 4-1. | Must |
| FR-SRCH-02 | Parsing shall ignore surrounding whitespace, the letter case of the host, a `www.` prefix, the scheme (`http` or `https`), trailing slashes, a `.git` suffix, query strings, and fragments. | Must |
| FR-SRCH-03 | Pressing Enter or the primary button shall open the recognized resource's dashboard at its canonical URL (FR-NAV-01). | Must |
| FR-SRCH-04 | Before calling GitHub, BuhTig shall check names for allowed characters and length. The check shall be permissive enough to accept older names that predate GitHub's current naming rules. Input that fails shall produce an inline message and no navigation. | Must |
| FR-SRCH-05 | URLs on any host other than `github.host` shall be rejected with the message "BuhTig supports {github.host} URLs only.", such as "BuhTig supports github.com URLs only." | Must |
| FR-SRCH-06 | A name alone, such as `name`, may be an organization's or a user's. Its dashboard shall ask GitHub which, before it reads anything else, and then show the organization's dashboard or the user's (§4.4). | Must |
| FR-SRCH-07 | On desktop, the input shall be focused when the home page loads. Pressing `/` outside a text field shall focus it, and Esc shall clear it. | Should |
| FR-SRCH-08 | Signed-in users' home page shall list up to 12 shortcuts beside the input, which they can filter by name: pinned dashboards first, then recent ones (§4.8). | Should |
| FR-SRCH-09 | As the user types, the input shall show what it recognizes (e.g., "Repository · owner/repo", "Organization · org", "User · user", or "Account · name" for a name that may be either) or why the input is invalid. | Could |
| FR-SRCH-10 | A secondary "Surprise me" button shall open the dashboard of a random public repository from the shared cache. The button shall be hidden while that cache is empty. | Could |
| FR-SRCH-11 | The signed-in home page shall list up to 8 public repositories whose dashboards were opened on the instance lately, from the shared cache only, with their description, language, stars, forks and last push. The visitor's home page shall offer the first 3 to try. Neither shall call GitHub, nor show anything fetched with a PAT (FR-DATA-04). | Could |
| FR-SRCH-12 | On every page, `Ctrl+K`, or `⌘K` on Apple devices, even in a text field, shall open a command palette, and close it again: a modal dialog with one input that suggests, as the user types, the signed-in user's pins and recent dashboards (§4.8), then the public repositories of FR-SRCH-11, each once, those whose names best match what is typed first, even with letters left out, and the resource that the input names in any form of Table 4-1. That resource shall come first when the input is a repository or a URL, and last otherwise. ↑ and ↓ shall choose a suggestion, Enter or a click open it, and Esc close the palette, returning the focus to where it was. It shall not open over another dialog. It shall not call GitHub, and in private mode shall ask a visitor for nothing (FR-ACC-03). Its code shall not count against the home page's initial load (NFR-PERF-01). | Could |
| FR-SRCH-13 | After the resource, the search box and the palette shall take the name of one of its dashboard's tabs (FR-NAV-01), and open that tab. Its names are `overview`, `activity` or `commits`, `issues`, `pulls`, `prs` or `pull requests`, `contributors`, and `releases` or `tags` for a repository; `overview`, `repositories` or `repos`, and `people` or `members` for an organization, or an account named alone; and `overview` and `repositories` or `repos` for a user. Any beginning of a name that is one tab's alone shall do, such as `pu`. Any other shall produce an inline message that names the tabs, and no navigation. | Could |

**Table 4-1. Accepted input**

| Input | Recognized as |
|---|---|
| `https://github.com/owner/repo` | Repository `owner/repo` |
| `github.com/owner/repo.git`, `http://www.github.com/owner/repo/` | Repository `owner/repo` |
| `https://github.com/owner/repo/tree/main/src`, `…/pull/42`, `…/issues?q=bug` | Repository `owner/repo` (the deeper path is ignored) |
| `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo.git` | Repository `owner/repo` |
| `owner/repo` | Repository `owner/repo` |
| `https://github.com/name`, `github.com/name`, `name` | Account `name`: an organization or a user (FR-SRCH-06) |
| `https://github.com/orgs/org`, `…/orgs/org/repositories` | Organization `org` |
| `https://github.com/users/user`, `…/users/user/projects/1` | User `user` |
| `owner/repo pulls`, `github.com/owner/repo releases`, `owner/repo con` | Repository `owner/repo`, at its Pull requests, Releases or Contributors tab (FR-SRCH-13) |
| `org people`, `github.com/orgs/org repos`, `users/user repositories` | Account `org` at an organization's People tab; organization `org` at its Repositories tab; user `user` at their Repositories tab (FR-SRCH-13) |

In Table 4-1, `github.com` stands for `github.host` (CON-09): with GitHub Enterprise Server at `ghe.example.com`, `https://ghe.example.com/owner/repo` and `git@ghe.example.com:owner/repo.git` name repository `owner/repo`, and github.com's URLs are rejected (FR-SRCH-05).

### 4.2 Navigation and URLs

| ID | Requirement | Priority |
|---|---|---|
| FR-NAV-01 | Each dashboard shall have a stable, shareable URL that mirrors its GitHub path: `/{owner}/{repo}` for a repository, `/{org}` for an organization and `/{user}` for a user. Each tab shall have the URL of the matching page on GitHub: `/{owner}/{repo}/activity`, `/issues`, `/pulls`, `/graphs/contributors` and `/releases`, `/orgs/{org}/repositories` and `/orgs/{org}/people`, and `/{user}?tab=repositories`. | Must |
| FR-NAV-02 | Deeper paths under a dashboard URL shall redirect to the tab that shows the same, e.g. `/{owner}/{repo}/pull/42` to `/{owner}/{repo}/pulls`, `/commits` and `/pulse` to `/activity`, and `/tags` to `/releases`, and any other to the overview. Other paths of the form `/orgs/{org}/…` shall redirect to `/{org}`, and paths of the form `/users/{user}/…` to `/{user}`. A user's dashboard with any other `tab` shall switch to `/{user}`, and an organization's at `/{org}?tab=repositories` to `/orgs/{org}/repositories`. `/{user}/repositories` shall open the repository of that name if the user has one, and otherwise the user's Repositories tab. The query of GitHub's repository lists, at `/orgs/{org}/repositories` and `/{user}?tab=repositories`, shall show the same view of the Repositories tab (FR-ORG-03). Replacing `github.host` with BuhTig's host in any GitHub link therefore opens the matching dashboard. | Should |
| FR-NAV-03 | BuhTig's own pages shall live under the reserved prefix `/-/` (e.g., `/-/settings`, `/-/about`, `/-/privacy`, `/-/health`). This prefix cannot collide with GitHub account names, which never start with a hyphen. | Must |
| FR-NAV-04 | Canonical URLs shall use names exactly as GitHub returns them. Other letter cases shall redirect to the canonical form, keeping a repository list's query (FR-ORG-03). | Should |
| FR-NAV-05 | When GitHub reports that a repository was renamed or transferred, BuhTig shall follow the redirect and switch the browser to the new canonical URL. | Should |
| FR-NAV-06 | Dashboards of public resources shall include link-preview metadata (title, short description, and the resource's card of FR-NAV-07 as PNG for its image) so shared links unfurl in chat tools. Previews shall never contain private data. | Could |
| FR-NAV-07 | In public mode, BuhTig shall serve a card of each repository, organization and user at `/-/preview/{owner}/{repo}.svg` and `/-/preview/{account}.svg`, and as PNG for chat tools at `.png`: a picture in BuhTig's colors of the resource's name and description, and of its figures as its dashboard shows them. Of a repository, these are its stars, forks and primary language, and its commits per week over the last 52 weeks (FR-REPO-03); of an organization or a user, its repositories, their stars and forks, and the most-used primary language (FR-ORG-02, FR-USER-02). A card shall show only what the shared cache holds while it is fresh (FR-DATA-03, FR-DATA-04), and shall never call GitHub; otherwise, it shall show the name in its URL alone, and so reveal nothing about the resource (FR-ACC-05). Its response shall be revalidated on each use, so that no copy outlives what it shows (FR-ACC-07). In private mode, there shall be no cards. | Could |
| FR-NAV-08 | In public mode, the heads of the dashboards of public repositories, organizations and users shall offer "Share card", which shows the resource's card (FR-NAV-07) and the Markdown that embeds it, linked to the dashboard, and copies that Markdown. It shall not be offered for private or internal repositories. | Could |

### 4.3 Repository dashboard

| ID | Requirement | Priority |
|---|---|---|
| FR-REPO-01 | The header shall show the owner's avatar, `owner/repo`, the description, and a visibility badge (Public, Private, or Internal). It shall show badges for Archived, Template, and Fork, with a link from Fork to the parent's BuhTig dashboard. It shall also show topics, license, default branch, homepage link, creation and last-push dates, and an "Open on GitHub" link. | Must |
| FR-REPO-02 | Stat cards shall show stars, forks, watchers (notification subscribers, not stargazers), and the latest release tag with its date. Open issues and open pull requests shall be separate figures, because GitHub's own open-issue count includes pull requests. | Must |
| FR-REPO-03 | A commit-activity chart shall show commits per week to the default branch over the last 52 weeks. | Must |
| FR-REPO-04 | A languages chart shall show each language's share of the code, listing the top 8 and grouping the rest as "Other". | Must |
| FR-REPO-05 | A contributors widget shall list up to 10 top contributors by commit count. Each entry shall show the avatar, the login (linking to the GitHub profile), and the commit count. The Contributors tab shall say how many contributors there are, when GitHub says. | Must |
| FR-REPO-06 | The overview shall show open and closed issue counts, and open, merged, and closed-unmerged pull request counts, and list the 6 most recently updated issues and pull requests with state, author, and when each was last updated. The Issues and Pull requests tabs shall each show their counts and those of the 20 most recently updated that are of their kind. | Should |
| FR-REPO-07 | A recent-commits widget shall list the latest commits on the default branch, 5 on the overview and 10 on the Activity tab, with the first line of the message, the author's avatar and login, the age, and the short SHA. | Should |
| FR-REPO-08 | A releases widget shall list the 5 latest releases with tag, name, date and the branch or commit each was made from, marking the one GitHub calls the latest. The Releases tab shall say how many releases there are. | Should |
| FR-REPO-09 | Every widget shall have loading, empty, and error states. A failure in one widget shall not prevent the others from rendering. | Must |
| FR-REPO-10 | If GitHub is still computing a statistic, the widget shall show "Calculating on GitHub…" and retry automatically with increasing delays for up to 60 seconds. After that, it shall show an error with a retry action. | Must |
| FR-REPO-11 | An empty repository (no commits) shall render with empty states, not errors. | Must |
| FR-REPO-12 | Items that correspond to a GitHub page (contributor, commit, issue, pull request, release) shall link to that page. | Should |
| FR-REPO-13 | The Pull requests tab shall show, of the 100 pull requests updated last, the median time from opening to merging of those merged, and the merge ratio: the share of those merged or closed without merging that were merged. The Issues tab shall show the median age of the open issues among the 100 open issues and pull requests updated last. Each shall say how many items its figures are of. | Should |
| FR-REPO-14 | The Activity tab shall show how the 50 latest GitHub Actions workflow runs for pushes to the default branch fared: the pass rate of those that passed or failed (failure, timed out, or startup failure; cancelled, skipped, neutral and stale runs count as neither), the latest run's state as a badge in words and with an icon, linking to the run, and the average duration of completed runs. When GitHub will not list the runs to the viewer's credential, it shall say what the token needs. | Should |
| FR-REPO-15 | The Activity tab shall chart the lines added and deleted on the default branch in each of the last 52 weeks, additions up and deletions down from one baseline, with a summary sentence and its data as a table (NFR-UX-04). It shall handle a statistic GitHub is still computing as FR-REPO-10 says, and say so when GitHub does not compute it, as for repositories with 10,000 commits or more. | Should |
| FR-REPO-16 | The Releases tab shall show, over the 100 latest releases without drafts, the average time between one release and the next, how many are stable and how many pre-releases, and how many times their files were downloaded, and say how many releases these figures are of. | Should |
| FR-REPO-17 | The Activity tab shall show how the repository's stars, forks, open issues and open pull requests changed over 7, 30 or 90 days, as BuhTig observed them (FR-DATA-13), the 30 days first. For each figure, it shall show its change between the two observations that FR-DATA-14 picks, with the figure at each, and say when each was made. Where FR-DATA-14 gives no change, it shall say why, and show no change at all, never a zero: a repository observed once shall be said to have no earlier baseline. It shall chart each figure over the period's days since the first observation, leaving the days without an observation as gaps, neither drawn as zero nor joined across. It shall say on how many of the period's days there is an observation, that observations are made only as the dashboard is opened, and how long they are kept, and, of what was observed with the viewer's PAT, that it is theirs alone. It shall have a summary sentence and its data as a table, one row a day, the days without an observation said to be so (NFR-UX-04). | Should |
| FR-REPO-18 | Beside FR-REPO-17's figures, the Activity tab shall compare the commits to the default branch in as many whole weeks as the period, 1, 4 or 13, that have ended, with those in as many weeks before them, from the commit activity of FR-REPO-03, and say which weeks they are. It shall leave the comparison out while GitHub is still computing the commit activity, or when it gives too few weeks. | Could |

### 4.4 Organization and user dashboards

| ID | Requirement | Priority |
|---|---|---|
| FR-ORG-01 | The header shall show the avatar, display name, login, description, location, website, creation date, and an "Open on GitHub" link. It shall show a verified badge when GitHub reports the organization as verified. | Must |
| FR-ORG-02 | Stat cards shall show the number of repositories, total stars, total forks, total open issues and pull requests, and the most-used primary language. All figures shall be computed over the repositories the viewer can see. | Must |
| FR-ORG-03 | A repository list shall show each repository's name, badges, description, primary language, stars, forks, open issues and pull requests, last push, and its commits per week over the last 26 weeks as a sparkline. It shall be sortable by last push, name or stars, filterable by name, language, and type (public, private and internal, sources, forks, archived), and paginated at 25 per page. Its name search, type, language, order and page shall be in its URL's query, as on GitHub's lists: `q`, `type` (`public`, `private`, `source`, `fork` or `archived`), `language` (in any letter case), `sort` (`name` or `stargazers`) and `page` (from 1), each left out at its default, with any other parameter, such as a user's `tab=repositories`, kept. Opening, reloading, Back and Forward shall show what the URL says. A value the list does not know shall give its default, and a page past the last the last, once the list has loaded, in the URL too, in place. A language or type that none of the viewer's repositories has shall stay chosen, and match none. A new filter or order shall show the first page. Each filter, order or page chosen shall be a step of the browser's history, and what is typed in the search box one step. "Copy link" shall copy the URL of the list as shown, which carries nothing but these parameters, so that whoever opens it sees the list as their own credentials and cache scope give it (FR-ACC-06, FR-DATA-04). Each name shall open that repository's BuhTig dashboard. A sparkline shall be fetched only once its row is in view, and a visitor's sparklines shall count as one load of the organization's dashboard (FR-DATA-10). | Must |
| FR-ORG-04 | A languages chart shall show the number of repositories per primary language (top 8 plus "Other"). | Must |
| FR-ORG-05 | A top-repositories chart shall show the 10 repositories with the most stars, and the overview shall show the 6 with the most stars as cards, the 5 pushed to last, and the 8 topics of the most repositories. | Should |
| FR-ORG-06 | Activity charts shall show repositories grouped by last push (last 7 days, last 30 days, last 12 months, older) and the number of repositories created per year. | Should |
| FR-ORG-07 | A members widget shall show the number of members visible to the viewer and up to 24 member avatars linking to their GitHub profiles. | Could |
| FR-ORG-08 | If an organization has more repositories than `limits.org_repositories` (default 1,000), all figures shall be computed over the most recently pushed repositories up to that limit. The dashboard shall say so. | Must |
| FR-ORG-09 | For token users, the dashboard shall include private and internal repositories their PAT can access, marked with badges. For everyone else, it shall include public repositories only. | Must |
| FR-USER-01 | A user's dashboard header shall show the avatar, display name, login, bio, company, location, website, creation date, how many followers the user has and how many accounts they follow, and an "Open on GitHub" link. | Must |
| FR-USER-02 | Stat cards shall show the number of repositories, total stars, total forks, total open issues and pull requests, and the most-used primary language. All figures shall be computed over the repositories the user owns that the viewer can see. | Must |
| FR-USER-03 | A user's dashboard shall have two tabs: Overview, at `/{user}`, and Repositories, at `/{user}?tab=repositories` (FR-NAV-01). | Must |
| FR-USER-04 | The Repositories tab shall show the repository list of FR-ORG-03, and the overview the charts and lists of FR-ORG-04 to FR-ORG-06, over the user's repositories. Each sparkline shall count as one load of the user's dashboard (FR-DATA-10). | Must |
| FR-USER-05 | If a user owns more repositories than `limits.org_repositories`, all figures shall be computed over the most recently pushed repositories up to that limit. The dashboard shall say so. | Must |
| FR-USER-06 | GitHub lists a user's private repositories to that user alone. A token user's own dashboard shall therefore include their private repositories, marked with badges, and every other user's dashboard, for every viewer, public repositories only. | Must |
| FR-USER-07 | Users' dashboards shall be recorded in history and may be pinned (§4.8), refreshed (FR-DATA-07) and previewed (FR-NAV-06), as other dashboards. | Should |

### 4.5 Sign-in and sessions

| ID | Requirement | Priority |
|---|---|---|
| FR-AUTH-01 | Users shall sign in with their GitHub account. BuhTig shall have no passwords or sign-up form of its own. | Must |
| FR-AUTH-02 | Sign-in shall request only the minimum GitHub permissions needed to identify the user. It shall not request access to private repositories, private organization data, or any write permission. | Must |
| FR-AUTH-03 | The sign-in flow shall use a single-use, short-lived state value bound to the browser. Callbacks whose state does not match shall be rejected. | Must |
| FR-AUTH-04 | On first sign-in, BuhTig shall create a user record keyed by the GitHub user ID. On every sign-in, it shall refresh the login, display name, and avatar. | Must |
| FR-AUTH-05 | After sign-in, the user shall return to the BuhTig page they started from. | Should |
| FR-AUTH-06 | A session shall expire after `auth.session_idle_timeout` without use (default 7 days), and in any case after `auth.session_max_age` from sign-in (default 30 days). | Must |
| FR-AUTH-07 | Signing out shall invalidate the session on the server immediately. | Must |
| FR-AUTH-08 | When `access.allowed_users` is non-empty, only the listed GitHub logins (case-insensitive) may sign in. Anyone else shall see a "not allowed on this instance" page, and no session shall be created. | Must |
| FR-AUTH-09 | If GitHub rejects a user's sign-in credential (e.g., the user revoked BuhTig's access on GitHub), BuhTig shall end that user's sessions and ask them to sign in again. | Should |

### 4.6 Personal access token

| ID | Requirement | Priority |
|---|---|---|
| FR-PAT-01 | A signed-in user may save one PAT in Settings. A PAT shall never be required to use BuhTig. | Must |
| FR-PAT-02 | Before saving, BuhTig shall validate the PAT with GitHub. It shall reject the PAT if it is invalid or expired, or if it belongs to a GitHub account other than the signed-in user's. | Must |
| FR-PAT-03 | Every type of personal access token GitHub offers shall be accepted (at the time of writing, classic and fine-grained). | Must |
| FR-PAT-04 | After saving, BuhTig shall never display or return the PAT again. Settings shall show only its type, its last four characters, its scopes or permissions when GitHub reports them, its expiry date when known, and when it was last validated. | Must |
| FR-PAT-05 | The user shall be able to replace or remove the PAT at any time. Removal or replacement shall take effect immediately and delete the user's private cache, and what was observed with the PAT (FR-DATA-14). | Must |
| FR-PAT-06 | While a valid PAT is saved, every GitHub request made for that user shall use the PAT. Otherwise BuhTig shall use the sign-in credential. | Must |
| FR-PAT-07 | If GitHub rejects a saved PAT (revoked or expired), BuhTig shall mark it invalid, fall back to the sign-in credential, and show a banner asking the user to replace it. | Must |
| FR-PAT-08 | When GitHub denies access because an organization requires the PAT to be separately authorized or approved (e.g., for single sign-on), BuhTig shall say so and explain how to fix it. | Should |
| FR-PAT-09 | Settings shall explain what the PAT is used for and recommend a fine-grained, read-only token limited to the repositories needed. It shall link to GitHub's token settings. | Should |
| FR-PAT-10 | BuhTig shall show a reminder starting 7 days before a PAT's known expiry date. | Could |

### 4.7 Public and private access

**Table 4-2. Who can see what**

| Viewer | Public mode (default) | Private mode |
|---|---|---|
| Visitor | Home page and dashboards of public resources (public data only) | Sign-in, About, and Privacy pages only |
| Signed-in user | Public dashboards, plus history, pins, and refresh | Same as public mode |
| Token user | Everything above, plus private and internal resources their PAT can access | Same as public mode |

| ID | Requirement | Priority |
|---|---|---|
| FR-ACC-01 | The access mode shall be set by `access.mode`: `public` (default) or `private`. | Must |
| FR-ACC-02 | In public mode, visitors shall be able to use the home page and view dashboards of public repositories and organizations, limited to public data. Settings, history, pins, and refresh shall require sign-in. | Must |
| FR-ACC-03 | In private mode, every page and data request shall require sign-in, except the sign-in page and callback, the About and Privacy pages, the health check, and the static assets these need. Visitors shall be redirected to sign in and then returned to the page they requested. | Must |
| FR-ACC-04 | In both modes, private and internal repositories and private organization data shall be shown only to token users whose PAT gives them access on GitHub. | Must |
| FR-ACC-05 | GitHub answers "not found" both for missing resources and for private ones the caller cannot access, so BuhTig shall show one "Not found or private" page tailored to the viewer. Visitors get a sign-in prompt, and signed-in users without a PAT get an add-token prompt. Token users are told the resource does not exist or their PAT cannot access it. The page shall reveal nothing about the resource. | Must |
| FR-ACC-06 | Access decisions shall rest only on what GitHub returns for the viewer's own credentials. BuhTig shall never use one user's credentials, or data cached from them, to serve another user. | Must |
| FR-ACC-07 | A change in a user's GitHub permissions (e.g., removal from a repository) shall take effect in BuhTig within one cache TTL. | Must |
| FR-ACC-08 | Access shall be administered only through the config file. There is no administration UI. | Must |

### 4.8 Personal shortcuts

| ID | Requirement | Priority |
|---|---|---|
| FR-PERS-01 | For signed-in users, BuhTig shall record the 20 most recently viewed dashboards (resource and time only). | Should |
| FR-PERS-02 | Signed-in users shall be able to pin up to 12 dashboards and unpin them. Pins come first among the home-page shortcuts. | Should |
| FR-PERS-03 | Signed-in users shall be able to clear their history. | Should |
| FR-PERS-04 | After confirmation, signed-in users shall be able to delete all their BuhTig data from Settings: account, sessions, credentials, private cache, the observations made with their PAT, history, and pins. BuhTig shall explain that removing its access on GitHub is done in GitHub's settings, and link there. | Must |
| FR-PERS-05 | Signed-in users shall be able to reorder their pins. | Could |

### 4.9 GitHub data and caching

| ID | Requirement | Priority |
|---|---|---|
| FR-DATA-01 | The BuhTig server shall make all GitHub API calls. Browsers shall never call GitHub's API for BuhTig and shall never receive a GitHub credential. Avatar images may load directly from GitHub. | Must |
| FR-DATA-02 | BuhTig shall call GitHub with the PAT for token users and with the sign-in credential for other signed-in users. For visitors, it shall use no user credential, only the application credentials from the config file where GitHub accepts them for public data. | Must |
| FR-DATA-03 | Retrieved data shall be cached in PostgreSQL. Data younger than `cache.ttl` (default 15 minutes) shall be served without calling GitHub. | Must |
| FR-DATA-04 | Data fetched without a PAT shall go to the shared cache. Data fetched with a PAT shall go to that user's private cache and be served only to them. As a safeguard, no item GitHub marks as private or internal shall ever be stored in the shared cache. Data that GitHub gives about the viewer alone, such as their own private repositories, shall be fetched only with their PAT, never with their sign-in credential, and kept only in their private cache. | Must |
| FR-DATA-05 | When GitHub is unreachable, returns an error, or rate-limits a request, BuhTig shall serve the most recent cached data, even if expired, with a notice showing its age. If nothing is cached, it shall show an error state that includes when the rate limit resets, if known. | Must |
| FR-DATA-06 | Every dashboard shall show when its data was fetched (e.g., "Updated 4 min ago"). | Must |
| FR-DATA-07 | Signed-in users shall be able to refresh a dashboard on demand, at most once per minute per dashboard. | Should |
| FR-DATA-08 | Concurrent requests for the same uncached data in the same cache scope shall result in a single GitHub fetch. | Should |
| FR-DATA-09 | BuhTig shall use conditional requests where GitHub supports them, so that unchanged data costs as little of the rate limit as possible. | Should |
| FR-DATA-10 | Each visitor shall be limited to `limits.visitor_fetches_per_hour` (default 30) dashboard loads that need a GitHub fetch. Loads served from cache are not limited. A visitor who reaches the limit shall see a "Sign in to keep exploring" prompt. | Should |
| FR-DATA-11 | When less than 10% of the rate limit available for visitor requests remains, BuhTig shall serve visitors from cache only, with a sign-in prompt, until the limit resets. | Should |
| FR-DATA-12 | In-app housekeeping shall delete cache entries fetched more than `cache.retention` ago (default 30 days). | Must |
| FR-DATA-13 | Each time a repository's stat cards (FR-REPO-02) are made from data that GitHub gave or confirmed, none of it stale (FR-DATA-05), BuhTig shall record their stars, forks, open issues and open pull requests as an observation of the repository, with when GitHub gave or confirmed the repository and the count of its open pull requests. The observation shall be in the cache scope that data is in, with the PAT that fetched it (FR-DATA-04). BuhTig shall record none when the two are in different scopes, nor in the shared cache's scope for a repository that is not public. Each scope shall keep one observation of a repository a UTC day, the latest, by the repository's ID on GitHub, so that a renamed repository keeps its observations. BuhTig shall make no request to GitHub in order to observe a repository, such as for its past stargazers, and shall never fill in what it did not observe. In-app housekeeping shall delete observations made more than 90 days ago. | Should |
| FR-DATA-14 | BuhTig shall tell a viewer only the observations in the scope that its data of the repository is in, and only once GitHub has given or confirmed the repository to them within `cache.ttl`, never from older data served while GitHub fails or a visitor is held back (FR-DATA-05, FR-DATA-10), so that one who may no longer see it is told nothing of it (FR-ACC-07). No user shall be told what was observed with another user's PAT. The change over a period of P days shall be from the observation nearest to P days before the latest one, within a tenth of P and at least a day either way, the earlier of two as near, to the latest. Without such an observation, there is no change: BuhTig shall say whether the repository was observed only once, observed first after the period began, or not observed near its start. The observations made with a PAT shall be deleted with its private cache (FR-PAT-05, FR-PAT-07), those of a scope that GitHub no longer lets see a repository with its cache entry for the repository, and a user's with them (DR-04). | Should |

### 4.10 Animation

Motion is part of BuhTig's character, but it must feel fast and stay out of the way. All durations below are maximums.

| ID | Requirement | Priority |
|---|---|---|
| FR-ANIM-01 | The wordmark shall play a short entrance animation (≤ 800 ms) on the first home-page load of a browser session. | Should |
| FR-ANIM-02 | The search box shall lift with a soft shadow on hover and focus (≤ 200 ms). | Must |
| FR-ANIM-03 | When the user goes from home to a dashboard, the search box shall glide from the home page into the header while the dashboard fades in (≤ 400 ms). Moving between a dashboard's tabs shall play no entrance again. | Should |
| FR-ANIM-04 | Each widget shall show a skeleton placeholder with a shimmer until its data arrives. Widgets shall appear independently as their data arrives. | Must |
| FR-ANIM-05 | Stat-card numbers shall count up to their value when first shown (≤ 1 s). Assistive technology shall receive only the final value. | Must |
| FR-ANIM-06 | Charts shall animate in when first shown (bars grow, lines draw, segments sweep; ≤ 800 ms). Tooltips shall fade in on hover and focus. | Must |
| FR-ANIM-07 | Entry animations shall start when a widget scrolls into view and play once per page load, not on every data refresh. | Should |
| FR-ANIM-08 | List items and table rows shall enter with a short stagger (≤ 40 ms apart, ≤ 400 ms in total). | Could |
| FR-ANIM-09 | On invalid input, the search box shall give a brief horizontal shake (≤ 300 ms) alongside the inline message. | Could |
| FR-ANIM-10 | When the browser reports a reduced-motion preference, or `ui.animations` is `false`, motion shall be replaced by instant changes or short fades (≤ 150 ms). In that case there shall be no count-up, chart drawing, gliding, shimmer, or shake. | Must |
| FR-ANIM-11 | Animations shall never block input. Users can type, click, scroll, and navigate at any time without waiting for an animation to finish. | Must |

### 4.11 Configuration

| ID | Requirement | Priority |
|---|---|---|
| FR-CFG-01 | BuhTig shall read all settings from exactly one configuration file at startup. The file has a fixed default path that a command-line argument may override. Command-line arguments shall carry no other settings. | Must |
| FR-CFG-02 | BuhTig shall not read settings from environment variables, `.env` files, secret stores, vaults, or the database. This includes environment variables that database or HTTP client libraries read by default, such as PostgreSQL client or proxy variables. Value substitution such as `${VAR}` shall not be supported. | Must |
| FR-CFG-03 | At startup, a missing required key, an unknown key, or an invalid value shall stop BuhTig with a message naming the key and the problem. The message shall not echo sensitive values. | Must |
| FR-CFG-04 | Sensitive values (the credentials in `database.url`, `github.client_secret`, and `security.encryption_key`) shall never appear in logs, pages, or responses. | Must |
| FR-CFG-05 | Where the operating system exposes file permissions, BuhTig shall log a warning at startup if the config file is readable by accounts other than the one running BuhTig. | Should |
| FR-CFG-06 | Changes to the file shall take effect on restart. Hot reloading is not required. | Must |
| FR-CFG-07 | Every optional key shall have the default given in Table 4-3, so a minimal file contains only the five required keys. | Must |
| FR-CFG-08 | BuhTig shall ship with a commented example file that lists every key and its default. | Should |

**Table 4-3. Configuration keys**

| Key | Required | Default | Purpose |
|---|---|---|---|
| `server.public_url` | Yes | — | External base URL (e.g., `https://buhtig.example.com`), used for the sign-in callback and links. |
| `server.listen` | No | `0.0.0.0:8080` | Address and port BuhTig listens on. |
| `database.url` | Yes | — | PostgreSQL connection string, including credentials (sensitive). |
| `database.max_connections` | No | `10` | Maximum number of open database connections. |
| `github.client_id` | Yes | — | Client ID of BuhTig's GitHub OAuth registration (A-04). |
| `github.client_secret` | Yes | — | Client secret of that registration (sensitive). |
| `github.host` | No | `github.com` | The GitHub host that BuhTig reads from and signs users in through: github.com, or a GitHub Enterprise Server's host name (CON-09). |
| `github.api_url` | No | `https://api.github.com` for github.com, else `https://{github.host}/api/v3` | Base URL of GitHub's REST API on that host, over HTTPS (IF-05). |
| `github.proxy_url` | No | none | Outbound proxy for requests to GitHub, if the network requires one. |
| `security.encryption_key` | Yes | — | Random secret of at least 256 bits, used to encrypt stored GitHub credentials (sensitive; see DR-03). |
| `access.mode` | No | `public` | `public` or `private` (§4.7). |
| `access.allowed_users` | No | empty (anyone) | GitHub logins allowed to sign in (FR-AUTH-08). |
| `auth.session_idle_timeout` | No | `7d` | Session expiry after inactivity. |
| `auth.session_max_age` | No | `30d` | Absolute session lifetime. |
| `cache.ttl` | No | `15m` | How long cached GitHub data counts as fresh. |
| `cache.retention` | No | `30d` | When cached data is deleted. |
| `limits.org_repositories` | No | `1000` | Maximum number of repositories analyzed per organization or user. |
| `limits.visitor_fetches_per_hour` | No | `30` | Uncached dashboard loads per visitor per hour. |
| `ui.animations` | No | `true` | `false` turns off non-essential motion for everyone. |
| `log.level` | No | `info` | `debug`, `info`, `warn`, or `error`. |

### 4.12 Persistence and auto-migration

| ID | Requirement | Priority |
|---|---|---|
| FR-DB-01 | All persistent state (users, sessions, credentials, cache, observations, history, pins, schema version, and GitHub host) shall be stored in the one PostgreSQL database given in the config file. BuhTig shall keep no persistent state anywhere else, such as local files or other databases. | Must |
| FR-DB-02 | On every start, before accepting requests, BuhTig shall automatically bring the schema in line with the ORM data model. No manual step, separate tool, or separate job shall be needed. | Must |
| FR-DB-03 | Auto-migration shall be idempotent: starting a version whose schema is already up to date shall change nothing. | Must |
| FR-DB-04 | Auto-migration shall not destroy user data. It may add tables, columns, and indexes, but shall not drop or rename tables or columns holding users, credentials, observations, history, or pins. Cache tables may be emptied and rebuilt; observations, which cannot be fetched again, shall be kept. | Must |
| FR-DB-05 | If migration fails, BuhTig shall log the cause, exit with a non-zero status, and serve no requests. | Must |
| FR-DB-06 | If several BuhTig processes start against the same database, only one shall migrate at a time, and the others shall wait for it to finish. | Should |
| FR-DB-07 | BuhTig shall refuse to start, with a clear message, if its version is older than the schema in the database. Downgrades are not supported. | Should |
| FR-DB-08 | In-app housekeeping shall run at least hourly. It shall delete expired sessions, cache entries past retention (FR-DATA-12), observations made more than 90 days ago (FR-DATA-13), and history beyond 20 entries per user. | Must |
| FR-DB-09 | If the database becomes unreachable while BuhTig is running, BuhTig shall show a friendly error page and report itself unhealthy (FR-OPS-01). It shall recover automatically, without a restart, when the database returns. | Must |
| FR-DB-10 | If the database given in the config file does not exist, BuhTig shall create it at startup, before migrating, owned by the configured role. If several BuhTig processes start at once, they shall create it once between them, and all shall start. If BuhTig cannot create it, it shall log why, exit with a non-zero status, and serve no requests. | Should |
| FR-DB-11 | A database shall hold data from one GitHub host, since GitHub's user IDs and names mean something on one host alone (CON-09). BuhTig shall record `github.host` when it first migrates a database, or github.com for a database that an earlier release migrated. If `github.host` is another host at a later start, BuhTig shall refuse to start with a clear message that names `github.host`, and change nothing. | Must |

### 4.13 Operations

| ID | Requirement | Priority |
|---|---|---|
| FR-OPS-01 | `/-/health` shall return HTTP 200 when BuhTig is running and the database is reachable, and HTTP 503 otherwise. It shall reveal no configuration or internal details. | Must |
| FR-OPS-02 | Given an empty or not yet created database (FR-DB-10) and a valid config file, BuhTig shall start and be fully usable with no further setup. | Must |
| FR-OPS-03 | Upgrading shall require only replacing the application and restarting it; the schema migrates automatically. | Must |
| FR-OPS-04 | At the level set by `log.level`, BuhTig shall log startup (version, access mode, migration result), errors, and one line per request (method, path, status, duration). Logs shall never contain credentials, session identifiers, or OAuth codes. | Must |
| FR-OPS-05 | On shutdown, BuhTig shall stop accepting requests and let in-flight ones finish, waiting up to 10 seconds. | Should |

### 4.14 Comparison

A comparison shows two repositories, or two accounts, side by side, so that their figures can be read against each other. It is a page of BuhTig's own, not a dashboard: it reads the same data as the two dashboards, under the same rules.

| ID | Requirement | Priority |
|---|---|---|
| FR-CMP-01 | A comparison shall have a stable, shareable URL: `/-/compare/{owner1}/{repo1}...{owner2}/{repo2}` for two repositories and `/-/compare/{account1}...{account2}` for two accounts, each an organization or a user, of the same kind or not. Once BuhTig knows how GitHub spells both names, the browser shall switch to the URL that spells them so, as FR-NAV-04 says, and follow renamed or transferred repositories, as FR-NAV-05 says. Any other path under `/-/compare/`, such as a repository and an account, shall show the "Page not found" page. | Should |
| FR-CMP-02 | The heads of repository, organization and user dashboards shall offer "Compare with…", which asks for another resource in any form of Table 4-1 and opens the comparison of the two. It shall reject, with an inline message and no navigation, input that names no resource, a resource of the other kind (a repository for an account, or an account for a repository), and the dashboard's own resource. | Should |
| FR-CMP-03 | Stat cards shall show each figure of both: for two repositories, stars, forks, watchers, open issues, open pull requests and the latest release with its age (FR-REPO-02); for two accounts, repositories, stars, forks, open issues and pull requests, and the most-used primary language (FR-ORG-02, FR-USER-02). Each card shall mark which has more and by how much, or the newer release and by how much newer, or that both are the same, with an icon and text and not by color alone (NFR-UX-05), and shall say the same in a sentence to assistive technology. Of an account with more repositories than `limits.org_repositories`, it shall say so, as FR-ORG-08 does. | Should |
| FR-CMP-04 | Charts shall show both side by side, each against one scale shared by both: for two repositories, commits per week over the last 52 weeks (FR-REPO-03) and languages by share of the code (FR-REPO-04); for two accounts, repositories per primary language (FR-ORG-04), and repositories by last push and created per year (FR-ORG-06). A language shall have the same color on both sides. Each chart shall have one summary sentence about both and its data as a table with a column for each (NFR-UX-04). | Should |
| FR-CMP-05 | A comparison shall read each resource from the same endpoints and cache as its dashboard, with the viewer's own credentials and cache scope (FR-DATA-04, FR-ACC-06), and each side shall count as a load of its own dashboard (FR-DATA-10). If either resource is not found or private, the comparison shall show the page of FR-ACC-05 for it and nothing of either. Each side shall say when its data was fetched (FR-DATA-06), and when it is saved data (FR-DATA-05), and so shall each section of FR-CMP-06. Comparisons shall not be recorded in history nor pinned (§4.8), and have no refresh of their own. | Should |
| FR-CMP-06 | For two repositories, sections shall show how both are maintained, from the same samples as their dashboards: of the 100 pull requests updated last, the median time to merge and the merge ratio, and of the open issues among the 100 open issues and pull requests updated last, their median age (FR-REPO-13); of the 50 latest workflow runs for pushes to the default branch, the pass rate and the average duration (FR-REPO-14); and of the 100 latest releases without drafts, the average time between releases and how many are stable (FR-REPO-16). Each section shall say that its figures are of samples of recent items, not of a period of time, and, of each side, what its dashboard says they are of, with how many items and the branch, and when its data was fetched, or that it is saved data (FR-DATA-05, FR-DATA-06). Each card shall mark which figure is higher or longer, and by how much, in its unit, such as hours or percentage points, or that both show the same, as FR-CMP-03 says, in words that rank neither as better or worse. A side without a figure, as when GitHub will not list its workflow runs to the viewer's credential or it has no releases, shall say why in place of the figure, and what the token needs, rather than show a zero or a difference. A section that fails shall say so, and try again, apart from the others. | Should |

---

## 5. Data requirements

### 5.1 Logical data model

The physical design (tables, columns, types, and indexes) follows from the ORM entities. The logical entities are:

| Entity | Purpose | Key attributes | Kept until |
|---|---|---|---|
| User | A person who has signed in | GitHub user ID (unique), login, display name, avatar URL, created at, last sign-in at | The user deletes their data |
| Session | A signed-in browser | Hash of the session ID, user, created at, last used at, expires at | Expiry or sign-out |
| Credential | GitHub access for a user | User, kind (sign-in or PAT), encrypted value. For PATs also: type, last four characters, scopes or permissions, expiry, status, last validated at | Replaced, removed, or user deleted |
| Cache entry | Cached GitHub data | Resource key, scope (shared or one user), data, fetched at, expires at, GitHub validator for conditional requests | `cache.retention` |
| Repository observation | What a repository's stat cards showed when GitHub gave them (FR-DATA-13) | Scope (shared, or one user with the PAT that read them), the repository's GitHub ID, UTC day, stars, forks, open issues, open pull requests, when observed | 90 days |
| History entry | A recently viewed dashboard | User, resource kind and name, last viewed at | The 20 newest per user |
| Pin | A pinned dashboard | User, resource kind and name, position | Unpinned (at most 12 per user) |
| Schema version | Migration bookkeeping | Version, applied at | Permanent |
| GitHub host | The GitHub host the data is from (FR-DB-11) | Host, recorded at | Permanent |

### 5.2 Data rules

| ID | Rule | Priority |
|---|---|---|
| DR-01 | BuhTig shall store only the personal data listed in §5.1. It shall not store email addresses, or any GitHub content other than cache entries and repository observations. | Must |
| DR-02 | Session identifiers shall be stored only as hashes. | Must |
| DR-03 | Credentials shall be encrypted at rest with `security.encryption_key`. If the key changes, any credential that can no longer be decrypted shall be treated as invalid: affected users are signed out and asked to re-enter their PAT. | Must |
| DR-04 | Deleting a user shall delete their sessions, credentials, private cache, the observations made with their PAT, history, and pins. | Must |
| DR-05 | The database itself, not only the application, shall enforce uniqueness and relationships (e.g., one user per GitHub user ID, one pin per user and resource). | Should |
| DR-06 | All timestamps shall be stored in UTC. | Must |

### 5.3 Expected volume

The design targets one instance with up to 10,000 users, up to 100,000 cache entries, and a database of a few gigabytes at most. Repository observations add at most one small row for each repository, scope and day the repository's dashboard is opened, kept for 90 days. Housekeeping keeps every table bounded, which is why partitioning is unnecessary (CON-05).

---

## 6. Non-functional requirements

### 6.1 Performance

| ID | Requirement | Priority |
|---|---|---|
| NFR-PERF-01 | The home page's main content (Largest Contentful Paint) shall render within 1.5 s at the 75th percentile on a typical broadband or 4G connection. | Must |
| NFR-PERF-02 | The home page shall transfer no more than 300 KB compressed, excluding avatars. | Should |
| NFR-PERF-03 | For a dashboard served from fresh cache, the server shall respond within 300 ms at the 95th percentile, and the page shall be fully rendered within 2 s at the 75th percentile. | Must |
| NFR-PERF-04 | For a dashboard that needs GitHub fetches, skeletons shall be visible within 300 ms of navigation. The first widget shall appear within 3 s and all widgets within 10 s at the 75th percentile for typical repositories, excluding time GitHub spends computing statistics (FR-REPO-10). | Should |
| NFR-PERF-05 | Animations shall run at 60 frames per second on a mid-range phone from the last three years. They shall not cause layout shift (Cumulative Layout Shift ≤ 0.1). | Should |
| NFR-PERF-06 | Search-box feedback (FR-SRCH-04, FR-SRCH-09) and the command palette's suggestions (FR-SRCH-12) shall appear within 100 ms of a keystroke. | Should |

### 6.2 Capacity

| ID | Requirement | Priority |
|---|---|---|
| NFR-CAP-01 | With default settings, one instance shall serve at least 100 concurrent users and 10,000 registered users on a host with 1 vCPU and 1 GB of memory for the application, not counting the database. | Should |

### 6.3 Reliability

| ID | Requirement | Priority |
|---|---|---|
| NFR-REL-01 | GitHub outages, errors, and rate limits shall never crash BuhTig or block unrelated pages. They shall degrade service as described in FR-DATA-05. | Must |
| NFR-REL-02 | BuhTig shall be restartable at any time without data loss. Only caches and rate-limit counters may be held in memory alone. | Must |

### 6.4 Security

| ID | Requirement | Priority |
|---|---|---|
| NFR-SEC-01 | Session cookies shall be `Secure`, `HttpOnly`, and `SameSite=Lax`. Session IDs shall carry at least 128 bits of randomness and be replaced at sign-in. | Must |
| NFR-SEC-02 | Every state-changing request shall use a method other than GET and shall be protected against cross-site request forgery. | Must |
| NFR-SEC-03 | All text from GitHub (names, descriptions, commit messages, issue titles, topics) is untrusted and shall be displayed as escaped plain text. In this release, BuhTig shall not render HTML or Markdown from GitHub, and it shall only link to `http` and `https` URLs. | Must |
| NFR-SEC-04 | The return URL after sign-in shall be restricted to relative BuhTig paths, so it cannot be used as an open redirect. | Must |
| NFR-SEC-05 | Credentials shall be decrypted only to call GitHub. They shall never be sent to the browser or written to logs (FR-DATA-01, FR-OPS-04). | Must |
| NFR-SEC-06 | A Content Security Policy shall restrict pages to scripts and styles from BuhTig's own origin, so there are no third-party scripts, trackers, or ads. Images may also load from the avatar host of `github.host`: `avatars.githubusercontent.com` for github.com, and a GitHub Enterprise Server's own avatars on it. | Should |
| NFR-SEC-07 | Responses shall include security headers that prevent framing by other sites, prevent MIME sniffing, and avoid leaking full URLs in the Referer header. HTTPS responses shall enable HSTS. | Should |
| NFR-SEC-08 | Sign-in attempts and PAT validations shall be rate-limited to 10 per minute per client. | Should |
| NFR-SEC-09 | Error pages shall never expose stack traces, SQL, internal paths, or configuration values. | Must |
| NFR-SEC-10 | The database connection shall use TLS whenever the database runs on a different host. | Should |

### 6.5 Privacy

| ID | Requirement | Priority |
|---|---|---|
| NFR-PRIV-01 | BuhTig shall collect only the data in §5.1 and use no analytics or third-party tracking. It shall set only strictly necessary cookies: the session cookie and a short-lived sign-in state cookie. | Must |
| NFR-PRIV-02 | For visitors, BuhTig shall keep no server-side records other than transient rate-limit counters and standard request logs. | Must |
| NFR-PRIV-03 | The Privacy page shall state what BuhTig stores, why, for how long, and how to delete it, that it keeps what repositories' stat cards showed for 90 days (FR-DATA-13), that public repositories opened on the instance are listed on its home pages (FR-SRCH-11), and that link previews and cards show a dashboard's figures only while it was opened lately (FR-NAV-06, FR-NAV-07). | Should |

### 6.6 Usability and accessibility

| ID | Requirement | Priority |
|---|---|---|
| NFR-UX-01 | In public mode, a first-time visitor shall get from the home page to a dashboard by pasting a URL and pressing Enter, with no other step. | Must |
| NFR-UX-02 | BuhTig shall conform to WCAG 2.2 level AA. | Must |
| NFR-UX-03 | Every function shall be operable by keyboard alone, with a visible focus indicator. | Must |
| NFR-UX-04 | Every chart shall have a text alternative: a one-sentence summary, plus its data as a table on request. | Must |
| NFR-UX-05 | Color shall never be the only carrier of meaning in charts, badges, or states. | Must |
| NFR-UX-06 | Error messages shall say, in plain language, what happened and what the user can do next. | Must |
| NFR-UX-07 | The UI shall be in English. All user-facing text shall be kept separate from logic so it can be translated later. | Should |

### 6.7 Maintainability and testability

| ID | Requirement | Priority |
|---|---|---|
| NFR-MNT-01 | A developer shall be able to run BuhTig locally with only the application, a PostgreSQL database, and a config file. | Must |
| NFR-MNT-02 | Automated tests shall cover every input form in Table 4-1, the access rules in §4.7, cache scoping (FR-DATA-04), configuration validation (FR-CFG-02, FR-CFG-03), and auto-migration both on an empty database and when upgrading from the previous release. | Must |
| NFR-MNT-03 | Automated tests shall be able to replace GitHub with a stub, so the test suite does not depend on GitHub's availability or rate limits. | Should |

---

## 7. Acceptance scenarios

These scenarios are the minimum release checks. Each should be automated where practical.

| ID | Given and when | Then |
|---|---|---|
| AC-01 | Public mode. A visitor pastes `https://github.com/owner/repo/tree/main` and presses Enter. | The browser shows `/owner/repo`. Skeletons appear within 300 ms, and stat cards count up and charts animate in as data arrives. |
| AC-02 | A visitor opens `/owner/secret-repo`, a private repository. | A "Not found or private" page appears with a sign-in prompt. Nothing about the repository is revealed. |
| AC-03 | Alice saves a PAT that can read `owner/secret-repo` and opens its dashboard. Then Bob, signed in without access, opens the same URL. | Alice sees the dashboard with a Private badge. Bob gets "Not found or private" and receives no data from Alice's private cache. |
| AC-04 | Alice, signed in, tries to save a PAT that belongs to Bob's GitHub account. | The PAT is rejected and nothing is stored. |
| AC-05 | `access.mode` is `private` and `access.allowed_users` lists only `alice`. A visitor opens `/owner/repo`, and then Bob tries to sign in. | The visitor is redirected to sign in. Bob sees "not allowed on this instance", and no session is created. |
| AC-06 | The database is empty and the config file contains only the five required keys. BuhTig is started, then restarted. | The first start creates the schema and serves the home page. The restart leaves the schema unchanged. |
| AC-07 | The environment defines `DATABASE_URL`, `PGPASSWORD`, and `HTTPS_PROXY` with values that differ from the config file. BuhTig starts. | Only the config file's values are used. |
| AC-08 | The operating system's reduced-motion setting is on, and a dashboard loads. | Numbers appear without counting up and charts without drawing. There is no shimmer, glide, or shake. |
| AC-09 | Data for `owner/repo` is cached and GitHub is unreachable. | The dashboard shows the cached data with a notice of its age. |
| AC-10 | A user enters `gitlab.com/owner/repo`. | The inline message "BuhTig supports github.com URLs only." appears, and the page does not navigate. |
| AC-11 | Alice removes her PAT. | Her private cache is deleted at once. Her private dashboards now show "Not found or private" with an add-token prompt. |
| AC-12 | Alice saves a PAT and opens her own dashboard, `/alice`. Then Bob, signed in with a PAT of his own, opens `/alice`. | Alice sees her private repositories among her repositories, with Private badges. Bob sees her public repositories only. |
| AC-13 | Alice saves a PAT that can read `owner/secret-repo` and opens `/-/compare/owner/secret-repo...owner/repo`. Then Bob, signed in without access, opens the same URL. | Alice sees both repositories side by side, with how each figure differs. Bob gets "Not found or private" for `owner/secret-repo` and receives no data from Alice's private cache. |
| AC-14 | Public mode. Alice saves a PAT that can read `owner/secret-repo` and opens its dashboard. Then a visitor opens `/-/preview/owner/secret-repo.svg`, and `/-/preview/owner/repo.svg` both before and after another visitor opens `/owner/repo`. | The card of `owner/secret-repo` shows its name alone, as does that of `owner/repo` at first. Once a visitor has opened `/owner/repo`, its card shows its description and figures. GitHub is never asked for a card. |
| AC-15 | `github.host` is `ghe.example.com`. A user enters `github.com/owner/repo`, then `https://ghe.example.com/owner/repo`. Then the operator removes `github.host` and restarts BuhTig. | The inline message "BuhTig supports ghe.example.com URLs only." appears, and the page does not navigate; the second input opens `/owner/repo`. BuhTig then refuses to start, naming `github.host`, and the database is unchanged. |
| AC-16 | Alice saves a fine-grained PAT that can read `owner/repo` and `owner/other`, and the GitHub Actions of `owner/repo` only. `owner/other` has no releases. She opens `/-/compare/owner/repo...owner/other`. | The workflow runs section shows the pass rate and average duration of `owner/repo`, and says of `owner/other` that GitHub won't show its runs to her token, and that the token needs read access to Actions. The release cadence section says that `owner/other` has no releases. Neither shows a zero for `owner/other`, nor how the two differ there. The other sections show both repositories' figures, with what each is of and when it was fetched. |
| AC-17 | Public mode. Alice saves a PAT that can read `owner/secret-repo` and opens `/owner/secret-repo/activity`, and a visitor opens `/owner/repo/activity`. A week later, after `owner/repo` went unopened for some days, both open them again. Then Bob, signed in without access, opens `/owner/secret-repo/activity`. | At first, each Trends widget says when BuhTig began recording, and that there is no earlier baseline. A week later, each tells the change over 7 days between its two observations, with the figures and the times recorded. The days without an observation show as gaps, not zeros, and the 30 and 90 days say that BuhTig began recording after they began. Bob gets "Not found or private", and nothing observed with Alice's PAT. |

---

## 8. Out of scope

These items are not part of this release; they are candidates for later versions:

- More than one GitHub host per instance, and GitHub Enterprise Server with a certificate that no public root certificate authority vouches for.
- Any write action on GitHub.
- Rendering READMEs or any other Markdown or HTML from GitHub.
- Data that needs bulk crawling or elevated access, such as star history from before BuhTig observed a repository (FR-DATA-13), and traffic (views and clones).
- Real-time updates through webhooks, notifications, and email.
- Custom dashboard layouts, comparing more than two resources at once, and exporting data or images, other than the cards of FR-NAV-07.
- An administration UI, teams, and sharing private dashboards with other users.
- Native mobile apps and a public API.
- Horizontal scaling, partitioning, external caches, and queues. These are excluded by design (CON-05, CON-06).

---

## 9. Open issues

| ID | Question | Working answer until resolved |
|---|---|---|
| OI-01 | Which file format and default location should the config file use? | Decided at design time. It must be a human-readable text format that allows comments (FR-CFG-08). |
| OI-02 | Does "no secret" mean the config file must contain no secrets at all? | No (A-01). If it does, GitHub sign-in and encrypted token storage need a different design, because both depend on secret values. |
| OI-03 | Is the reading of "private and public" in A-02 correct? | Yes, as specified in §4.7. |
| OI-04 | What is the minimum supported PostgreSQL version? | The oldest major version still supported by the PostgreSQL project at release, unless the chosen ORM requires a newer one. |
| OI-05 | Should "Surprise me" (FR-SRCH-10) ship? | Only if time allows. |
| OI-06 | What are the wordmark and visual identity? | A design task, within CON-10. |
| OI-07 | Should sign-in optionally request broader GitHub permissions so private data works without a PAT? | No (A-03). Sign-in stays minimal, and private access stays under each user's explicit control. |

---

## Appendix A. Traceability to the brief

| Brief item | Covered by |
|---|---|
| Create GitHub dashboard | §4.3, §4.4, §4.9 |
| Named BuhTig | §1.2, UI-04, CON-10 |
| Animation | §4.10, NFR-PERF-05, NFR-UX-02 |
| PostgreSQL, auto-migrate, no partition, ORM | CON-02 to CON-05, §4.12, §5 |
| Private (sign-in required) and public | §4.7, A-02 |
| Sign in with GitHub; personal access token optional for signed-in users | §4.5, §4.6, A-03 |
| Simple architecture | CON-06, §2.1, NFR-MNT-01 |
| Single config file; no env, no secret, no vault | CON-07, §4.11, Table 4-3, A-01 |
| UI like Google; enter a repository or organization URL | §3.1, §4.1, §4.2 |
