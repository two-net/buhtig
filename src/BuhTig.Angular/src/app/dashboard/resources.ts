import { HttpClient, HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, switchMap, tap, throwError } from 'rxjs';
import { Known, Owner, Resource, dashboardPath, parseName } from '../search/parse';
import { Computing, Failure, failureOf } from '../widget/load';
import { organizationUrl, repositoryUrl, resourceUrl, userUrl } from './urls';
import { GITHUB_HOST } from '../github/host';

/** What a dashboard learns of its repository, organization or user before its widgets load. */
export interface Summary {
  /**
   * The dashboard's path with the names as GitHub spells them (FR-NAV-04), and with the new
   * names of a repository that was renamed or transferred (FR-NAV-05). `undefined` when the
   * server's answer names no such resource.
   */
  path: string | undefined;
  /**
   * The resource at `path`, of the kind that GitHub tells, as of an account named alone, which is
   * an organization or a user (FR-SRCH-06). `undefined` when `path` is.
   */
  resource: Known | undefined;
  /** When BuhTig fetched the resource from GitHub (FR-DATA-06), unless the server says not. */
  fetchedAt: Date | undefined;
  /** What a repository's header shows, unless the resource is none, or the answer names none. */
  repository: Repository | undefined;
  /** What an organization's header shows, unless the resource is none, or the answer names none. */
  organization: Organization | undefined;
  /** What a user's header shows, unless the resource is none, or the answer names none. */
  user: User | undefined;
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

/**
 * When the data that a figure was made from was fetched, and why it is no newer, as a
 * comparison tells of each of its sections (FR-CMP-06), whose data may be fetched at other
 * times than the resource's.
 */
export interface Freshness {
  /** When BuhTig fetched the data from GitHub (FR-DATA-06), unless the server says not. */
  fetchedAt: Date | undefined;
  /** Why the data is older than `cache.ttl`, if it is (FR-DATA-05), as of a `Summary`. */
  stale: Stale | undefined;
}

/** `T`, with when the data it was made from was fetched. */
export type Dated<T> = T & Freshness;

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

/** What a user's header shows of them (FR-USER-01). What GitHub does not say is left out. */
export interface User {
  /** Their login, as GitHub spells it. */
  login: string;
  /** An `https` URL. */
  avatarUrl: string | undefined;
  /** The name they go by, if they give one. */
  displayName: string | undefined;
  bio: string | undefined;
  company: string | undefined;
  location: string | undefined;
  /** An `http` or `https` URL, the only kinds BuhTig links to (NFR-SEC-03). */
  website: string | undefined;
  createdAt: Date | undefined;
  /** How many follow them on GitHub. */
  followers: number;
  /** How many they follow. */
  following: number;
}

/**
 * What an organization's or a user's stat cards show (FR-ORG-02, FR-USER-02), of the
 * repositories the viewer may see.
 */
export interface OrganizationStats {
  repositories: number;
  /**
   * Those of the repositories that are private, which only a token user sees (FR-ORG-09): of a
   * user's, only the user themselves (FR-USER-06).
   */
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

/**
 * One of an organization's or a user's repositories, as its repository table lists it
 * (FR-ORG-03, FR-USER-04).
 */
export interface ListedRepository {
  /** Its name, without its owner's, as GitHub spells it. */
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

/** One of the 10 repositories of an organization or a user with the most stars (FR-ORG-05). */
export interface TopRepository {
  /** Its name, without its owner's, as GitHub spells it. */
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

/**
 * How a repository's pull requests updated last came to an end (FR-REPO-13). Their merge ratio
 * is `merged` of `merged` and `closed` together.
 */
export interface MergeVelocity {
  /** How many pull requests were read: up to the 100 updated last. */
  sampled: number;
  /** Those of them that were merged. */
  merged: number;
  /** Those of them that were closed without being merged. */
  closed: number;
  /** The median time from opening to merging, in seconds, unless none were merged. */
  medianTimeToMerge: number | undefined;
  /** Whether the repository has more pull requests than were read. */
  truncated: boolean;
}

/** How long a repository's open issues updated last have been open (FR-REPO-13). */
export interface IssueAge {
  /**
   * How many open issues were read: those among the 100 open issues and pull requests updated
   * last.
   */
  sampled: number;
  /** The median time since they were opened, in seconds, unless there were none. */
  medianAge: number | undefined;
  /** Whether the repository has more open issues and pull requests than were read. */
  truncated: boolean;
}

/**
 * How a repository's latest GitHub Actions workflow runs for pushes to its default branch fared
 * (FR-REPO-14). Their pass rate is `passed` of `passed` and `failed` together.
 */
export interface WorkflowRuns {
  /** Its default branch, unless it has none. */
  branch: string | undefined;
  /** How many runs were read: up to the 50 latest. */
  sampled: number;
  /** Those of them that succeeded. */
  passed: number;
  /** Those of them that failed, timed out or could not start. */
  failed: number;
  /** The mean time that the completed runs took, in seconds, unless none had completed. */
  averageDuration: number | undefined;
  /** The latest run, unless there is none. */
  latest: WorkflowRun | undefined;
  /**
   * Whether GitHub would not list the runs to the viewer's credential, as to a personal access
   * token without access to Actions.
   */
  hidden: boolean;
}

export interface WorkflowRun {
  /** The name of its workflow. */
  name: string | undefined;
  /** Where it is, as GitHub says, such as `queued`, `in_progress` or `completed`. */
  status: string | undefined;
  /** How it ended, once it has, as GitHub says, such as `success` or `failure`. */
  conclusion: string | undefined;
  startedAt: Date | undefined;
  /** Its page on GitHub (FR-REPO-12). */
  url: string | undefined;
}

/**
 * A part of what a watchlist shows of a repository (FR-PERS-08), with when its data was fetched,
 * or why it failed, apart from the rest, which still shows.
 */
export type GlancePart<T> = ({ ok: true } & Dated<T>) | { ok: false; failure: Failure };

/**
 * What a watchlist shows of one of its repositories (FR-PERS-08): what its header shows, its
 * latest release, and how its latest workflow runs on the default branch fared, each read as its
 * dashboard reads it, with the viewer's own credential (FR-PERS-09).
 */
export interface Glance extends Freshness {
  /** The path of its dashboard, with the names as GitHub spells them, unless the answer names none. */
  path: string | undefined;
  repository: Repository;
  /** The release GitHub marks as the latest, `undefined` when there is none. */
  latestRelease: GlancePart<{ release: Release | undefined }>;
  workflowRuns: GlancePart<WorkflowRuns>;
}

/**
 * What the server answers about one of a watchlist's repositories (FR-PERS-08): what it shows of
 * it, or that GitHub says there is no such repository, which it says too of one the viewer may not
 * see (FR-ACC-05), or keeps it from the viewer's credential (FR-PAT-08), or that its name cannot be
 * a repository's (FR-SRCH-04).
 */
export type Glanced =
  | { status: 'found'; glance: Glance }
  | { status: 'not-found' }
  | { status: 'invalid' }
  | { status: 'denied'; denied: Denied };

/** How many lines were added to and deleted from a repository each week (FR-REPO-15). */
export interface CodeFrequency {
  /** The last 52, oldest first, the current one last, or none for an empty repository. */
  weeks: WeekOfChanges[];
  /** The lines added in all the weeks together. */
  additions: number;
  /** The lines deleted in all the weeks together. */
  deletions: number;
  /** Whether GitHub does not compute it, as for repositories with 10,000 commits or more. */
  tooLarge: boolean;
}

export interface WeekOfChanges {
  /** The Sunday it starts on, at midnight UTC, as GitHub counts weeks. */
  start: Date;
  additions: number;
  deletions: number;
}

/**
 * How a repository's stat cards' figures changed, as BuhTig observed them as its dashboard was
 * opened, in the viewer's scope (FR-REPO-17, FR-DATA-13, FR-DATA-14). Observations are only as
 * frequent as the views: the days without one are gaps, never zeros.
 */
export interface Trends {
  /** Whether what was observed was read with the viewer's own token, for them alone. */
  scope: 'shared' | 'private';
  /** How many days observations are kept. */
  keptDays: number;
  /** When the oldest observation kept was made, unless there are none. */
  trackingSince: Date | undefined;
  /** One a day at most, the latest of each, oldest first. */
  observations: Observation[];
  /** The runs of days between the first observation and the latest without one. */
  gaps: { from: Date; to: Date }[];
  /** The changes over 7, 30 and 90 days, where the observations allow. */
  periods: Period[];
}

/** What a repository's stat cards showed when BuhTig read them from GitHub. */
export interface Observation {
  /** The UTC day it is of, at midnight UTC. */
  day: Date;
  /** When GitHub gave the repository, whose stars, forks and open issues these are. */
  observedAt: Date;
  /** When GitHub counted the open pull requests, within minutes of `observedAt`. */
  pullRequestsObservedAt: Date;
  figures: TrendFigures;
}

/** The figures that trends follow, or how much each changed. */
export interface TrendFigures {
  stars: number;
  forks: number;
  /** Without the open pull requests, which GitHub counts as open issues too. */
  openIssues: number;
  openPullRequests: number;
}

/**
 * The change over a period to the latest observation from the one nearest to a period before it,
 * or why there is none (FR-DATA-14).
 */
export type Period = {
  days: number;
  /** The first UTC day of the period, and how many of its days have an observation. */
  firstDay: Date | undefined;
  observedDays: number;
  /** The time a period before the latest observation, near which the baseline must be. */
  target: Date | undefined;
} & (
  | { supported: true; from: Observation; to: Observation; changes: TrendFigures }
  | { supported: false; reason: Unsupported }
);

/**
 * Why a period has no change: nothing observed, only one observation, the first after the
 * period's start, or none near its start, between observations before and after.
 */
export type Unsupported =
  'no_observations' | 'first_observation' | 'tracked_later' | 'no_observation_then';

/** How often a repository was released, and downloaded, over its latest releases (FR-REPO-16). */
export interface ReleaseCadence {
  /** How many releases were read: up to the 100 latest, without drafts. */
  sampled: number;
  /** Those of them that are not pre-releases. */
  stable: number;
  prereleases: number;
  /** The mean time from one release to the next, in seconds, unless there are fewer than two. */
  averageInterval: number | undefined;
  /** How many files they have, their assets. */
  assets: number;
  /** How many times their assets were downloaded. */
  downloads: number;
  /** Whether the repository has more releases than were read. */
  truncated: boolean;
}

/** The server's answer about a repository, an organization or a user. */
interface Answer {
  name: string;
  fetched_at?: string;
  stale?: string | null;
  repository?: RepositoryAnswer;
  organization?: OrganizationAnswer;
  user?: UserAnswer;
}

/** The server's answer about whether an account is an organization or a user (FR-SRCH-06). */
interface AccountAnswer {
  type: string;
  login?: string;
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

/** The server's answer about a user, for their header. */
interface UserAnswer {
  name: string;
  fetched_at?: string;
  stale?: string | null;
  avatar_url?: string | null;
  display_name?: string | null;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  website?: string | null;
  created_at?: string | null;
  followers?: number;
  following?: number;
}

/** The server's answer about an organization or a user, for its stat cards. */
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

/** The server's answer about an organization or a user, for its repository table. */
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
  latest_release: ReleaseAnswer | null;
}

/** The server's answer about a release, as its stat card shows it. */
interface ReleaseAnswer {
  tag: string;
  published_at: string | null;
  url: string | null;
}

/** The server's word that a part of a repository's glance failed alone (FR-PERS-08). */
interface PartFailureAnswer {
  failure: string;
}

/** The server's answer about one of a watchlist's repositories (FR-PERS-08). */
interface GlanceAnswer extends RepositoryAnswer {
  latest_release?: (DatedAnswer & { release: ReleaseAnswer | null }) | PartFailureAnswer | null;
  workflow_runs: WorkflowRunsAnswer | PartFailureAnswer;
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

/** The server's answer about a figure of a repository, with when its data was fetched. */
interface DatedAnswer {
  fetched_at?: string | null;
  stale?: string | null;
}

/** The server's answer about a repository, for how its pull requests are merged. */
interface MergeVelocityAnswer extends DatedAnswer {
  sampled: number;
  merged: number;
  closed: number;
  median_time_to_merge: number | null;
  truncated: boolean;
}

/** The server's answer about a repository, for how long its open issues have been open. */
interface IssueAgeAnswer extends DatedAnswer {
  sampled: number;
  median_age: number | null;
  truncated: boolean;
}

/** The server's answer about a repository, for how its workflow runs fared. */
interface WorkflowRunsAnswer extends DatedAnswer {
  branch: string | null;
  sampled: number;
  passed: number;
  failed: number;
  average_duration: number | null;
  latest: {
    name: string | null;
    status: string | null;
    conclusion: string | null;
    started_at: string | null;
    url: string | null;
  } | null;
  hidden: boolean;
}

/** The server's answer about a repository, for its code frequency chart. */
interface CodeFrequencyAnswer {
  weeks: { week: string; additions: number; deletions: number }[];
  too_large: boolean;
}

/** The server's answer about what was observed of a repository, as one observation tells it. */
interface ObservationAnswer {
  day: string;
  observed_at: string;
  pull_requests_observed_at: string;
  stars: number;
  forks: number;
  open_issues: number;
  open_pull_requests: number;
}

/** The server's answer about how a repository's figures changed. */
interface TrendsAnswer extends DatedAnswer {
  scope: string;
  kept_days: number;
  tracking_since: string | null;
  observations: ObservationAnswer[];
  gaps: { from: string; to: string }[];
  periods: {
    days: number;
    target?: string;
    first_day?: string;
    observed_days?: number;
    supported: boolean;
    reason?: string;
    from?: ObservationAnswer;
    to?: ObservationAnswer;
    changes?: { stars: number; forks: number; open_issues: number; open_pull_requests: number };
  }[];
}

/** The server's answer about a repository, for how often it is released. */
interface ReleaseCadenceAnswer extends DatedAnswer {
  sampled: number;
  stable: number;
  prereleases: number;
  average_interval: number | null;
  assets?: number;
  downloads: number;
  truncated: boolean;
}

/** What BuhTig knows of repositories and organizations as a whole. */
@Injectable({ providedIn: 'root' })
export class Resources {
  private readonly http = inject(HttpClient);
  private readonly gitHub = inject(GITHUB_HOST);

  private readonly refreshCount = signal(0);

  /**
   * How many times the viewer has refreshed a dashboard, so that what the dashboard shows is
   * asked for again each time (FR-DATA-07).
   */
  readonly refreshes = this.refreshCount.asReadonly();

  /**
   * What BuhTig knows of `resource`: what it is, or that GitHub says there is no such resource,
   * or keeps it from the viewer's credential, or that its name cannot be one, or why BuhTig
   * cannot tell now. An account named alone is first told to be an organization or a user, by
   * the server, which asks GitHub once for both (FR-SRCH-06, FR-DATA-10).
   */
  summary(resource: Resource): Observable<Summary> {
    return this.answer(resource).pipe(
      map(({ kind, answer }): Summary => {
        const path = canonicalPath(answer.name, kind);
        const known = path !== undefined ? resourceAt(path, kind) : undefined;
        return {
          path,
          resource: known,
          fetchedAt: date(answer.fetched_at),
          stale: staleOf(answer.stale),
          failure: undefined,
          repository:
            answer.repository !== undefined && known ? header(answer.repository) : undefined,
          organization:
            answer.organization !== undefined && known
              ? organizationHeader(answer.organization)
              : undefined,
          user: answer.user !== undefined && known ? userHeader(answer.user) : undefined,
          denied: undefined,
          notFound: false,
          invalid: false,
        };
      }),
      catchError((error: unknown) => {
        const denied = deniedBy(error, this.gitHub);
        const status = error instanceof HttpErrorResponse ? error.status : undefined;
        const notFound = status === HttpStatusCode.NotFound;
        const invalid = status === HttpStatusCode.BadRequest;
        return of<Summary>({
          path: undefined,
          resource: undefined,
          fetchedAt: undefined,
          repository: undefined,
          organization: undefined,
          user: undefined,
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
   * The server's answer about `resource`, and its kind. Of an account named alone, the answer
   * about the organization or the user that the server says it is, by the name the URL has, so
   * that the server reads what it cached as it told. An organization's URL, such as
   * `/orgs/{name}/people`, may name a user instead, whose answer it then is.
   */
  private answer(resource: Resource): Observable<{ kind: Known['kind']; answer: Answer }> {
    switch (resource.kind) {
      case 'repository':
        return this.http
          .get<RepositoryAnswer>(repositoryUrl(resource.owner, resource.repo))
          .pipe(
            map((repository) => ({ kind: resource.kind, answer: { ...repository, repository } })),
          );
      case 'organization':
        return this.organizationAnswer(resource.org).pipe(
          catchError((error: unknown) =>
            error instanceof HttpErrorResponse && error.status === HttpStatusCode.NotFound
              ? this.accountType(resource.org).pipe(
                  switchMap((type) =>
                    type === 'user' ? this.userAnswer(resource.org) : throwError(() => error),
                  ),
                )
              : throwError(() => error),
          ),
        );
      case 'user':
        return this.userAnswer(resource.login);
      case 'account':
        return this.http.get<AccountAnswer>(accountUrl(resource.name)).pipe(
          switchMap(({ type }) => {
            switch (type) {
              case 'organization':
                return this.organizationAnswer(resource.name);
              case 'user':
                return this.userAnswer(resource.name);
              default:
                throw new Error(`the server says ${resource.name} is an account of no kind known`);
            }
          }),
        );
    }
  }

  private organizationAnswer(org: string): Observable<{ kind: 'organization'; answer: Answer }> {
    return this.http.get<OrganizationAnswer>(organizationUrl(org)).pipe(
      map((organization) => ({
        kind: 'organization',
        answer: { ...organization, organization },
      })),
    );
  }

  private userAnswer(login: string): Observable<{ kind: 'user'; answer: Answer }> {
    return this.http
      .get<UserAnswer>(userUrl(login))
      .pipe(map((user) => ({ kind: 'user', answer: { ...user, user } })));
  }

  /**
   * Asks the server to fetch `resource`'s dashboard from GitHub anew, which only signed-in
   * users may, once a minute (FR-DATA-07, FR-ACC-02). Once it has, what the dashboard shows is
   * asked for again.
   */
  refresh(resource: Known): Observable<Refreshed> {
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
      map((stats) => ({
        stars: stats.stars,
        forks: stats.forks,
        watchers: stats.watchers,
        openIssues: stats.open_issues,
        openPullRequests: stats.open_pull_requests,
        latestRelease: release(stats.latest_release),
      })),
    );
  }

  /**
   * What a watchlist shows of the repository `owner/repo` (FR-PERS-08), or why GitHub shows the
   * viewer none of it. It fails only when BuhTig cannot tell now, as `summary` does, with the
   * `Failure` that its status says. A part that failed alone, such as its latest release, says so
   * in its place.
   */
  glance(owner: string, repo: string): Observable<Glanced> {
    return this.http.get<GlanceAnswer>(`${repositoryUrl(owner, repo)}/glance`).pipe(
      map((answer): Glanced => {
        const latest = answer.latest_release;
        const runs = answer.workflow_runs;
        return {
          status: 'found',
          glance: {
            path: canonicalPath(answer.name, 'repository'),
            repository: header(answer),
            ...freshness(answer),
            latestRelease: isFailure(latest)
              ? { ok: false, failure: partFailure(latest.failure) }
              : { ok: true, release: release(latest?.release), ...freshness(latest ?? {}) },
            workflowRuns: isFailure(runs)
              ? { ok: false, failure: partFailure(runs.failure) }
              : { ok: true, ...workflowRuns(runs) },
          },
        };
      }),
      catchError((error: unknown) => {
        const denied = deniedBy(error, this.gitHub);
        if (denied) {
          return of<Glanced>({ status: 'denied', denied });
        }
        switch (error instanceof HttpErrorResponse ? error.status : undefined) {
          case HttpStatusCode.NotFound:
            return of<Glanced>({ status: 'not-found' });
          case HttpStatusCode.BadRequest:
            return of<Glanced>({ status: 'invalid' });
          default:
            return throwError(() => error);
        }
      }),
    );
  }

  /**
   * The figures of the stat cards of the organization or user `owner`, which fail as it does
   * (FR-ORG-02, FR-USER-02).
   */
  accountStats(owner: Owner): Observable<OrganizationStats> {
    return this.http.get<OrganizationStatsAnswer>(`${resourceUrl(owner)}/stats`).pipe(
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
   * The repositories of the organization or user `owner` that its repository table lists, pushed
   * to most recently first, which fail as `accountStats` does. Any that the server gives a name
   * no repository can have is left out.
   */
  accountRepositories(owner: Owner): Observable<ListedRepository[]> {
    const login = nameOf(owner);
    return this.http.get<OrganizationRepositoriesAnswer>(`${resourceUrl(owner)}/repositories`).pipe(
      map(({ repositories }) =>
        repositories.flatMap((repository): ListedRepository[] => {
          const path = canonicalPath(`${login}/${repository.name}`, 'repository');
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
   * How many of the repositories of the organization or user `owner` have each primary language,
   * which fails as `accountStats` does.
   */
  accountLanguages(owner: Owner): Observable<LanguageCounts> {
    return this.http.get<LanguageCounts>(`${resourceUrl(owner)}/languages`);
  }

  /**
   * The repositories of the organization or user `owner` with the most stars, most first, which
   * fail as `accountStats` does. Any that the server gives a name no repository can have is
   * left out.
   */
  topRepositories(owner: Owner): Observable<TopRepository[]> {
    const login = nameOf(owner);
    return this.http.get<TopRepositoriesAnswer>(`${resourceUrl(owner)}/top-repositories`).pipe(
      map(({ repositories }) =>
        repositories.flatMap(({ name, stars }): TopRepository[] => {
          const path = canonicalPath(`${login}/${name}`, 'repository');
          return path !== undefined ? [{ name, path, stars }] : [];
        }),
      ),
    );
  }

  /**
   * How many of the repositories of the organization or user `owner` were last pushed to in each
   * period, which fails as `accountStats` does.
   */
  lastPush(owner: Owner): Observable<LastPush> {
    return this.http.get<LastPushAnswer>(`${resourceUrl(owner)}/last-push`).pipe(
      map((answer) => ({
        last7Days: answer.last_7_days,
        last30Days: answer.last_30_days,
        last12Months: answer.last_12_months,
        older: answer.older,
      })),
    );
  }

  /**
   * How many of the repositories of the organization or user `owner` were created in each year,
   * oldest first, which fails as `accountStats` does.
   */
  createdPerYear(owner: Owner): Observable<YearCount[]> {
    return this.http
      .get<CreatedPerYearAnswer>(`${resourceUrl(owner)}/created-per-year`)
      .pipe(map(({ years }) => years));
  }

  /**
   * The members of the organization `org` that the viewer may see, which fail as `accountStats`
   * does. A user has none.
   */
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
   * How the pull requests of the repository `owner/repo` updated last came to an end, which
   * fails as `commitActivity` does (FR-REPO-13).
   */
  mergeVelocity(owner: string, repo: string): Observable<Dated<MergeVelocity>> {
    return this.part<MergeVelocityAnswer>(owner, repo, 'merge-velocity').pipe(
      map((answer) => ({
        sampled: count(answer.sampled),
        merged: count(answer.merged),
        closed: count(answer.closed),
        medianTimeToMerge: seconds(answer.median_time_to_merge),
        truncated: answer.truncated === true,
        ...freshness(answer),
      })),
    );
  }

  /**
   * How long the open issues of the repository `owner/repo` updated last have been open, which
   * fails as `commitActivity` does (FR-REPO-13).
   */
  issueAge(owner: string, repo: string): Observable<Dated<IssueAge>> {
    return this.part<IssueAgeAnswer>(owner, repo, 'issue-age').pipe(
      map((answer) => ({
        sampled: count(answer.sampled),
        medianAge: seconds(answer.median_age),
        truncated: answer.truncated === true,
        ...freshness(answer),
      })),
    );
  }

  /**
   * How the latest workflow runs on the default branch of the repository `owner/repo` fared,
   * which fail as `commitActivity` does (FR-REPO-14).
   */
  workflowRuns(owner: string, repo: string): Observable<Dated<WorkflowRuns>> {
    return this.part<WorkflowRunsAnswer>(owner, repo, 'workflow-runs').pipe(map(workflowRuns));
  }

  /**
   * How many lines were added to and deleted from the repository `owner/repo` each week, which
   * fails with `Computing` while GitHub is still computing it (FR-REPO-10, FR-REPO-15), and
   * otherwise as `commitActivity` does. Weeks it cannot date are left out.
   */
  codeFrequency(owner: string, repo: string): Observable<CodeFrequency> {
    return this.part<CodeFrequencyAnswer>(owner, repo, 'code-frequency').pipe(
      map((answer) => {
        const weeks = answer.weeks.flatMap(({ week, additions, deletions }) => {
          const start = date(week);
          return start !== undefined
            ? [{ start, additions: count(additions), deletions: count(deletions) }]
            : [];
        });
        return {
          weeks,
          additions: weeks.reduce((total, week) => total + week.additions, 0),
          deletions: weeks.reduce((total, week) => total + week.deletions, 0),
          tooLarge: answer.too_large === true,
        };
      }),
    );
  }

  /**
   * How the stat cards' figures of the repository `owner/repo` changed, as BuhTig observed them
   * in the viewer's scope (FR-REPO-17), which fails as `commitActivity` does. Observations it
   * cannot date are left out, and so are the periods that would be between them.
   */
  trends(owner: string, repo: string): Observable<Dated<Trends>> {
    return this.part<TrendsAnswer>(owner, repo, 'trends').pipe(map(trends));
  }

  /**
   * How often the repository `owner/repo` was released, and downloaded, over its latest
   * releases, which fails as `commitActivity` does (FR-REPO-16).
   */
  releaseCadence(owner: string, repo: string): Observable<Dated<ReleaseCadence>> {
    return this.part<ReleaseCadenceAnswer>(owner, repo, 'release-cadence').pipe(
      map((answer) => ({
        sampled: count(answer.sampled),
        stable: count(answer.stable),
        prereleases: count(answer.prereleases),
        averageInterval: seconds(answer.average_interval),
        assets: count(answer.assets),
        downloads: count(answer.downloads),
        truncated: answer.truncated === true,
        ...freshness(answer),
      })),
    );
  }

  /**
   * The commit activity of the repository `repo` of the organization or user `owner`, for a row
   * of its repository list, which fails as `commitActivity` does. It counts as a load of the
   * account's dashboard (FR-DATA-10).
   */
  accountActivity(owner: Owner, repo: string): Observable<CommitActivity> {
    return this.computed<CommitActivityAnswer>(
      `${resourceUrl(owner)}/repositories/${encodeURIComponent(repo)}/commit-activity`,
    ).pipe(map(activity));
  }

  /**
   * Whether `name` is a user's account or an organization's (FR-SRCH-06), or `undefined` when
   * BuhTig cannot tell, as when there is no such account.
   */
  accountType(name: string): Observable<'user' | 'organization' | undefined> {
    return this.http.get<AccountAnswer>(accountUrl(name)).pipe(
      map(({ type }) => (type === 'user' || type === 'organization' ? type : undefined)),
      catchError(() => of(undefined)),
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

/** What the server tells of how a repository's figures changed, as `answer`. */
function trends(answer: TrendsAnswer): Dated<Trends> {
  const observations = (answer.observations ?? []).flatMap((observation) => {
    const told = observed(observation);
    return told ? [told] : [];
  });
  const gaps = (answer.gaps ?? []).flatMap(({ from, to }) => {
    const [start, end] = [date(from), date(to)];
    return start && end ? [{ from: start, to: end }] : [];
  });
  const periods = (answer.periods ?? []).map((period): Period => {
    const told = {
      days: count(period.days),
      firstDay: date(period.first_day),
      observedDays: count(period.observed_days),
      target: date(period.target),
    };
    const from = period.from && observed(period.from);
    const to = period.to && observed(period.to);
    if (period.supported === true && from && to && period.changes) {
      const changes = period.changes;
      return {
        ...told,
        supported: true,
        from,
        to,
        changes: {
          stars: change(changes.stars),
          forks: change(changes.forks),
          openIssues: change(changes.open_issues),
          openPullRequests: change(changes.open_pull_requests),
        },
      };
    }
    return { ...told, supported: false, reason: unsupported(period.reason) };
  });
  return {
    scope: answer.scope === 'private' ? 'private' : 'shared',
    keptDays: count(answer.kept_days),
    trackingSince: date(answer.tracking_since),
    observations,
    gaps,
    periods,
    ...freshness(answer),
  };
}

/** An observation as the server tells it, unless it cannot be dated. */
function observed(answer: ObservationAnswer): Observation | undefined {
  const [day, observedAt, pullRequestsObservedAt] = [
    date(answer.day),
    date(answer.observed_at),
    date(answer.pull_requests_observed_at),
  ];
  return day && observedAt && pullRequestsObservedAt
    ? {
        day,
        observedAt,
        pullRequestsObservedAt,
        figures: {
          stars: count(answer.stars),
          forks: count(answer.forks),
          openIssues: count(answer.open_issues),
          openPullRequests: count(answer.open_pull_requests),
        },
      }
    : undefined;
}

/** Why a period has no change, as the server tells it, or that nothing was observed then. */
function unsupported(reason: unknown): Unsupported {
  switch (reason) {
    case 'no_observations':
    case 'first_observation':
    case 'tracked_later':
      return reason;
    default:
      return 'no_observation_then';
  }
}

/** How the workflow runs that the server describes as `answer` fared (FR-REPO-14). */
function workflowRuns(answer: WorkflowRunsAnswer): Dated<WorkflowRuns> {
  const latest = answer.latest;
  return {
    branch: answer.branch || undefined,
    sampled: count(answer.sampled),
    passed: count(answer.passed),
    failed: count(answer.failed),
    averageDuration: seconds(answer.average_duration),
    latest: latest
      ? {
          name: latest.name || undefined,
          status: latest.status || undefined,
          conclusion: latest.conclusion || undefined,
          startedAt: date(latest.started_at),
          url: link(latest.url, ['https:']),
        }
      : undefined,
    hidden: answer.hidden === true,
    ...freshness(answer),
  };
}

/** The release that the server describes as `answer`, if it describes one. */
function release(answer: ReleaseAnswer | null | undefined): Release | undefined {
  return answer
    ? {
        tag: answer.tag,
        publishedAt: date(answer.published_at),
        url: link(answer.url, ['https:']),
      }
    : undefined;
}

/** Whether `part` of a repository's glance is the server's word that it failed alone. */
function isFailure(part: object | null | undefined): part is PartFailureAnswer {
  return typeof part === 'object' && part !== null && 'failure' in part;
}

/** Why a part of a repository's glance failed alone, as the server tells it (FR-PERS-08). */
function partFailure(value: unknown): Failure {
  return value === 'held' || value === 'unavailable' ? value : 'github';
}

/** The commit activity that the server describes as `answer`. */
function activity(answer: CommitActivityAnswer): CommitActivity {
  const weeks = answer.weeks.flatMap(({ week, commits }) => {
    const start = date(week);
    return start !== undefined ? [{ start, commits }] : [];
  });
  return { weeks, total: weeks.reduce((total, week) => total + week.commits, 0) };
}

/**
 * Why GitHub keeps a resource from the viewer, if `error` is the server's word that it does,
 * with where to authorize single sign-on if it is a page on GitHub at `host`.
 */
function deniedBy(error: unknown, host: string): Denied | undefined {
  if (!(error instanceof HttpErrorResponse) || error.status !== HttpStatusCode.Forbidden) {
    return undefined;
  }
  const answer: { denied?: unknown; url?: string | null } | null = error.error;
  switch (answer?.denied) {
    case 'sso': {
      const url = link(answer.url, ['https:']);
      return { reason: 'sso', url: url && new URL(url).host === host ? url : undefined };
    }
    case 'token':
      return { reason: 'token' };
    default:
      return undefined;
  }
}

/**
 * The path of the dashboard of `name`, an `owner/repo`, or the login of an organization or a
 * user, as the server gives it, if it is one of a resource of `kind`, and nothing that `parse`
 * would make one of, such as a URL. `parse` takes a login alone as an account's, of either kind.
 */
function canonicalPath(name: string, kind: Known['kind']): string | undefined {
  const parsed = parseName(name);
  const path = `/${name}`;
  return parsed.ok &&
    parsed.resource.kind === (kind === 'repository' ? 'repository' : 'account') &&
    dashboardPath(parsed.resource) === path
    ? path
    : undefined;
}

/** The resource of `kind` whose dashboard's path is `path`, such as `/owner/repo`. */
function resourceAt(path: string, kind: Known['kind']): Known {
  const name = path.slice(1);
  switch (kind) {
    case 'organization':
      return { kind, org: name };
    case 'user':
      return { kind, login: name };
    case 'repository': {
      const [owner, repo] = name.split('/');
      return { kind, owner, repo };
    }
  }
}

/** Where the server says whether the account `name` is an organization or a user (FR-SRCH-06). */
function accountUrl(name: string): string {
  return `/-/api/accounts/${encodeURIComponent(name)}`;
}

/** The login of the organization or user `owner`. */
export function nameOf(owner: Owner): string {
  return owner.kind === 'organization' ? owner.org : owner.login;
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

function userHeader(answer: UserAnswer): User {
  return {
    login: answer.name,
    avatarUrl: link(answer.avatar_url, ['https:']),
    displayName: answer.display_name || undefined,
    bio: answer.bio || undefined,
    company: answer.company || undefined,
    location: answer.location || undefined,
    website: link(answer.website, ['http:', 'https:']),
    createdAt: date(answer.created_at),
    followers: count(answer.followers),
    following: count(answer.following),
  };
}

/** `value` if it is a count, or else none. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** `value` if it is a whole change, up or down, or else none. */
function change(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

/** `value` if it is a span of time in seconds, or else none. */
function seconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Why data is no newer, as the server tells it, if it tells one BuhTig knows (FR-DATA-05). */
function staleOf(value: unknown): Stale | undefined {
  return value === 'held' || value === 'github' ? value : undefined;
}

/** When the data of `answer` was fetched, and why it is no newer, as the server tells them. */
function freshness(answer: DatedAnswer): Freshness {
  return { fetchedAt: date(answer.fetched_at), stale: staleOf(answer.stale) };
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
