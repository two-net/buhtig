import { UrlMatchResult, UrlSegment } from '@angular/router';
import { USER_TABS, accountTabUrl, urlOf } from './account-tabs';
import {
  ORGANIZATION_TABS,
  REPOSITORY_TABS,
  accountMatcher,
  dashboardOf,
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

describe('accountMatcher (FR-NAV-01, FR-NAV-02)', () => {
  it("matches an account's dashboard, an organization's or a user's, as its overview", () => {
    expect(match(accountMatcher, '/angular')).toEqual({ name: 'angular', kind: 'account' });
  });

  it("leaves a user's tab to the query, as GitHub has it, such as /{user}?tab=repositories", () => {
    // The router gives a matcher the path alone: the query is no path parameter.
    expect(match(accountMatcher, '/mona')).not.toHaveProperty('tab');
  });

  it("matches an organization's repositories and people at the paths of the matching pages on GitHub", () => {
    expect(match(accountMatcher, '/orgs/angular/repositories')).toEqual({
      name: 'angular',
      kind: 'organization',
      tab: 'repositories',
    });
    expect(match(accountMatcher, '/orgs/Angular/people')).toEqual({
      name: 'Angular',
      kind: 'organization',
      tab: 'people',
    });
  });

  it('takes the letter case of /orgs and the tab as GitHub does, which is none', () => {
    expect(match(accountMatcher, '/ORGS/acme/People')).toEqual({
      name: 'acme',
      kind: 'organization',
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
      '/mona/repositories',
    ]) {
      expect(match(accountMatcher, path), path).toBeNull();
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
    expect(USER_TABS.map(({ label }) => label)).toEqual(['Overview', 'Repositories']);
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

  it("are at the URLs of an account's pages on GitHub, of its kind (FR-NAV-01)", () => {
    expect(ORGANIZATION_TABS.map(({ tab }) => accountTabUrl('acme', 'organization', tab))).toEqual([
      { link: '/acme' },
      { link: '/orgs/acme/repositories' },
      { link: '/orgs/acme/people' },
    ]);
    expect(USER_TABS.map(({ tab }) => urlOf(accountTabUrl('mona', 'user', tab)))).toEqual([
      '/mona',
      '/mona?tab=repositories',
    ]);
    // A user has no people: that is their overview.
    expect(accountTabUrl('mona', 'user', 'people')).toEqual({ link: '/mona' });
    // An account of a kind not known yet has a user's, which lead to an organization's too.
    expect(accountTabUrl('acme', undefined, 'repositories')).toEqual({
      link: '/acme',
      query: { tab: 'repositories' },
    });
  });

  it('are matched back to themselves at their paths', () => {
    for (const { tab } of REPOSITORY_TABS) {
      expect(match(repositoryMatcher, repositoryTabPath('acme/widget', tab))?.['tab']).toBe(tab);
      expect(match(accountMatcher, repositoryTabPath('acme/widget', tab))).toBeNull();
    }
    for (const { tab } of ORGANIZATION_TABS) {
      const matched = match(accountMatcher, organizationTabPath('acme', tab));
      expect(matched?.['tab'] ?? 'overview').toBe(tab);
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

  it('tells which account a URL is of, an organization or a user, whatever its tab', () => {
    for (const url of [
      '/acme',
      '/orgs/acme/repositories',
      '/orgs/acme/people',
      '/acme?q=1',
      '/acme?tab=repositories',
    ]) {
      expect(dashboardOf(url), url).toBe('account:acme');
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

  it('takes /orgs alone as the account of that name, as the routes do', () => {
    expect(dashboardOf('/orgs')).toBe('account:orgs');
    expect(match(accountMatcher, '/orgs')).toEqual({ name: 'orgs', kind: 'account' });
  });
});
