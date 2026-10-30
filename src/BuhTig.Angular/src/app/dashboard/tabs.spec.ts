import { UrlMatchResult, UrlSegment } from '@angular/router';
import {
  ORGANIZATION_TABS,
  REPOSITORY_TABS,
  dashboardOf,
  organizationMatcher,
  organizationTabPath,
  repositoryMatcher,
  repositoryTabPath,
} from './tabs';

/** The segments of `path`, as the router gives them to a matcher. */
function segments(path: string): UrlSegment[] {
  return path
    .split('/')
    .filter((part) => part !== '')
    .map((part) => new UrlSegment(part, {}));
}

/** What `matcher` takes from `path`: its parameters by name, or `null` if it is not its. */
function match(
  matcher: (segments: UrlSegment[]) => UrlMatchResult | null,
  path: string,
): Record<string, string> | null {
  const all = segments(path);
  const result = matcher(all);
  if (result === null) {
    return null;
  }
  // A dashboard is the whole path, with nothing below it for another route.
  expect(result.consumed, path).toEqual(all);
  return Object.fromEntries(
    Object.entries(result.posParams ?? {}).map(([name, segment]) => [name, segment.path]),
  );
}

describe('repositoryMatcher (FR-NAV-01, FR-NAV-02)', () => {
  it("matches a repository's dashboard, as its overview", () => {
    expect(match(repositoryMatcher, '/vercel/next.js')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      tab: 'overview',
    });
  });

  it('matches each tab at the path of the matching page on GitHub', () => {
    for (const [below, tab] of [
      ['activity', 'activity'],
      ['issues', 'issues'],
      ['pulls', 'pulls'],
      ['graphs/contributors', 'contributors'],
      ['releases', 'releases'],
    ]) {
      expect(match(repositoryMatcher, `/acme/widget/${below}`), below).toEqual({
        owner: 'acme',
        repo: 'widget',
        tab,
      });
    }
  });

  it('keeps the names as the URL has them', () => {
    expect(match(repositoryMatcher, '/Acme/Widget/issues')).toEqual({
      owner: 'Acme',
      repo: 'Widget',
      tab: 'issues',
    });
  });

  it('leaves other paths below a repository to the server, which redirects them', () => {
    for (const path of [
      '/acme/widget/tree/main',
      '/acme/widget/issues/42',
      '/acme/widget/pull/42',
      '/acme/widget/graphs',
      '/acme/widget/contributors',
      '/acme/widget/Issues',
    ]) {
      expect(match(repositoryMatcher, path), path).toBeNull();
    }
  });

  it("leaves organizations, BuhTig's own pages and GitHub's /orgs/ paths to other routes", () => {
    for (const path of ['/', '/acme', '/-/about', '/-/sign-in/x', '/orgs/acme', '/ORGS/acme']) {
      expect(match(repositoryMatcher, path), path).toBeNull();
    }
  });
});

describe('organizationMatcher (FR-NAV-01, FR-NAV-02)', () => {
  it("matches an organization's dashboard, as its overview", () => {
    expect(match(organizationMatcher, '/angular')).toEqual({ org: 'angular', tab: 'overview' });
  });

  it('matches its repositories and people at the paths of the matching pages on GitHub', () => {
    expect(match(organizationMatcher, '/orgs/angular/repositories')).toEqual({
      org: 'angular',
      tab: 'repositories',
    });
    expect(match(organizationMatcher, '/orgs/Angular/people')).toEqual({
      org: 'Angular',
      tab: 'people',
    });
  });

  it('takes the letter case of /orgs and the tab as GitHub does, which is none', () => {
    expect(match(organizationMatcher, '/ORGS/acme/People')).toEqual({
      org: 'acme',
      tab: 'people',
    });
  });

  it('leaves other paths to other routes, or to the server', () => {
    for (const path of [
      '/',
      '/-',
      '/angular/angular',
      '/orgs/angular',
      '/orgs/angular/teams',
      '/orgs/angular/people/x',
      '/users/angular/people',
    ]) {
      expect(match(organizationMatcher, path), path).toBeNull();
    }
  });
});

describe("a dashboard's tabs", () => {
  it('are those of GitHub, in its order', () => {
    expect(REPOSITORY_TABS.map(({ label }) => label)).toEqual([
      'Overview',
      'Activity',
      'Issues',
      'Pull requests',
      'Contributors',
      'Releases',
    ]);
    expect(ORGANIZATION_TABS.map(({ label }) => label)).toEqual([
      'Overview',
      'Repositories',
      'People',
    ]);
  });

  it("are at the paths of a repository's pages on GitHub", () => {
    expect(REPOSITORY_TABS.map(({ tab }) => repositoryTabPath('acme/widget', tab))).toEqual([
      '/acme/widget',
      '/acme/widget/activity',
      '/acme/widget/issues',
      '/acme/widget/pulls',
      '/acme/widget/graphs/contributors',
      '/acme/widget/releases',
    ]);
  });

  it("are at the paths of an organization's pages on GitHub", () => {
    expect(ORGANIZATION_TABS.map(({ tab }) => organizationTabPath('acme', tab))).toEqual([
      '/acme',
      '/orgs/acme/repositories',
      '/orgs/acme/people',
    ]);
  });

  it('are matched back to themselves at their paths', () => {
    for (const { tab } of REPOSITORY_TABS) {
      expect(match(repositoryMatcher, repositoryTabPath('acme/widget', tab))?.['tab']).toBe(tab);
      expect(match(organizationMatcher, repositoryTabPath('acme/widget', tab))).toBeNull();
    }
    for (const { tab } of ORGANIZATION_TABS) {
      expect(match(organizationMatcher, organizationTabPath('acme', tab))?.['tab']).toBe(tab);
      expect(match(repositoryMatcher, organizationTabPath('acme', tab))).toBeNull();
    }
  });
});

describe('dashboardOf', () => {
  it('tells which repository a URL is of, whatever its tab, query or fragment', () => {
    for (const url of [
      '/acme/widget',
      '/acme/widget/issues',
      '/acme/widget/graphs/contributors',
      '/acme/widget?tab=x',
      '/acme/widget#readme',
      '/acme/widget/',
    ]) {
      expect(dashboardOf(url), url).toBe('repository:acme/widget');
    }
  });

  it('tells which organization a URL is of, whatever its tab', () => {
    for (const url of ['/acme', '/orgs/acme/repositories', '/orgs/acme/people', '/acme?q=1']) {
      expect(dashboardOf(url), url).toBe('organization:acme');
    }
  });

  it('tells the same dashboard whatever the letter case of its names', () => {
    expect(dashboardOf('/Acme/Widget/pulls')).toBe(dashboardOf('/acme/widget'));
    expect(dashboardOf('/ORGS/Acme/people')).toBe(dashboardOf('/acme'));
  });

  it("tells a repository's dashboard from its owner's", () => {
    expect(dashboardOf('/acme/widget')).not.toBe(dashboardOf('/acme'));
    expect(dashboardOf('/acme/widget')).not.toBe(dashboardOf('/acme/gadget'));
  });

  it("tells of no dashboard for the home page and BuhTig's own pages", () => {
    for (const url of ['/', '', '/?q=1', '/-/about', '/-/settings', '/-']) {
      expect(dashboardOf(url), url).toBeUndefined();
    }
  });

  it('takes /orgs alone as the organization of that name, as the routes do', () => {
    expect(dashboardOf('/orgs')).toBe('organization:orgs');
    expect(match(organizationMatcher, '/orgs')).toEqual({ org: 'orgs', tab: 'overview' });
  });
});
