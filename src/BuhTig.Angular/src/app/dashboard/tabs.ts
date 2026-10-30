import { UrlMatchResult, UrlSegment } from '@angular/router';
import { IconName } from '../icon/icon';

// A dashboard's tabs, each at the path of the matching page on GitHub, so that replacing
// `github.com` with BuhTig's host in a GitHub link opens the matching tab (FR-NAV-02). Apart
// from the dashboard's code, since the routes need them.

/** The tabs of a repository's dashboard. */
export type RepositoryTab =
  'overview' | 'activity' | 'issues' | 'pulls' | 'contributors' | 'releases';

/** The tabs of an organization's dashboard. */
export type OrganizationTab = 'overview' | 'repositories' | 'people';

/** Where each of a repository's tabs is, below `/{owner}/{repo}`, as on GitHub. */
const REPOSITORY_PATHS: Record<RepositoryTab, string> = {
  overview: '',
  activity: 'activity',
  issues: 'issues',
  pulls: 'pulls',
  contributors: 'graphs/contributors',
  releases: 'releases',
};

/** A tab, as a dashboard's tab bar shows it. */
export interface TabInfo<T extends string> {
  tab: T;
  label: string;
  icon: IconName;
}

export const REPOSITORY_TABS: TabInfo<RepositoryTab>[] = [
  { tab: 'overview', label: 'Overview', icon: 'repo' },
  { tab: 'activity', label: 'Activity', icon: 'pulse' },
  { tab: 'issues', label: 'Issues', icon: 'issue' },
  { tab: 'pulls', label: 'Pull requests', icon: 'pr' },
  { tab: 'contributors', label: 'Contributors', icon: 'people' },
  { tab: 'releases', label: 'Releases', icon: 'tag' },
];

export const ORGANIZATION_TABS: TabInfo<OrganizationTab>[] = [
  { tab: 'overview', label: 'Overview', icon: 'home' },
  { tab: 'repositories', label: 'Repositories', icon: 'repo' },
  { tab: 'people', label: 'People', icon: 'people' },
];

/** The path of a repository's `tab`, such as `/owner/repo/graphs/contributors`. */
export function repositoryTabPath(name: string, tab: RepositoryTab): string {
  const below = REPOSITORY_PATHS[tab];
  return below ? `/${name}/${below}` : `/${name}`;
}

/** The path of an organization's `tab`, such as `/orgs/org/people`, or `/org` for its overview. */
export function organizationTabPath(org: string, tab: OrganizationTab): string {
  return tab === 'overview' ? `/${org}` : `/orgs/${org}/${tab}`;
}

/** The tab of a repository's dashboard at `below`, the path below `/{owner}/{repo}`. */
function repositoryTabAt(below: string): RepositoryTab | undefined {
  return (Object.keys(REPOSITORY_PATHS) as RepositoryTab[]).find(
    (tab) => REPOSITORY_PATHS[tab] === below,
  );
}

/**
 * Matches a repository's dashboard, at `/{owner}/{repo}` or one of its tabs, giving the
 * parameters `owner`, `repo` and `tab`. Other paths below it are the server's to redirect.
 */
export function repositoryMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  const [owner, repo, ...below] = segments;
  if (repo === undefined || owner.path === '-' || owner.path.toLowerCase() === 'orgs') {
    return null;
  }
  const tab = repositoryTabAt(below.map((segment) => segment.path).join('/'));
  return tab === undefined
    ? null
    : { consumed: segments, posParams: { owner, repo, tab: new UrlSegment(tab, {}) } };
}

/**
 * Matches an organization's dashboard, at `/{org}`, `/orgs/{org}/repositories` or
 * `/orgs/{org}/people`, whatever the letter case of `orgs` and the tab, giving the parameters
 * `org` and `tab`.
 */
export function organizationMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length === 1 && segments[0].path !== '-') {
    return {
      consumed: segments,
      posParams: { org: segments[0], tab: new UrlSegment('overview', {}) },
    };
  }
  const [orgs, org, tab] = segments;
  const name = tab?.path.toLowerCase();
  if (
    segments.length === 3 &&
    orgs.path.toLowerCase() === 'orgs' &&
    (name === 'repositories' || name === 'people')
  ) {
    return { consumed: segments, posParams: { org, tab: new UrlSegment(name, {}) } };
  }
  return null;
}

/**
 * Which dashboard `url` is of, whatever its tab and the letter case of its names, such as
 * `repository:owner/repo`, or `undefined` for a page that is no dashboard's.
 */
export function dashboardOf(url: string): string | undefined {
  const segments = url.split(/[?#]/)[0].split('/').filter(Boolean);
  const [first, second] = segments;
  if (first === undefined || first === '-') {
    return undefined;
  }
  // `/orgs` alone is the dashboard of an organization of that name, as the routes take it.
  if (first.toLowerCase() === 'orgs' && second !== undefined) {
    return `organization:${second.toLowerCase()}`;
  }
  return second === undefined
    ? `organization:${first.toLowerCase()}`
    : `repository:${first.toLowerCase()}/${second.toLowerCase()}`;
}
