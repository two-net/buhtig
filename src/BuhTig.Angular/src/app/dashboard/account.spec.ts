import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MockInstance } from 'vitest';
import { routes } from '../app.routes';
import { Clock } from '../format/clock';
import { exactDay } from '../format/format';
import { Toasts } from '../toast/toasts';
import {
  NOT_FOUND_OR_PRIVATE,
  NO_SUCH_NAME,
  OPEN_ON_GITHUB,
  REFRESH,
  REFRESHED,
  SSO_REQUIRED,
  TRY_LATER,
  UNAVAILABLE,
  notFoundForVisitor,
} from './messages';

describe('AccountDashboard', () => {
  const NOW = new Date('2026-10-22T12:00:00Z').getTime();
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;
  let navigate: MockInstance<Router['navigateByUrl']>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(NOW) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create();
    navigate = vi.spyOn(router, 'navigateByUrl');
  });

  afterEach(() => {
    // Who is viewing is the header's own business, and what the parts of the account show and
    // the rows' sparklines are the tabs' own, which these tests leave to them, as they leave a
    // signed-in user's pins and history to those that test them.
    http.match('/-/api/session');
    http.match('/-/api/shortcuts');
    http.match((request) => request.method === 'POST' && request.url.endsWith('/view'));
    http.match(isPart);
    http.match((request) => request.url.endsWith('/commit-activity'));
    http.verify();
  });

  /**
   * Whether `request` is for a part of an organization or a user, such as
   * `/-/api/organizations/org/stats`.
   */
  const isPart = (request: HttpRequest<unknown>) =>
    request.method === 'GET' && /^\/-\/api\/(organizations|users)\/[^/]+\/[^/]+$/.test(request.url);
  /** The parts of accounts asked for since last asked, as their URLs. */
  const parts = () => http.match(isPart).map((request) => request.request.url);

  /** All that the server says of `acme` for its head. */
  const ACME = {
    name: 'acme',
    fetched_at: '2026-10-22T11:58:00Z',
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    display_name: 'Acme Corp',
    description: 'We make everything',
    location: 'Springfield',
    website: 'https://acme.example/',
    created_at: '2015-03-01T10:00:00Z',
    verified: true,
  };
  /** What the server answers of each part of `acme`. */
  const PARTS: Record<string, object> = {
    stats: {
      repositories: 312,
      private: 0,
      internal: 0,
      stars: 900,
      forks: 40,
      open_issues_and_pull_requests: 7,
      top_language: 'TypeScript',
      truncated: false,
    },
    members: {
      count: 40,
      members: [{ login: 'mona', avatar_url: null, url: 'https://github.com/mona' }],
    },
    languages: {
      languages: [
        { name: 'TypeScript', repositories: 42 },
        { name: 'Rust', repositories: 7 },
      ],
      other: 3,
    },
    repositories: {
      repositories: [
        ['rocket', 'Rust'],
        ['widget', 'TypeScript'],
        ['gadget', 'Go'],
      ].map(([name, language]) => ({
        name,
        description: null,
        language,
        stars: 1,
        forks: 0,
        open_issues_and_pull_requests: 0,
        pushed_at: null,
        fork: false,
        archived: false,
        visibility: 'public',
      })),
    },
    'top-repositories': { repositories: [{ name: 'rocket', stars: 1 }] },
    'last-push': { last_7_days: 1, last_30_days: 1, last_12_months: 1, older: 0 },
    'created-per-year': { years: [{ year: 2020, repositories: 3 }] },
  };
  /** All that the server says of the user `mona` for their head. */
  const MONA = {
    name: 'mona',
    fetched_at: '2026-10-22T11:58:00Z',
    avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
    display_name: 'Mona Lisa',
    bio: 'Paints <b>octocats</b>',
    company: '@acme',
    location: 'Paris',
    website: 'https://mona.example/',
    created_at: '2011-01-25T18:44:36Z',
    followers: 12_345,
    following: 1,
  };

  const page = () => harness.routeNativeElement!;
  const main = () => page().querySelector('main')!;
  const heading = () => main().querySelector('h1')?.textContent?.trim();
  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"], .sr').forEach((hidden) => hidden.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }
  /** The tabs, as their labels, where they lead, whether current, and their counts. */
  const tabs = () =>
    [...page().querySelectorAll('.unav a')].map((tab) => [
      tab.querySelector('span')!.textContent?.trim(),
      tab.getAttribute('href'),
      tab.getAttribute('aria-current'),
      tab.querySelector('.counter') ? shown(tab.querySelector('.counter')!) : undefined,
    ]);
  const tab = (label: string) =>
    [...page().querySelectorAll<HTMLElement>('.unav a')].find(
      (tab) => tab.querySelector('span')!.textContent?.trim() === label,
    )!;
  /** The calls that moved the dashboard in place. */
  const moves = () =>
    navigate.mock.calls.filter(([, extras]) => extras?.replaceUrl).map(([url]) => url);

  /**
   * Answers that the account `name` is of `type`, as the server says of an account named alone,
   * as at `url`, but not at an organization's path, which says so already.
   */
  function tell(url: string, name: string, type = 'organization'): void {
    if (!/^\/orgs\//i.test(url)) {
      http.expectOne(`/-/api/accounts/${name}`).flush({ type, login: name.toLowerCase() });
    }
  }

  /** Opens `url`, and answers what the server says of the organization `org` with `answer`. */
  async function open(url: string, org: string, answer: object = ACME): Promise<void> {
    await harness.navigateByUrl(url);
    tell(url, org);
    http.expectOne(`/-/api/organizations/${org}`).flush(answer);
    await harness.fixture.whenStable();
  }

  /** Opens `url`, and answers what the server says of the user `login` with `answer`. */
  async function openUser(url: string, login: string, answer: object = MONA): Promise<void> {
    await harness.navigateByUrl(url);
    tell(url, login, 'user');
    http.expectOne(`/-/api/users/${login}`).flush(answer);
    await harness.fixture.whenStable();
  }

  /** Opens `url`, where the server says `status` of the organization `org`. */
  async function fail(url: string, org: string, status: number, body: object | null = null) {
    await harness.navigateByUrl(url);
    tell(url, org);
    http.expectOne(`/-/api/organizations/${org}`).flush(body, { status, statusText: `${status}` });
    await harness.fixture.whenStable();
  }

  /** Opens `url`, where the server says `status` of what the account `name` is. */
  async function failToTell(url: string, name: string, status: number): Promise<void> {
    await harness.navigateByUrl(url);
    http.expectOne(`/-/api/accounts/${name}`).flush(null, { status, statusText: `${status}` });
    await harness.fixture.whenStable();
  }

  /** Answers each part asked for, with what `PARTS` says. */
  async function answerParts(): Promise<string[]> {
    const asked = http.match(isPart);
    for (const request of asked) {
      request.flush(PARTS[request.request.url.split('/').pop()!]);
    }
    await harness.fixture.whenStable();
    return asked.map((request) => request.request.url.split('/').pop()!);
  }

  async function session(user: object | null): Promise<void> {
    http.expectOne('/-/api/session').flush({ user, token: null });
    await harness.fixture.whenStable();
  }

  it('heads the dashboard with what the server says of the organization (FR-ORG-01)', async () => {
    await open('/acme', 'acme');
    await answerParts();
    const head = main().querySelector('app-organization-head')!;
    expect(heading()).toBe('Acme Corp');
    expect(head.querySelector('.label.success')!.textContent?.trim()).toBe('Verified');
    expect(head.querySelector('.oh-desc')!.textContent?.trim()).toBe('We make everything');
    expect(head.querySelector('img')!.getAttribute('src')).toBe(ACME.avatar_url);
    expect([...head.querySelectorAll('.rmeta > *')].map((item) => shown(item))).toEqual([
      '40 members',
      'Springfield',
      'acme.example',
      `On GitHub since ${exactDay(new Date(ACME.created_at))}`,
    ]);
    expect(head.querySelector('.rmeta a')!.getAttribute('href')).toBe('https://acme.example/');
    const github = [...head.querySelectorAll('a')].find(
      (link) => link.textContent?.trim() === OPEN_ON_GITHUB,
    )!;
    expect(github.getAttribute('href')).toBe('https://github.com/acme');
  });

  it("names an organization without a display name by its login, and leaves out what it doesn't say", async () => {
    await open('/acme', 'acme', { name: 'acme' });
    const head = main().querySelector('app-organization-head')!;
    expect(heading()).toBe('acme');
    expect(head.querySelector('.label, .oh-desc, img, .rmeta > *')).toBeNull();
  });

  it('stands a placeholder in for the head until the server says what it is', async () => {
    await harness.navigateByUrl('/acme');
    expect(main().getAttribute('aria-busy')).toBe('true');
    expect(main().querySelector('.orghead[aria-hidden="true"] .skel')).not.toBeNull();
    expect(main().querySelector('app-organization-head')).toBeNull();
    tell('/acme', 'acme');
    await harness.fixture.whenStable();
    expect(main().querySelector('.orghead[aria-hidden="true"] .skel')).not.toBeNull();
    http.expectOne('/-/api/organizations/acme').flush(ACME);
    await harness.fixture.whenStable();
    expect(main().getAttribute('aria-busy')).toBe('false');
    expect(main().querySelector('.orghead[aria-hidden="true"]')).toBeNull();
  });

  it("has a header with the organization's crumb, and the search box filled in (UI-03)", async () => {
    await open('/acme', 'acme');
    const crumbs = [...page().querySelectorAll('nav[aria-label="Breadcrumb"] a')];
    expect(crumbs.map((crumb) => [crumb.textContent?.trim(), crumb.getAttribute('href')])).toEqual([
      ['acme', '/acme'],
    ]);
    expect(page().querySelector<HTMLInputElement>('header input')!.value).toBe('github.com/acme');
  });

  it('has tabs for its overview, repositories and people, with how many each has (FR-NAV-01)', async () => {
    await open('/acme', 'acme');
    expect(tabs()).toEqual([
      ['Overview', '/acme', 'page', undefined],
      ['Repositories', '/orgs/acme/repositories', null, undefined],
      ['People', '/orgs/acme/people', null, undefined],
    ]);
    expect(page().querySelector('.unav')!.getAttribute('aria-label')).toBe('Dashboard sections');
    await answerParts();
    expect(tabs()).toEqual([
      ['Overview', '/acme', 'page', undefined],
      ['Repositories', '/orgs/acme/repositories', null, '312'],
      ['People', '/orgs/acme/people', null, '40'],
    ]);
  });

  it('opens each tab at its own URL, as on GitHub (FR-NAV-02)', async () => {
    await open('/orgs/acme/people', 'acme');
    expect(tabs().map(([label, , current]) => [label, current])).toEqual([
      ['Overview', null],
      ['Repositories', null],
      ['People', 'page'],
    ]);
    expect(main().querySelector('app-organization-people')).not.toBeNull();
    expect(main().querySelector('app-organization-overview')).toBeNull();

    await harness.navigateByUrl('/orgs/acme/repositories');
    expect(main().querySelector('app-organization-repositories-tab')).not.toBeNull();
    expect(tab('Repositories').getAttribute('aria-current')).toBe('page');
  });

  it("moves to GitHub's spelling of its name, on the same tab, in place (FR-NAV-04)", async () => {
    await open('/orgs/ACME/repositories', 'ACME');
    await vi.waitFor(() => expect(router.url).toBe('/orgs/acme/repositories'));
    expect(moves()).toEqual(['/orgs/acme/repositories']);
    await harness.fixture.whenStable();
    // The same organization, so nothing to ask again.
    http.expectNone('/-/api/organizations/acme');
    expect(tabs()[1][1]).toBe('/orgs/acme/repositories');
    expect(heading()).toBe('Acme Corp');
  });

  it("moves to GitHub's spelling of its name on the overview too", async () => {
    await open('/ACME', 'ACME');
    await vi.waitFor(() => expect(router.url).toBe('/acme'));
    expect(moves()).toEqual(['/acme']);
  });

  it('stays where it is when its name is spelled as GitHub spells it', async () => {
    await open('/acme', 'acme');
    // Another tab of the same organization, which it knows already.
    await harness.navigateByUrl('/orgs/acme/people');
    http.expectNone('/-/api/organizations/acme');
    expect(moves()).toEqual([]);
    expect(router.url).toBe('/orgs/acme/people');
  });

  it("keeps the repository list's view as it moves to GitHub's spelling (FR-ORG-03, FR-NAV-04)", async () => {
    await open('/orgs/ACME/repositories?type=source&sort=stargazers', 'ACME');
    await vi.waitFor(() =>
      expect(router.url).toBe('/orgs/acme/repositories?type=source&sort=stargazers'),
    );
    expect(moves()).toEqual(['/orgs/acme/repositories?type=source&sort=stargazers']);
    expect(main().querySelector<HTMLSelectElement>('select[aria-label="Type"]')!.value).toBe(
      'sources',
    );
  });

  it("takes a user's Repositories tab that names an organization to its own, with the list's view (FR-NAV-02)", async () => {
    await open('/acme?tab=repositories&language=rust&utm_source=chat', 'acme');
    await vi.waitFor(() => expect(router.url).toBe('/orgs/acme/repositories?language=rust'));
    expect(moves()).toEqual(['/orgs/acme/repositories?language=rust']);
  });

  it('loads each part of the organization once, as the first tab that shows it asks', async () => {
    // An organization's path says what it is, so its parts load at once.
    await harness.navigateByUrl('/orgs/acme/people');
    // What the tabs count, and the colors of languages, first, then what the tab shows.
    expect(await answerParts()).toEqual(['stats', 'members', 'languages']);
    http.expectOne('/-/api/organizations/acme').flush(ACME);
    await harness.fixture.whenStable();
    expect(parts()).toEqual([]);

    tab('Overview').click();
    await vi.waitFor(() => expect(router.url).toBe('/acme'));
    await harness.fixture.whenStable();
    expect(await answerParts()).toEqual([
      'repositories',
      'top-repositories',
      'last-push',
      'created-per-year',
    ]);

    // Back and forth, what each tab shows is there at once, without asking again.
    tab('Repositories').click();
    await vi.waitFor(() => expect(router.url).toBe('/orgs/acme/repositories'));
    await harness.fixture.whenStable();
    expect(
      [...main().querySelectorAll('app-repository-row h3 a')].map((link) => link.textContent),
    ).toEqual(['gadget', 'rocket', 'widget']);
    tab('People').click();
    await vi.waitFor(() => expect(router.url).toBe('/orgs/acme/people'));
    await harness.fixture.whenStable();
    expect(main().querySelector('.people-grid a')!.textContent?.trim()).toBe('@mona');
    expect(parts()).toEqual([]);
    http.expectNone('/-/api/organizations/acme');
    http.expectNone('/-/api/accounts/acme');
  });

  it('loads the parts of an account named alone once the server says what it is (FR-SRCH-06)', async () => {
    await harness.navigateByUrl('/acme');
    expect(parts()).toEqual([]);
    tell('/acme', 'acme');
    expect(parts()).toEqual([]);
    http.expectOne('/-/api/organizations/acme').flush(ACME);
    await harness.fixture.whenStable();
    expect((await answerParts()).sort()).toEqual([
      'created-per-year',
      'languages',
      'last-push',
      'members',
      'repositories',
      'stats',
      'top-repositories',
    ]);
  });

  it('loads the parts of another organization as it moves there', async () => {
    await open('/acme', 'acme');
    await answerParts();
    await open('/other', 'other', { name: 'other' });
    expect(parts().sort()).toEqual(
      [
        'created-per-year',
        'languages',
        'last-push',
        'members',
        'repositories',
        'stats',
        'top-repositories',
      ].map((part) => `/-/api/organizations/other/${part}`),
    );
  });

  it('asks again for the organization, and each part it has loaded, on a refresh (FR-DATA-07)', async () => {
    await open('/acme', 'acme');
    await answerParts();
    await session({ login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' });
    const refresh = [...main().querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === REFRESH,
    )!;
    refresh.click();
    http
      .expectOne({ method: 'POST', url: '/-/api/organizations/acme/refresh' })
      .flush(null, { status: 204, statusText: 'No Content' });
    await harness.fixture.whenStable();
    // What it shows stays, dimmed, until the organization comes again.
    expect(main().classList).toContain('refreshing');
    expect(main().getAttribute('aria-busy')).toBe('true');
    expect(heading()).toBe('Acme Corp');
    tell('/acme', 'acme');
    http.expectOne('/-/api/organizations/acme').flush({ ...ACME, display_name: 'Acme Inc' });
    await harness.fixture.whenStable();
    expect(main().classList).not.toContain('refreshing');
    expect(heading()).toBe('Acme Inc');
    expect(
      TestBed.inject(Toasts)
        .toasts()
        .map((toast) => toast.message),
    ).toEqual([REFRESHED]);
    expect((await answerParts()).sort()).toEqual([
      'created-per-year',
      'languages',
      'last-push',
      'members',
      'repositories',
      'stats',
      'top-repositories',
    ]);
  });

  it('colors each language as its chart does, those of the most repositories first', async () => {
    await open('/acme', 'acme');
    await answerParts();
    const dots = [
      ...main().querySelectorAll<HTMLElement>(
        'section[aria-labelledby="recent-heading"] .lang-dot',
      ),
    ].map((dot) => [dot.parentElement!.textContent?.trim(), dot.style.background]);
    expect(dots).toEqual([
      ['Rust', 'var(--s2)'],
      ['TypeScript', 'var(--s1)'],
      ['Go', 'var(--s-other)'],
    ]);
  });

  describe("a user's", () => {
    it('heads the dashboard with what the server says of the user (FR-SRCH-06, FR-USER-01)', async () => {
      await openUser('/mona', 'mona');
      const head = main().querySelector('app-user-head')!;
      expect(main().querySelector('app-organization-head')).toBeNull();
      expect(heading()).toBe('Mona Lisa');
      expect(head.querySelector('.login')!.textContent?.trim()).toBe('mona');
      // As plain text, as all GitHub says (NFR-SEC-03).
      expect(head.querySelector('.oh-desc')!.textContent?.trim()).toBe('Paints <b>octocats</b>');
      expect(head.querySelector('.oh-desc b')).toBeNull();
      const avatar = head.querySelector('img')!;
      expect(avatar.getAttribute('src')).toBe(MONA.avatar_url);
      expect(avatar.classList).toContain('round');
      expect([...head.querySelectorAll('.rmeta > *')].map((item) => shown(item))).toEqual([
        '12.3K followers',
        '1 following',
        '@acme',
        'Paris',
        'mona.example',
        `Joined ${exactDay(new Date(MONA.created_at))}`,
      ]);
      expect(head.querySelector('.rmeta a')!.getAttribute('href')).toBe('https://mona.example/');
      const github = [...head.querySelectorAll('a')].find(
        (link) => link.textContent?.trim() === OPEN_ON_GITHUB,
      )!;
      expect(github.getAttribute('href')).toBe('https://github.com/mona');
    });

    it("names a user without a display name by their login, and leaves out what they don't say", async () => {
      await openUser('/mona', 'mona', { name: 'mona' });
      const head = main().querySelector('app-user-head')!;
      expect(heading()).toBe('mona');
      expect(head.querySelector('.login, .oh-desc, img, .rmeta a, time')).toBeNull();
      expect([...head.querySelectorAll('.rmeta > *')].map((item) => shown(item))).toEqual([
        '0 followers',
        '0 following',
      ]);
    });

    it('has tabs for their overview and repositories, at the query GitHub has (FR-NAV-01)', async () => {
      await openUser('/mona', 'mona');
      expect(tabs()).toEqual([
        ['Overview', '/mona', 'page', undefined],
        ['Repositories', '/mona?tab=repositories', null, undefined],
      ]);
      await answerParts();
      expect(tabs()).toEqual([
        ['Overview', '/mona', 'page', undefined],
        ['Repositories', '/mona?tab=repositories', null, '312'],
      ]);
    });

    it('loads their parts under their own URL, and no members, which a user has none of', async () => {
      await openUser('/mona', 'mona');
      expect(parts().sort()).toEqual(
        [
          'created-per-year',
          'languages',
          'last-push',
          'repositories',
          'stats',
          'top-repositories',
        ].map((part) => `/-/api/users/mona/${part}`),
      );
      expect(main().querySelector('app-organization-overview')).not.toBeNull();
      expect(main().querySelector('section[aria-labelledby="people-heading"]')).toBeNull();
    });

    it('opens their repositories at the query of the tab, and moves between tabs in place', async () => {
      await openUser('/mona?tab=repositories', 'mona');
      expect(main().querySelector('app-organization-repositories-tab')).not.toBeNull();
      expect(tab('Repositories').getAttribute('aria-current')).toBe('page');
      expect(moves()).toEqual([]);
      await answerParts();

      tab('Overview').click();
      await vi.waitFor(() => expect(router.url).toBe('/mona'));
      await harness.fixture.whenStable();
      expect(main().querySelector('app-organization-overview')).not.toBeNull();
      // What the overview alone shows, first asked for now.
      expect((await answerParts()).sort()).toEqual([
        'created-per-year',
        'last-push',
        'top-repositories',
      ]);
      tab('Repositories').click();
      await vi.waitFor(() => expect(router.url).toBe('/mona?tab=repositories'));
      await harness.fixture.whenStable();
      expect(main().querySelector('app-organization-repositories-tab')).not.toBeNull();
      // The same user, so nothing to ask again.
      http.expectNone('/-/api/accounts/mona');
      http.expectNone('/-/api/users/mona');
      expect(parts()).toEqual([]);
    });

    it("moves to GitHub's spelling of their login, keeping the tab (FR-NAV-04)", async () => {
      await openUser('/Mona?tab=repositories', 'Mona');
      await vi.waitFor(() => expect(router.url).toBe('/mona?tab=repositories'));
      expect(moves()).toEqual(['/mona?tab=repositories']);
    });

    it("keeps the repository list's view as it moves to GitHub's spelling of their login (FR-ORG-03)", async () => {
      await openUser('/Mona?tab=repositories&q=lisa&page=2', 'Mona');
      await vi.waitFor(() => expect(router.url).toBe('/mona?tab=repositories&q=lisa&page=2'));
      expect(moves()).toEqual(['/mona?tab=repositories&q=lisa&page=2']);
    });

    it("leaves what would be the list's view behind on their overview", async () => {
      await openUser('/Mona?q=lisa&sort=stargazers', 'Mona');
      await vi.waitFor(() => expect(router.url).toBe('/mona'));
      expect(moves()).toEqual(['/mona']);
    });

    it('moves from one of their tabs on GitHub that BuhTig does not show to the overview (FR-NAV-02)', async () => {
      await openUser('/mona?tab=stars', 'mona');
      await vi.waitFor(() => expect(router.url).toBe('/mona'));
      expect(moves()).toEqual(['/mona']);
      expect(main().querySelector('app-organization-overview')).not.toBeNull();
    });

    it("takes an organization's path that names a user to the user's own (FR-NAV-02)", async () => {
      await harness.navigateByUrl('/orgs/mona/repositories');
      http
        .expectOne('/-/api/organizations/mona')
        .flush(null, { status: 404, statusText: 'Not Found' });
      tell('/mona', 'mona', 'user');
      http.expectOne('/-/api/users/mona').flush(MONA);
      await harness.fixture.whenStable();
      await vi.waitFor(() => expect(router.url).toBe('/mona?tab=repositories'));
      expect(heading()).toBe('Mona Lisa');
      // The organization's parts it asked for while it took it for one, then the user's.
      expect(parts().filter((url) => url.startsWith('/-/api/users/mona/'))).not.toEqual([]);
    });

    it('records the view as of a user, for a signed-in user (FR-PERS-01)', async () => {
      await openUser('/mona', 'mona');
      await session({ login: 'hubot', name: null, avatar_url: 'https://example.com/hubot.png' });
      http.expectOne({ method: 'POST', url: '/-/api/users/mona/view' }).flush(null);
    });

    it('refreshes and pins as a user (FR-DATA-07, FR-PERS-02)', async () => {
      await openUser('/mona', 'mona');
      await answerParts();
      await session({ login: 'hubot', name: null, avatar_url: 'https://example.com/hubot.png' });
      const refresh = [...main().querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === REFRESH,
      )!;
      refresh.click();
      http
        .expectOne({ method: 'POST', url: '/-/api/users/mona/refresh' })
        .flush(null, { status: 204, statusText: 'No Content' });
      await harness.fixture.whenStable();
      tell('/mona', 'mona', 'user');
      http.expectOne('/-/api/users/mona').flush(MONA);
      await harness.fixture.whenStable();
      // Each part once, and no members.
      expect((await answerParts()).sort()).toEqual([
        'created-per-year',
        'languages',
        'last-push',
        'repositories',
        'stats',
        'top-repositories',
      ]);
    });
  });

  it('says when it could not tell what an account named alone is, and asks again (FR-DATA-05)', async () => {
    await failToTell('/acme', 'acme', 503);
    expect(heading()).toBe(UNAVAILABLE);
    expect(page().querySelector('.unav')).toBeNull();
    expect(parts()).toEqual([]);
    main().querySelector<HTMLButtonElement>('app-failure button')!.click();
    await harness.fixture.whenStable();
    tell('/acme', 'acme');
    http.expectOne('/-/api/organizations/acme').flush(ACME);
    await harness.fixture.whenStable();
    expect(heading()).toBe('Acme Corp');
  });

  it('shows nothing of an account that GitHub says is not there (FR-ACC-05)', async () => {
    await failToTell('/acme', 'acme', 404);
    await session(null);
    expect(heading()).toBe(NOT_FOUND_OR_PRIVATE);
    expect(main().textContent).toContain(notFoundForVisitor('account', 'acme'));
    expect(page().querySelector('.unav')).toBeNull();
    expect(main().querySelector('app-organization-head, app-user-head, .orghead')).toBeNull();
    http.expectNone('/-/api/organizations/acme');
    http.expectNone('/-/api/users/acme');
  });

  it('shows nothing of an organization that GitHub says is not there, or keeps from the viewer (FR-ACC-05)', async () => {
    await fail('/orgs/acme/people', 'acme', 404);
    http.expectOne('/-/api/accounts/acme').flush(null, { status: 404, statusText: 'Not Found' });
    // What the viewer can do about it depends on who they are.
    await session(null);
    expect(heading()).toBe(NOT_FOUND_OR_PRIVATE);
    expect(main().textContent).toContain(notFoundForVisitor('organization', 'acme'));
    expect(page().querySelector('.unav')).toBeNull();
    expect(main().querySelector('app-organization-head, .orghead')).toBeNull();

    // Nor of one GitHub says is an organization after all, at its own URL.
    await fail('/other', 'other', 404);
    expect(heading()).toBe(NOT_FOUND_OR_PRIVATE);
  });

  it('says when its name cannot be an account’s, as the server says without asking GitHub (FR-SRCH-04)', async () => {
    await failToTell('/acme', 'acme', 400);
    expect(heading()).toBe(NO_SUCH_NAME);
    expect(page().querySelector('.unav')).toBeNull();
    http.expectNone('/-/api/organizations/acme');
  });

  it('says when it could not load the organization, and tries again (FR-DATA-05)', async () => {
    await fail('/acme', 'acme', 503);
    expect(heading()).toBe(UNAVAILABLE);
    expect(main().textContent).toContain(TRY_LATER);
    expect(page().querySelector('.unav')).toBeNull();
    main().querySelector<HTMLButtonElement>('app-failure button')!.click();
    await harness.fixture.whenStable();
    tell('/acme', 'acme');
    http.expectOne('/-/api/organizations/acme').flush(ACME);
    await harness.fixture.whenStable();
    expect(heading()).toBe('Acme Corp');
    expect(page().querySelector('.unav')).not.toBeNull();
  });

  it('shows none of what GitHub keeps from the viewer, and says why (FR-PAT-08)', async () => {
    await fail('/acme', 'acme', 403, { denied: 'sso', url: null });
    expect(main().querySelector('app-notices [role="alert"]')!.textContent).toContain(SSO_REQUIRED);
    expect(main().querySelector('app-organization-overview, .orghead')).toBeNull();
    // Its tabs are there, to lead to what it shows once the viewer has access.
    expect(page().querySelector('.unav')).not.toBeNull();
  });
});
