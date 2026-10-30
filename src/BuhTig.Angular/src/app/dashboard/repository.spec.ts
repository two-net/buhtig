import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MockInstance } from 'vitest';
import { routes } from '../app.routes';
import { Clock } from '../format/clock';
import { relativeTime } from '../format/format';
import { Toasts } from '../toast/toasts';
import {
  AUTHORIZE_SSO,
  KEEP_EXPLORING,
  NOT_FOUND_OR_PRIVATE,
  NO_SUCH_NAME,
  REFRESHED,
  SSO_REQUIRED,
  UNAVAILABLE,
  UNREACHABLE,
  heldData,
  renamed,
  staleData,
} from './messages';

describe('RepositoryDashboard', () => {
  const now = new Date('2026-10-22T12:04:30Z').getTime();
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;
  let navigateByUrl: MockInstance<Router['navigateByUrl']>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(now) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    navigateByUrl = vi.spyOn(router, 'navigateByUrl');
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    // Who is viewing is the session's business, and a signed-in user's history and pins are
    // those of the tests of followSummary and Pin.
    http.match('/-/api/session');
    http.match(isPart);
    http.match('/-/api/shortcuts');
    http.match(isView);
    http.verify();
  });

  const page = () => harness.routeNativeElement!;
  const main = () => page().querySelector('main')!;
  const tabs = () => [...page().querySelectorAll('app-tabs a')];
  const toasts = () =>
    TestBed.inject(Toasts)
      .toasts()
      .map((toast) => toast.message);
  /** Where the dashboard moved itself to, in place of the URL it was at. */
  const moves = () =>
    navigateByUrl.mock.calls.filter(([, extras]) => extras?.replaceUrl).map(([url]) => `${url}`);
  /** Whether `request` is for a part of a repository, such as its stats. */
  const isPart = (request: HttpRequest<unknown>) =>
    request.method === 'GET' && /^\/-\/api\/repositories\/[^/]+\/[^/]+\/[^/]+$/.test(request.url);
  /** Whether `request` records that a signed-in user viewed a dashboard (FR-PERS-01). */
  const isView = (request: HttpRequest<unknown>) =>
    request.method === 'POST' && request.url.endsWith('/view');

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"], .sr').forEach((hidden) => hidden.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  /** What the server says of `acme/widget` for its head. */
  const WIDGET = {
    name: 'acme/widget',
    fetched_at: '2026-10-22T12:00:00.000Z',
    description: 'Widgets for everyone',
    visibility: 'public',
    default_branch: 'main',
  };

  /** What the server says of each part of a repository. */
  const PARTS: Record<string, object> = {
    stats: {
      stars: 1,
      forks: 2,
      watchers: 3,
      open_issues: 12,
      open_pull_requests: 3,
      latest_release: null,
    },
    'commit-activity': { weeks: [{ week: '2026-10-18', commits: 4 }] },
    languages: { languages: [{ name: 'Rust', bytes: 900 }], other: 100 },
    contributors: {
      contributors: [{ login: 'alice', avatar_url: null, url: null, commits: 12 }],
      too_large: false,
      count: 345,
    },
    issues: {
      issues: { open: 12, closed: 4 },
      pull_requests: { open: 3, merged: 5, closed: 1 },
      recent: [
        {
          number: 50,
          title: 'Widgets wobble',
          kind: 'issue',
          state: 'open',
          author: 'alice',
          created_at: null,
          url: null,
        },
      ],
    },
    commits: {
      commits: [
        {
          sha: 'abc1234def',
          message: 'Steady the widgets',
          author: null,
          committed_at: null,
          url: null,
        },
      ],
    },
    releases: {
      releases: [{ tag: 'v2.1.0', name: null, published_at: null, prerelease: false, url: null }],
      count: 42,
    },
  };

  /** Each part of the repository asked for since last asked, without answering. */
  const asked = () =>
    http
      .match(isPart)
      .map((request) => request.request.url)
      .sort();

  /** Answers each part of the repository asked for since, and says which. */
  async function answerParts(): Promise<string[]> {
    const parts = http.match(isPart).map((request) => {
      const part = request.request.url.split('/').pop()!;
      request.flush(PARTS[part]);
      return part;
    });
    await harness.fixture.whenStable();
    return parts.sort();
  }

  /** Opens `url`, and answers the dashboard's question about its repository with `answer`. */
  async function open(
    url: string,
    request: string,
    answer: object | null,
    status = 200,
  ): Promise<void> {
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
    http.expectOne(request).flush(answer, { status, statusText: `${status}` });
    await harness.fixture.whenStable();
  }

  it('shows the repository in its header, from the URL until the server says (UI-03)', async () => {
    await harness.navigateByUrl('/acme/widget');
    const crumbs = () =>
      [...page().querySelectorAll('.crumbs a')].map((crumb) => [
        crumb.textContent?.trim(),
        crumb.getAttribute('href'),
      ]);
    expect(crumbs()).toEqual([
      ['acme', '/acme'],
      ['widget', '/acme/widget'],
    ]);
    expect(page().querySelector<HTMLInputElement>('header input')!.value).toBe(
      'github.com/acme/widget',
    );
    // Until the server says, a placeholder of the head, and the page is busy.
    expect(page().querySelector('app-repository-head')).toBeNull();
    expect(page().querySelector('.repohead .skel')).not.toBeNull();
    expect(main().getAttribute('aria-busy')).toBe('true');

    http.expectOne('/-/api/repositories/acme/widget').flush(WIDGET);
    await harness.fixture.whenStable();
    expect(page().querySelector('app-repository-head h1')?.textContent?.trim()).toBe('widget');
    expect(main().getAttribute('aria-busy')).toBe('false');
  });

  it('has a tab for each part, at its path on GitHub, with the one shown marked (FR-NAV-02)', async () => {
    await open('/acme/widget/graphs/contributors', '/-/api/repositories/acme/widget', WIDGET);
    expect(tabs().map((tab) => [shown(tab), tab.getAttribute('href')])).toEqual([
      ['Overview', '/acme/widget'],
      ['Activity', '/acme/widget/activity'],
      ['Issues', '/acme/widget/issues'],
      ['Pull requests', '/acme/widget/pulls'],
      ['Contributors', '/acme/widget/graphs/contributors'],
      ['Releases', '/acme/widget/releases'],
    ]);
    expect(tabs().map((tab) => tab.getAttribute('aria-current'))).toEqual([
      null,
      null,
      null,
      null,
      'page',
      null,
    ]);
  });

  it('counts the items of its tabs as soon as they load, whatever the tab', async () => {
    await open('/acme/widget/activity', '/-/api/repositories/acme/widget', WIDGET);
    expect(tabs().some((tab) => tab.querySelector('.counter'))).toBe(false);
    expect(await answerParts()).toEqual([
      'commit-activity',
      'commits',
      'contributors',
      'releases',
      'stats',
    ]);
    expect(tabs().map(shown)).toEqual([
      'Overview',
      'Activity',
      'Issues 12',
      'Pull requests 3',
      'Contributors 345',
      'Releases 42',
    ]);
  });

  it('leaves out the count of contributors when GitHub does not say it', async () => {
    await open('/acme/widget/issues', '/-/api/repositories/acme/widget', WIDGET);
    http
      .expectOne('/-/api/repositories/acme/widget/contributors')
      .flush({ contributors: [], too_large: true, count: null });
    await answerParts();
    expect(tabs().map(shown)[4]).toBe('Contributors');
  });

  it("shows each tab's widgets, and asks only for what they show besides the counts", async () => {
    const tabsAt = {
      '/acme/widget': [
        'app-repository-overview',
        'commit-activity',
        'commits',
        'issues',
        'languages',
      ],
      '/acme/widget/activity': ['app-repository-activity-tab', 'commit-activity', 'commits'],
      '/acme/widget/issues': ['app-repository-issues-tab', 'issues'],
      '/acme/widget/pulls': ['app-repository-issues-tab', 'issues'],
      '/acme/widget/graphs/contributors': ['app-repository-contributors-tab'],
      '/acme/widget/releases': ['app-repository-releases-tab'],
    };
    for (const [url, [content, ...parts]] of Object.entries(tabsAt)) {
      // Each anew, so that it asks for its parts anew.
      await harness.navigateByUrl('/-/about');
      await open(url, '/-/api/repositories/acme/widget', WIDGET);
      expect(page().querySelector('.container > :last-child')?.tagName.toLowerCase(), url).toBe(
        content,
      );
      expect(asked(), url).toEqual(
        [...parts, 'contributors', 'releases', 'stats']
          .map((part) => `/-/api/repositories/acme/widget/${part}`)
          .sort(),
      );
    }
  });

  it('shows issues on the Issues tab, and pull requests on the Pull requests tab', async () => {
    await open('/acme/widget/issues', '/-/api/repositories/acme/widget', WIDGET);
    await answerParts();
    const heading = () => page().querySelector('app-repository-issues-tab h2')?.textContent?.trim();
    expect(heading()).toBe('Issues');
    await harness.navigateByUrl('/acme/widget/pulls');
    expect(heading()).toBe('Pull requests');
  });

  it('loads each part once, however many tabs show it', async () => {
    await open('/acme/widget', '/-/api/repositories/acme/widget', WIDGET);
    expect(await answerParts()).toEqual(Object.keys(PARTS).sort());

    for (const url of ['/acme/widget/activity', '/acme/widget/issues', '/acme/widget']) {
      await harness.navigateByUrl(url);
      await harness.fixture.whenStable();
      expect(asked(), url).toEqual([]);
      http.expectNone('/-/api/repositories/acme/widget');
    }
    await harness.navigateByUrl('/acme/widget/activity');
    // At once, with what it has loaded already.
    expect(page().querySelector('app-repository-commits li .ttl')?.textContent).toBe(
      'Steady the widgets',
    );
  });

  it("moves to GitHub's spelling of the names, on the same tab, in place (FR-NAV-04)", async () => {
    await open('/angular/Angular/issues', '/-/api/repositories/angular/Angular', {
      name: 'angular/angular',
    });
    await vi.waitFor(() => expect(router.url).toBe('/angular/angular/issues'));
    expect(moves()).toEqual(['/angular/angular/issues']);
    await harness.fixture.whenStable();
    expect(tabs()[2].getAttribute('href')).toBe('/angular/angular/issues');
    // The same repository, whose parts it has asked for already, and no rename to tell of.
    http.expectNone('/-/api/repositories/angular/angular');
    expect(asked().every((url) => url.startsWith('/-/api/repositories/angular/Angular/'))).toBe(
      true,
    );
    expect(toasts()).toEqual([]);
  });

  it('moves to the new name of a renamed or transferred repository, and says so (FR-NAV-05)', async () => {
    await open('/acme/old/releases', '/-/api/repositories/acme/old', { name: 'other/new' });
    await vi.waitFor(() => expect(router.url).toBe('/other/new/releases'));
    expect(toasts()).toEqual([renamed('acme/old', 'other/new')]);
    // Another repository, which it asks about anew.
    await harness.fixture.whenStable();
    http.expectOne('/-/api/repositories/other/new').flush({ name: 'other/new' });
    expect(asked()).toContain('/-/api/repositories/other/new/releases');
    await harness.fixture.whenStable();
    expect(moves()).toEqual(['/other/new/releases']);
    expect(toasts()).toHaveLength(1);
  });

  it('stays where it is when the names are spelled as GitHub spells them', async () => {
    await open('/vercel/next.js/pulls', '/-/api/repositories/vercel/next.js', {
      name: 'vercel/next.js',
    });
    expect(router.url).toBe('/vercel/next.js/pulls');
    expect(moves()).toEqual([]);
  });

  it('forgets what it showed of one repository as it moves to another', async () => {
    await open('/acme/widget', '/-/api/repositories/acme/widget', WIDGET);
    await answerParts();
    await harness.navigateByUrl('/acme/gadget');
    await harness.fixture.whenStable();
    expect(page().querySelector('app-repository-head')).toBeNull();
    expect(tabs().map(shown)[2]).toBe('Issues');
    http.expectOne('/-/api/repositories/acme/gadget').flush({ name: 'acme/gadget' });
    expect(asked()).toContain('/-/api/repositories/acme/gadget/stats');
  });

  it('shows nothing of a repository GitHub says is not there (FR-ACC-05)', async () => {
    await open('/owner/secret/issues', '/-/api/repositories/owner/secret', null, 404);
    http.expectOne('/-/api/session').flush({ user: null });
    await harness.fixture.whenStable();
    expect(page().querySelector('app-not-found-or-private h1')?.textContent).toBe(
      NOT_FOUND_OR_PRIVATE,
    );
    expect(
      page().querySelector('app-tabs, app-notices, app-repository-head, app-repository-issues-tab'),
    ).toBeNull();
    expect(router.url).toBe('/owner/secret/issues');
  });

  it('says so of a name that cannot be one (NFR-UX-06)', async () => {
    await open('/foo/bar_', '/-/api/repositories/foo/bar_', null, 400);
    expect(page().querySelector('app-not-found-or-private h1')?.textContent).toBe(NO_SUCH_NAME);
    expect(page().querySelector('app-tabs, app-repository-overview')).toBeNull();
  });

  it('says why it could show nothing, and asks again on "Try again" (FR-DATA-05)', async () => {
    await open('/acme/widget', '/-/api/repositories/acme/widget', null, 502);
    expect(page().querySelector('app-failure h1')?.textContent).toBe(UNREACHABLE);
    expect(page().querySelector('app-tabs, app-repository-overview')).toBeNull();

    page().querySelector<HTMLButtonElement>('app-failure button')!.click();
    await harness.fixture.whenStable();
    http.expectOne('/-/api/repositories/acme/widget').flush(WIDGET);
    await harness.fixture.whenStable();
    expect(page().querySelector('app-failure')).toBeNull();
    expect(page().querySelector('app-repository-head')).not.toBeNull();
    expect(tabs()).toHaveLength(6);
  });

  it("says when BuhTig can't reach its database, or visitors may fetch no more", async () => {
    await open('/acme/widget', '/-/api/repositories/acme/widget', null, 503);
    expect(page().querySelector('app-failure h1')?.textContent).toBe(UNAVAILABLE);
    expect(page().querySelector('app-failure button')).not.toBeNull();

    await harness.navigateByUrl('/-/about');
    await open('/acme/widget', '/-/api/repositories/acme/widget', null, 429);
    expect(page().querySelector('app-failure h1')?.textContent).toBe(KEEP_EXPLORING);
    expect(page().querySelector('app-failure a')?.getAttribute('href')).toBe(
      '/-/auth/sign-in?return_to=%2Facme%2Fwidget',
    );
  });

  it('says how to get access GitHub keeps from the viewer, and shows nothing else (FR-PAT-08)', async () => {
    const sso = 'https://github.com/orgs/acme/sso?authorization_request=abc';
    await open('/acme/widget', '/-/api/repositories/acme/widget', { denied: 'sso', url: sso }, 403);
    const notice = page().querySelector('app-notices [role="alert"]')!;
    expect(shown(notice)).toBe(`${SSO_REQUIRED} ${AUTHORIZE_SSO}`);
    expect(notice.querySelector('a')?.getAttribute('href')).toBe(sso);
    expect(
      page().querySelector('app-repository-head, .repohead, app-repository-overview'),
    ).toBeNull();
  });

  it('says when it shows saved data, why, and from when (FR-DATA-05)', async () => {
    const age = relativeTime(new Date(WIDGET.fetched_at), now);
    await open('/acme/widget', '/-/api/repositories/acme/widget', { ...WIDGET, stale: 'github' });
    const notice = () => page().querySelector('app-notices .notice.warn');
    expect(shown(notice()!)).toBe(staleData(age));

    await harness.navigateByUrl('/acme/gadget');
    http
      .expectOne('/-/api/repositories/acme/gadget')
      .flush({ ...WIDGET, name: 'acme/gadget', stale: 'held' });
    await harness.fixture.whenStable();
    expect(shown(notice()!)).toContain(heldData(age));
    expect(page().querySelector('app-repository-head')).not.toBeNull();
  });

  it('asks again for the repository and what it shows once refreshed (FR-DATA-07)', async () => {
    await open('/acme/widget', '/-/api/repositories/acme/widget', WIDGET);
    http.expectOne('/-/api/session').flush({
      user: { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' },
      token: null,
    });
    await answerParts();

    page().querySelector<HTMLButtonElement>('app-refresh button')!.click();
    http
      .expectOne({ method: 'POST', url: '/-/api/repositories/acme/widget/refresh' })
      .flush(null, { status: 204, statusText: 'No Content' });
    await harness.fixture.whenStable();
    expect(main().getAttribute('aria-busy')).toBe('true');
    expect(await answerParts()).toEqual(Object.keys(PARTS).sort());
    http
      .expectOne('/-/api/repositories/acme/widget')
      .flush({ ...WIDGET, fetched_at: '2026-10-22T12:04:00.000Z' });
    await harness.fixture.whenStable();
    expect(main().getAttribute('aria-busy')).toBe('false');
    expect(toasts()).toEqual([REFRESHED]);
  });
});
