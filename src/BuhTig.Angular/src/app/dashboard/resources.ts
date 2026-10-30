import { HttpClient, HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { Resource, dashboardPath, parse } from '../search/parse';
import { Computing, Failure, failureOf } from '../widget/load';
import { organizationUrl, repositoryUrl, resourceUrl } from './urls';

/** What a dashboard learns of its repository or organization before its widgets load. */
export interface Summary {
  /**
   * The dashboard's path with the names as GitHub spells them (FR-NAV-04), and with the new
   * names of a repository that was renamed or transferred (FR-NAV-05). `undefined` when the
   * server's answer names no such resource.
   */
  path: string | undefined;
  /** When BuhTig fetched the resource from GitHub (FR-DATA-06), unless the server says not. */
  fetchedAt: Date | undefined;
  /** What a repository's header shows, unless the resource is none, or the answer names none. */
  repository: Repository | undefined;
  /** What an organization's header shows, unless the resource is none, or the answer names none. */
  organization: Organization | undefined;
  /** Why GitHub keeps the resource from the viewer's credential, when it does (FR-PAT-08). */
  denied: Denied | undefined;
  /**
   * Whether GitHub says there is no such resource, which it says too of one that the viewer's
   * credential may not see (FR-ACC-05).
   */
  notFound: boolean;
  /**
   * Whether the name cannot be a GitHub account's or repository's, as the server says without
   * asking GitHub (FR-SRCH-04), as of a URL typed by hand.
   */
  invalid: boolean;
  /**
   * Why the data is older than `cache.ttl`, if it is (FR-DATA-05): GitHub failed, or the server
   * asks GitHub for no more for visitors for now (FR-DATA-10, FR-DATA-11).
   */
  stale: Stale | undefined;
  /** Why BuhTig could show nothing of the resource, if it could not, and has nothing saved. */
  failure: Failure | undefined;
}

/** Why a dashboard shows saved data, older than `cache.ttl`. */
export type Stale = 'held' | 'github';

/** What came of a request to refresh a dashboard (FR-DATA-07). */
export type Refreshed =
  | { status: 'refreshed' }
  /** It was refreshed less than a minute ago, and may be again from `until`, if known. */
  | { status: 'too-soon'; until: Date | undefined }
  | { status: 'failed' };

/**
 * Why GitHub keeps a resource from the viewer's credential (FR-PAT-08): an organization requires
 * it to be authorized for single sign-on, at `url` if GitHub says where, or does not let the
 * user's personal access token in, as when it requires owners to approve fine-grained tokens.
 */
export type Denied = { reason: 'sso'; url: string | undefined } | { reason: 'token' };

/** What a repository's header shows of it (FR-REPO-01). What GitHub does not say is left out. */
export interface Repository {
  /** `owner/repo`, as GitHub spells it. */
  name: string;
  /** An `https` URL. */
  ownerAvatarUrl: string | undefined;
  description: string | undefined;
  visibility: 'public' | 'private' | 'internal';
  archived: boolean;
  template: boolean;
  fork: boolean;
  /** The `owner/repo` of the repository that a fork was forked from. */
  parent: string | undefined;
  topics: string[];
  license: string | undefined;
  defaultBranch: string | undefined;
  /** An `http` or `https` URL, the only kinds BuhTig links to (NFR-SEC-03). */
  homepage: string | undefined;
  createdAt: Date | undefined;
  pushedAt: Date | undefined;
}

/** What an organization's header shows of it (FR-ORG-01). What GitHub does not say is left out. */
export interface Organization {
  /** Its login, as GitHub spells it. */
  login: string;
  /** An `https` URL. */
  avatarUrl: string | undefined;
  /** The name it goes by, if it gives one. */
  displayName: string | undefined;
  description: string | undefined;
  location: string | undefined;
  /** An `http` or `https` URL, the only kinds BuhTig links to (NFR-SEC-03). */
  website: string | undefined;
  createdAt: Date | undefined;
  /** Whether GitHub has verified it. */
  verified: boolean;
}

/** What an organization's stat cards show (FR-ORG-02), of the repositories the viewer may see. */
export interface OrganizationStats {
  repositories: number;
  /** Those of the repositories that are private, which only a token user sees (FR-ORG-09). */
  private: number;
  /** Those of the repositories that are internal, which only a token user sees (FR-ORG-09). */
  internal: number;
  stars: number;
  forks: number;
  /** Issues and pull requests together, as GitHub counts them. */
  openIssuesAndPullRequests: number;
  /** The primary language of the most repositories, unless none has one. */
  topLanguage: string | undefined;
  /**
   * Whether the organization has more repositories than BuhTig reads, so that the figures are
   * of those pushed to most recently, `repositories` of them (FR-ORG-08).
   */
  truncated: boolean;
}

/** One of an organization's repositories, as its repository table lists it (FR-ORG-03). */
export interface ListedRepository {
  /** Its name, without the organization's, as GitHub spells it. */
  name: string;
  /** The path of its dashboard. */
  path: string;
  description: string | undefined;
  /** Its primary language, if it has one. */
  language: string | undefined;
  stars: number;
  forks: number;
  /** Issues and pull requests together, as GitHub counts them. */
  openIssuesAndPullRequests: number;
  pushedAt: Date | undefined;
  fork: boolean;
  archived: boolean;
  /** Only a token user sees private and internal ones (FR-ORG-09). */
  visibility: 'public' | 'private' | 'internal';
  topics: string[];
}

/** How many of an organization's repositories have each primary language (FR-ORG-04). */
export interface LanguageCounts {
  /** The 8 languages of the most repositories, most first. */
  languages: LanguageCount[];
  /** The repositories of all the other languages together, which are "Other". */
  other: number;
}

export interface LanguageCount {
  name: string;
  repositories: number;
}

/** One of the 10 repositories of an organization with the most stars (FR-ORG-05). */
export interface TopRepository {
  /** Its name, without the organization's, as GitHub spells it. */
  name: string;
  /** The path of its dashboard. */
  path: string;
  stars: number;
}

/**
 * How many of an organization's repositories were last pushed to in each period (FR-ORG-06).
 * Each counts in one alone: `last30Days` are those pushed to within 30 days but not within 7,
 * and so on.
 */
export interface LastPush {
  last7Days: number;
  last30Days: number;
  last12Months: number;
  older: number;
}

/** How many of an organization's repositories were created in a year, in UTC (FR-ORG-06). */
export interface YearCount {
  year: number;
  repositories: number;
}

/** The members of an organization that the viewer may see (FR-ORG-07). */
export interface Members {
  /** How many there are. */
  count: number;
  /** Up to 24 of them, in the order GitHub gives them. */
  members: Member[];
}

export interface Member {
  login: string;
  /** An `https` URL. */
  avatarUrl: string | undefined;
  /** Their page on GitHub. */
  url: string | undefined;
}

/** What a repository's stat cards show (FR-REPO-02). */
export interface Stats {
  stars: number;
  forks: number;
  /** Those who get the repository's notifications, not its stargazers. */
  watchers: number;
  /** Issues alone, though GitHub counts pull requests as issues too. */
  openIssues: number;
  openPullRequests: number;
  /** The release GitHub marks as the latest, if there is one. */
  latestRelease: Release | undefined;
}

export interface Release {
  tag: string;
  publishedAt: Date | undefined;
  /** Its page on GitHub (FR-REPO-12). */
  url: string | undefined;
}

/** A repository's commits in each of the last 52 weeks, oldest first (FR-REPO-03). */
export interface CommitActivity {
  weeks: Week[];
  /** The commits of all the weeks together. */
  total: number;
}

export interface Week {
  /** The Sunday it starts on, at midnight UTC, as GitHub counts weeks. */
  start: Date;
  commits: number;
}

/** How much of a repository's code is in each language (FR-REPO-04). */
export interface Languages {
  /** The 8 with the most code, in bytes, most first. */
  languages: Language[];
  /** The bytes of all the others together, which are "Other". */
  other: number;
  /** The bytes of all of them together. */
  total: number;
}

export interface Language {
  name: string;
  bytes: number;
}

/** A repository's top contributors (FR-REPO-05). */
export interface Contributors {
  /** Up to 10, those with the most commits first. */
  contributors: Contributor[];
  /** Whether GitHub does not list them, as for its largest repositories. */
  tooLarge: boolean;
  /** How many contributors it has in all, unless GitHub does not say. */
  count: number | undefined;
}

export interface Contributor {
  login: string;
  /** An `https` URL. */
  avatarUrl: string | undefined;
  /** Their page on GitHub (FR-REPO-12). */
  url: string | undefined;
  commits: number;
}

/** A repository's issues and pull requests (FR-REPO-06). */
export interface IssuesAndPullRequests {
  /** Its issues in each state, unless the repository has turned them off on GitHub. */
  issues: { open: number; closed: number } | undefined;
  /**
   * Its pull requests in each state, `closed` being those closed without being merged, unless
   * the repository has turned them off on GitHub.
   */
  pullRequests: { open: number; merged: number; closed: number } | undefined;
  /** Up to 20, those updated last first. */
  recent: IssueOrPullRequest[];
}

export interface IssueOrPullRequest {
  number: number;
  title: string;
  kind: 'issue' | 'pull_request';
  /** Only a pull request is `merged`. One that is `closed` was not. */
  state: 'open' | 'closed' | 'merged';
  /** The login of whoever opened it. */
  author: string | undefined;
  /** When it was opened. */
  createdAt: Date | undefined;
  /** When it last changed. */
  updatedAt: Date | undefined;
  /** Its page on GitHub (FR-REPO-12). */
  url: string | undefined;
}

/** One of the latest commits on a repository's default branch (FR-REPO-07). */
export interface Commit {
  sha: string;
  /** The first line of its message, unless it has none. */
  message: string | undefined;
  /** Its author's GitHub login, or else the name the commit gives. */
  author: string | undefined;
  /** Its author's avatar, an `https` URL, if they have a GitHub account. */
  authorAvatarUrl: string | undefined;
  /** When it was committed, which for a commit merged from elsewhere is when it landed. */
  committedAt: Date | undefined;
  /** Its page on GitHub (FR-REPO-12). */
  url: string | undefined;
}

/** One of a repository's latest releases (FR-REPO-08), which is never a draft. */
export interface ListedRelease extends Release {
  /** Its name, unless it only repeats the tag. */
  name: string | undefined;
  prerelease: boolean;
  /** The branch or commit it was made from. */
  target: string | undefined;
}

/** A repository's latest releases (FR-REPO-08). */
export interface Releases {
  /** Up to 5, the latest first. */
  releases: ListedRelease[];
  /** How many releases it has in all. */
  count: number;
}

/** The server's answer about a repository or an organization. */
interface Answer {
  name: string;
  fetched_at?: string;
  stale?: string | null;
  repository?: RepositoryAnswer;
  organization?: OrganizationAnswer;
}

/** The server's answer about a repository, for its header. */
interface RepositoryAnswer {
  name: string;
  fetched_at?: string;
  stale?: string | null;
  owner_avatar_url?: string | null;
  description?: string | null;
  visibility?: string;
  archived?: boolean;
  template?: boolean;
  fork?: boolean;
  parent?: string | null;
  topics?: string[];
  license?: string | null;
  default_branch?: string | null;
  homepage?: string | null;
  created_at?: string | null;
  pushed_at?: string | null;
}

/** The server's answer about an organization, for its header. */
interface OrganizationAnswer {
  name: string;
  fetched_at?: string;
  stale?: string | null;
  avatar_url?: string | null;
  display_name?: string | null;
  description?: string | null;
  location?: string | null;
  website?: string | null;
  created_at?: string | null;
  verified?: boolean;
}

/** The server's answer about an organization, for its stat cards. */
interface OrganizationStatsAnswer {
  repositories: number;
  private: number;
  internal: number;
  stars: number;
  forks: number;
  open_issues_and_pull_requests: number;
  top_language: string | null;
  truncated: boolean;
}

/** The server's answer about an organization, for its repository table. */
interface OrganizationRepositoriesAnswer {
  repositories: {
    name: string;
    description: string | null;
    language: string | null;
    stars: number;
    forks: number;
    open_issues_and_pull_requests: number;
    pushed_at: string | null;
    fork: boolean;
    archived: boolean;
    visibility: string;
    topics?: string[];
  }[];
}

/** The server's answer about an organization, for its top-repositories chart. */
interface TopRepositoriesAnswer {
  repositories: { name: string; stars: number }[];
}

/** The server's answer about an organization, for its last-push chart. */
interface LastPushAnswer {
  last_7_days: number;
  last_30_days: number;
  last_12_months: number;
  older: number;
}

/** The server's answer about an organization, for its created-per-year chart. */
interface CreatedPerYearAnswer {
  years: YearCount[];
}

/** The server's answer about an organization, for its members widget. */
interface MembersAnswer {
  count: number;
  members: {
    login: string;
    avatar_url: string | null;
    url: string | null;
  }[];
}

/** The server's answer about a repository, for its stat cards. */
interface StatsAnswer {
  stars: number;
  forks: number;
  watchers: number;
  open_issues: number;
  open_pull_requests: number;
  latest_release: { tag: string; published_at: string | null; url: string | null } | null;
}

/** The server's answer about a repository, for its commit-activity chart. */
interface CommitActivityAnswer {
  weeks: { week: string; commits: number }[];
}

/** The server's answer about a repository, for its languages chart. */
interface LanguagesAnswer {
  languages: Language[];
  other: number;
}

/** The server's answer about a repository, for its top contributors. */
interface ContributorsAnswer {
  contributors: {
    login: string;
    avatar_url: string | null;
    url: string | null;
    commits: number;
  }[];
  too_large: boolean;
  count?: number | null;
}

/** The server's answer about a repository, for its issues and pull requests. */
interface IssuesAnswer {
  issues: { open: number; closed: number } | null;
  pull_requests: { open: number; merged: number; closed: number } | null;
  recent: {
    number: number;
    title: string;
    kind: string;
    state: string;
    author: string | null;
    created_at: string | null;
    updated_at?: string | null;
    url: string | null;
  }[];
}

/** The server's answer about a repository, for its recent commits. */
interface CommitsAnswer {
  commits: {
    sha: string;
    message: string | null;
    author: string | null;
    author_avatar_url?: string | null;
    committed_at: string | null;
    url: string | null;
  }[];
}

/** The server's answer about a repository, for its releases. */
interface ReleasesAnswer {
  releases: {
    tag: string;
    name: string | null;
    published_at: string | null;
    prerelease: boolean;
    url: string | null;
    target?: string | null;
  }[];
  count?: number;
}

/** What BuhTig knows of repositories and organizations as a whole. */
@Injectable({ providedIn: 'root' })
export class Resources {
  private readonly http = inject(HttpClient);

  private readonly refreshCount = signal(0);

  /**
   * How many times the viewer has refreshed a dashboard, so that what the dashboard shows is
   * asked for again each time (FR-DATA-07).
   */
  readonly refreshes = this.refreshCount.asReadonly();

  /**
   * What BuhTig knows of `resource`: what it is, or that GitHub says there is no such resource,
   * or keeps it from the viewer's credential, or that its name cannot be one, or why BuhTig
   * cannot tell now.
   */
  summary(resource: Resource): Observable<Summary> {
    const answer: Observable<Answer> =
      resource.kind === 'repository'
        ? this.http
            .get<RepositoryAnswer>(repositoryUrl(resource.owner, resource.repo))
            .pipe(map((repository) => ({ ...repository, repository })))
        : this.http
            .get<OrganizationAnswer>(organizationUrl(resource.org))
            .pipe(map((organization) => ({ ...organization, organization })));
    return answer.pipe(
      map(({ name, fetched_at, stale, repository, organization }): Summary => {
        const path = canonicalPath(name, resource.kind);
        return {
          path,
          fetchedAt: date(fetched_at),
          stale: stale === 'held' || stale === 'github' ? stale : undefined,
          failure: undefined,
          repository:
            repository !== undefined && path !== undefined ? header(repository) : undefined,
          organization:
            organization !== undefined && path !== undefined
              ? organizationHeader(organization)
              : undefined,
          denied: undefined,
          notFound: false,
          invalid: false,
        };
      }),
      catchError((error: unknown) => {
        const denied = deniedBy(error);
        const status = error instanceof HttpErrorResponse ? error.status : undefined;
        const notFound = status === HttpStatusCode.NotFound;
        const invalid = status === HttpStatusCode.BadRequest;
        return of<Summary>({
          path: undefined,
          fetchedAt: undefined,
          repository: undefined,
          organization: undefined,
          denied,
          notFound,
          invalid,
          stale: undefined,
          failure: denied || notFound || invalid ? undefined : failureOf(error),
        });
      }),
    );
  }

  /**
   * Asks the server to fetch `resource`'s dashboard from GitHub anew, which only signed-in
   * users may, once a minute (FR-DATA-07, FR-ACC-02). Once it has, what the dashboard shows is
   * asked for again.
   */
  refresh(resource: Resource): Observable<Refreshed> {
    return this.http.post(`${resourceUrl(resource)}/refresh`, null).pipe(
      tap(() => this.refreshCount.update((count) => count + 1)),
      map((): Refreshed => ({ status: 'refreshed' })),
      catchError((error: unknown) =>
        of<Refreshed>(
          error instanceof HttpErrorResponse && error.status === HttpStatusCode.TooManyRequests
            ? { status: 'too-soon', until: date((error.error as { until?: string } | null)?.until) }
            : { status: 'failed' },
        ),
      ),
    );
  }

  /** The figures of the stat cards of the repository `owner/repo`, which fail as it does. */
  stats(owner: string, repo: string): Observable<Stats> {
    return this.http.get<StatsAnswer>(`${repositoryUrl(owner, repo)}/stats`).pipe(
      map((stats) => {
        const release = stats.latest_release;
        return {
          stars: stats.stars,
          forks: stats.forks,
          watchers: stats.watchers,
          openIssues: stats.open_issues,
          openPullRequests: stats.open_pull_requests,
          latestRelease: release
            ? {
                tag: release.tag,
                publishedAt: date(release.published_at),
                url: link(release.url, ['https:']),
              }
            : undefined,
        };
      }),
    );
  }

  /** The figures of the stat cards of the organization `org`, which fail as it does. */
  organizationStats(org: string): Observable<OrganizationStats> {
    return this.http.get<OrganizationStatsAnswer>(`${organizationUrl(org)}/stats`).pipe(
      map((stats) => ({
        repositories: stats.repositories,
        private: stats.private,
        internal: stats.internal,
        stars: stats.stars,
        forks: stats.forks,
        openIssuesAndPullRequests: stats.open_issues_and_pull_requests,
        topLanguage: stats.top_language || undefined,
        truncated: stats.truncated === true,
      })),
    );
  }

  /**
   * The repositories of the organization `org` that its repository table lists, pushed to most
   * recently first, which fail as `organizationStats` does. Any that the server gives a name no
   * repository can have is left out.
   */
  organizationRepositories(org: string): Observable<ListedRepository[]> {
    return this.http
      .get<OrganizationRepositoriesAnswer>(`${organizationUrl(org)}/repositories`)
      .pipe(
        map(({ repositories }) =>
          repositories.flatMap((repository): ListedRepository[] => {
            const path = canonicalPath(`${org}/${repository.name}`, 'repository');
            if (path === undefined) {
              return [];
            }
            const visibility = repository.visibility;
            return [
              {
                name: repository.name,
                path,
                description: repository.description || undefined,
                language: repository.language || undefined,
                stars: repository.stars,
                forks: repository.forks,
                openIssuesAndPullRequests: repository.open_issues_and_pull_requests,
                pushedAt: date(repository.pushed_at),
                fork: repository.fork === true,
                archived: repository.archived === true,
                visibility:
                  visibility === 'private' || visibility === 'internal' ? visibility : 'public',
                topics: (repository.topics ?? []).filter((topic) => typeof topic === 'string'),
              },
            ];
          }),
        ),
      );
  }

  /**
   * How many of the repositories of the organization `org` have each primary language, which
   * fails as `organizationStats` does.
   */
  organizationLanguages(org: string): Observable<LanguageCounts> {
    return this.http.get<LanguageCounts>(`${organizationUrl(org)}/languages`);
  }

  /**
   * The repositories of the organization `org` with the most stars, most first, which fail as
   * `organizationStats` does. Any that the server gives a name no repository can have is left
   * out.
   */
  topRepositories(org: string): Observable<TopRepository[]> {
    return this.http.get<TopRepositoriesAnswer>(`${organizationUrl(org)}/top-repositories`).pipe(
      map(({ repositories }) =>
        repositories.flatMap(({ name, stars }): TopRepository[] => {
          const path = canonicalPath(`${org}/${name}`, 'repository');
          return path !== undefined ? [{ name, path, stars }] : [];
        }),
      ),
    );
  }

  /**
   * How many of the repositories of the organization `org` were last pushed to in each period,
   * which fails as `organizationStats` does.
   */
  lastPush(org: string): Observable<LastPush> {
    return this.http.get<LastPushAnswer>(`${organizationUrl(org)}/last-push`).pipe(
      map((answer) => ({
        last7Days: answer.last_7_days,
        last30Days: answer.last_30_days,
        last12Months: answer.last_12_months,
        older: answer.older,
      })),
    );
  }

  /**
   * How many of the repositories of the organization `org` were created in each year, oldest
   * first, which fails as `organizationStats` does.
   */
  createdPerYear(org: string): Observable<YearCount[]> {
    return this.http
      .get<CreatedPerYearAnswer>(`${organizationUrl(org)}/created-per-year`)
      .pipe(map(({ years }) => years));
  }

  /** The members of the organization `org` that the viewer may see, which fail as `organizationStats` does. */
  members(org: string): Observable<Members> {
    return this.http.get<MembersAnswer>(`${organizationUrl(org)}/members`).pipe(
      map((answer) => ({
        count: answer.count,
        members: answer.members.map((member) => ({
          login: member.login,
          avatarUrl: link(member.avatar_url, ['https:']),
          url: link(member.url, ['https:']),
        })),
      })),
    );
  }

  /**
   * The commit activity of the repository `owner/repo`, which fails with `Computing` while
   * GitHub is still computing it (FR-REPO-10), and otherwise as `stats` does.
   */
  commitActivity(owner: string, repo: string): Observable<CommitActivity> {
    return this.part<CommitActivityAnswer>(owner, repo, 'commit-activity').pipe(map(activity));
  }

  /** The languages of the repository `owner/repo`, which fail as `commitActivity` does. */
  languages(owner: string, repo: string): Observable<Languages> {
    return this.part<LanguagesAnswer>(owner, repo, 'languages').pipe(
      map(({ languages, other }) => ({
        languages,
        other,
        total: languages.reduce((total, language) => total + language.bytes, other),
      })),
    );
  }

  /** The top contributors of the repository `owner/repo`, which fail as `commitActivity` does. */
  contributors(owner: string, repo: string): Observable<Contributors> {
    return this.part<ContributorsAnswer>(owner, repo, 'contributors').pipe(
      map((answer) => ({
        contributors: answer.contributors.map((contributor) => ({
          login: contributor.login,
          avatarUrl: link(contributor.avatar_url, ['https:']),
          url: link(contributor.url, ['https:']),
          commits: contributor.commits,
        })),
        tooLarge: answer.too_large === true,
        count: typeof answer.count === 'number' ? answer.count : undefined,
      })),
    );
  }

  /**
   * The issues and pull requests of the repository `owner/repo`, which fail as `commitActivity`
   * does.
   */
  issues(owner: string, repo: string): Observable<IssuesAndPullRequests> {
    return this.part<IssuesAnswer>(owner, repo, 'issues').pipe(
      map((answer): IssuesAndPullRequests => ({
        issues: answer.issues ?? undefined,
        pullRequests: answer.pull_requests ?? undefined,
        recent: answer.recent.map((item) => ({
          number: item.number,
          title: item.title,
          kind: item.kind === 'pull_request' ? 'pull_request' : 'issue',
          state: item.state === 'closed' || item.state === 'merged' ? item.state : 'open',
          author: item.author || undefined,
          createdAt: date(item.created_at),
          updatedAt: date(item.updated_at),
          url: link(item.url, ['https:']),
        })),
      })),
    );
  }

  /** The latest commits of the repository `owner/repo`, which fail as `commitActivity` does. */
  commits(owner: string, repo: string): Observable<Commit[]> {
    return this.part<CommitsAnswer>(owner, repo, 'commits').pipe(
      map(({ commits }) =>
        commits.map((commit) => ({
          sha: commit.sha,
          message: commit.message || undefined,
          author: commit.author || undefined,
          authorAvatarUrl: link(commit.author_avatar_url, ['https:']),
          committedAt: date(commit.committed_at),
          url: link(commit.url, ['https:']),
        })),
      ),
    );
  }

  /** The latest releases of the repository `owner/repo`, which fail as `commitActivity` does. */
  releases(owner: string, repo: string): Observable<Releases> {
    return this.part<ReleasesAnswer>(owner, repo, 'releases').pipe(
      map((answer) => {
        const releases = answer.releases.map((release) => ({
          tag: release.tag,
          name: release.name || undefined,
          publishedAt: date(release.published_at),
          prerelease: release.prerelease === true,
          url: link(release.url, ['https:']),
          target: release.target || undefined,
        }));
        return { releases, count: Math.max(answer.count ?? 0, releases.length) };
      }),
    );
  }

  /**
   * The commit activity of the repository `repo` of the organization `org`, for a row of its
   * repository list, which fails as `commitActivity` does. It counts as a load of the
   * organization's dashboard (FR-DATA-10).
   */
  organizationActivity(org: string, repo: string): Observable<CommitActivity> {
    return this.computed<CommitActivityAnswer>(
      `${organizationUrl(org)}/repositories/${encodeURIComponent(repo)}/commit-activity`,
    ).pipe(map(activity));
  }

  /**
   * Whether `name` is a user's account rather than an organization's (FR-SRCH-06), or `undefined`
   * when BuhTig cannot tell, as when there is no such account.
   */
  accountType(name: string): Observable<'user' | 'organization' | undefined> {
    return this.http.get<{ type: string }>(`/-/api/accounts/${encodeURIComponent(name)}`).pipe(
      map(({ type }) => (type === 'user' || type === 'organization' ? type : undefined)),
      catchError(() => of(undefined)),
    );
  }

  /**
   * Some of the repositories of the user `login`, `owner/repo`, those pushed to last first, to
   * suggest in place of a dashboard of the user (FR-SRCH-06). Any that the server gives a name no
   * repository can have is left out.
   */
  userRepositories(login: string): Observable<string[]> {
    return this.http
      .get<{
        repositories: { name: string }[];
      }>(`/-/api/users/${encodeURIComponent(login)}/repositories`)
      .pipe(
        map(({ repositories }) =>
          repositories.flatMap(({ name }) =>
            canonicalPath(name, 'repository') !== undefined ? [name] : [],
          ),
        ),
      );
  }

  /**
   * The server's answer about `part` of the repository `owner/repo`, such as its languages,
   * which fails with `Computing` while GitHub is still computing it (FR-REPO-10).
   */
  private part<T>(owner: string, repo: string, part: string): Observable<T> {
    return this.computed<T>(`${repositoryUrl(owner, repo)}/${part}`);
  }

  /** The server's answer at `url`, which fails with `Computing` while GitHub computes it. */
  private computed<T>(url: string): Observable<T> {
    return this.http.get<T>(url, { observe: 'response' }).pipe(
      map((response) => {
        if (response.status === HttpStatusCode.Accepted) {
          throw new Computing();
        }
        return response.body as T;
      }),
    );
  }
}

/** The commit activity that the server describes as `answer`. */
function activity(answer: CommitActivityAnswer): CommitActivity {
  const weeks = answer.weeks.flatMap(({ week, commits }) => {
    const start = date(week);
    return start !== undefined ? [{ start, commits }] : [];
  });
  return { weeks, total: weeks.reduce((total, week) => total + week.commits, 0) };
}

/** Why GitHub keeps a resource from the viewer, if `error` is the server's word that it does. */
function deniedBy(error: unknown): Denied | undefined {
  if (!(error instanceof HttpErrorResponse) || error.status !== HttpStatusCode.Forbidden) {
    return undefined;
  }
  const answer: { denied?: unknown; url?: string | null } | null = error.error;
  switch (answer?.denied) {
    case 'sso': {
      const url = link(answer.url, ['https:']);
      return { reason: 'sso', url: url && new URL(url).host === 'github.com' ? url : undefined };
    }
    case 'token':
      return { reason: 'token' };
    default:
      return undefined;
  }
}

/**
 * The path of the dashboard of `name`, an `owner/repo` or an `org` as the server gives it, if
 * it is one of a resource of `kind`, and nothing that `parse` would make one of, such as a URL.
 */
function canonicalPath(name: string, kind: Resource['kind']): string | undefined {
  const parsed = parse(name);
  const path = `/${name}`;
  return parsed.ok && parsed.resource.kind === kind && dashboardPath(parsed.resource) === path
    ? path
    : undefined;
}

function header(answer: RepositoryAnswer): Repository {
  const visibility = answer.visibility;
  const parent = answer.parent ?? undefined;
  return {
    name: answer.name,
    ownerAvatarUrl: link(answer.owner_avatar_url, ['https:']),
    description: answer.description || undefined,
    visibility: visibility === 'private' || visibility === 'internal' ? visibility : 'public',
    archived: answer.archived === true,
    template: answer.template === true,
    fork: answer.fork === true,
    parent:
      parent !== undefined && canonicalPath(parent, 'repository') !== undefined
        ? parent
        : undefined,
    topics: (answer.topics ?? []).filter((topic) => typeof topic === 'string'),
    license: answer.license || undefined,
    defaultBranch: answer.default_branch || undefined,
    homepage: link(answer.homepage, ['http:', 'https:']),
    createdAt: date(answer.created_at),
    pushedAt: date(answer.pushed_at),
  };
}

function organizationHeader(answer: OrganizationAnswer): Organization {
  return {
    login: answer.name,
    avatarUrl: link(answer.avatar_url, ['https:']),
    displayName: answer.display_name || undefined,
    description: answer.description || undefined,
    location: answer.location || undefined,
    website: link(answer.website, ['http:', 'https:']),
    createdAt: date(answer.created_at),
    verified: answer.verified === true,
  };
}

/** The time `text` tells, if it tells one. */
function date(text: string | null | undefined): Date | undefined {
  const time = new Date(text ?? NaN);
  return isNaN(time.getTime()) ? undefined : time;
}

/** `text` if it is an absolute URL with one of `protocols`, such as `https:`. */
function link(text: string | null | undefined, protocols: string[]): string | undefined {
  try {
    return text && protocols.includes(new URL(text).protocol) ? text : undefined;
  } catch {
    return undefined;
  }
}
