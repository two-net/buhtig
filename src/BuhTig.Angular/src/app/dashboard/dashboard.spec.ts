import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MockInstance } from 'vitest';
import { routes } from '../app.routes';
import { exactTime, relativeTime } from '../format/format';
import {
  AUTHORIZE_SSO,
  AUTHORIZE_TOKEN,
  SSO_REQUIRED,
  THEN_RELOAD,
  TOKEN_REFUSED,
} from './messages';

describe('Dashboard', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;
  let navigate: MockInstance<Router['navigate']>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate');
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    // Who is viewing is the header's own business, and each widget's data its own, which
    // these tests leave to them.
    http.match('/-/api/session');
    http.match(isWidget);
    http.verify();
    vi.useRealTimers();
  });

  const page = () => harness.routeNativeElement!;
  const heading = () => page().querySelector('h1')?.textContent?.trim();
  const title = () => TestBed.inject(Title).getTitle();
  /** When the dashboard says its data was fetched, if it does. */
  const updated = () => page().querySelector('.updated');
  /**
   * Whether `request` is for a widget's data, such as `/-/api/repositories/owner/repo/stats` or
   * `/-/api/organizations/org/stats`.
   */
  const isWidget = (request: HttpRequest<unknown>) =>
    /^\/-\/api\/(repositories\/[^/]+|organizations)\/[^/]+\/[^/]+$/.test(request.url);
  /** The repository's widgets, in the order of the grid. */
  const WIDGETS = [
    'stats',
    'commit-activity',
    'languages',
    'contributors',
    'issues',
    'commits',
    'releases',
  ];

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  /** Opens `url`, and answers the dashboard's question about its names with `answer`. */
  async function open(url: string, request: string, answer: object): Promise<void> {
    await harness.navigateByUrl(url);
    http.expectOne(request).flush(answer);
    await harness.fixture.whenStable();
  }

  it("moves to GitHub's spelling of a repository's name, in place (FR-NAV-04)", async () => {
    await open('/ANGULAR/Angular', '/-/api/repositories/ANGULAR/Angular', {
      name: 'angular/angular',
    });
    await vi.waitFor(() => expect(router.url).toBe('/angular/angular'));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      ['/angular/angular'],
      expect.objectContaining({ replaceUrl: true }),
    );
    await harness.fixture.whenStable();
    expect(heading()).toBe('angular/angular');
    expect(title()).toBe('angular/angular · BuhTig');

    // There, it asks again, and stays.
    http.expectOne('/-/api/repositories/angular/angular').flush({ name: 'angular/angular' });
    await harness.fixture.whenStable();
    expect(router.url).toBe('/angular/angular');
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('moves to the new name of a renamed or transferred repository (FR-NAV-05)', async () => {
    await open('/owner/old', '/-/api/repositories/owner/old', { name: 'new-owner/new' });
    await vi.waitFor(() => expect(router.url).toBe('/new-owner/new'));
    http.expectOne('/-/api/repositories/new-owner/new').flush({ name: 'new-owner/new' });
  });

  it("moves to GitHub's spelling of an organization's name (FR-NAV-04)", async () => {
    await open('/ANGULAR', '/-/api/organizations/ANGULAR', { name: 'angular' });
    await vi.waitFor(() => expect(router.url).toBe('/angular'));
    http.expectOne('/-/api/organizations/angular').flush({ name: 'angular' });
    await harness.fixture.whenStable();
    expect(heading()).toBe('angular');
  });

  it('keeps the query and fragment as it moves', async () => {
    await open('/ACME?tab=repositories#top', '/-/api/organizations/ACME', { name: 'acme' });
    await vi.waitFor(() => expect(router.url).toBe('/acme?tab=repositories#top'));
    http.expectOne('/-/api/organizations/acme').flush({ name: 'acme' });
  });

  it('stays where it is when names are spelled as GitHub spells them', async () => {
    await open('/vercel/next.js', '/-/api/repositories/vercel/next.js', {
      name: 'vercel/next.js',
    });
    expect(router.url).toBe('/vercel/next.js');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('stays where it is when BuhTig cannot tell', async () => {
    for (const [status, statusText] of [
      [404, 'Not Found'],
      [429, 'Too Many Requests'],
      [503, 'Service Unavailable'],
    ] as const) {
      await harness.navigateByUrl('/OWNER/repo');
      http.expectOne('/-/api/repositories/OWNER/repo').flush(null, { status, statusText });
      await harness.fixture.whenStable();
      expect(router.url, `${status}`).toBe('/OWNER/repo');
      // Away and back, so that the dashboard asks again.
      await harness.navigateByUrl('/-/about');
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says how to get access that GitHub keeps from the viewer (FR-PAT-08)', async () => {
    const denied = async (url: string, request: string, body: object | null) => {
      await harness.navigateByUrl(url);
      http.expectOne(request).flush(body, { status: 403, statusText: 'Forbidden' });
      await harness.fixture.whenStable();
      const notice = page().querySelector('app-denied [role="alert"]');
      return notice && [shown(notice), notice.querySelector('a')?.getAttribute('href')];
    };

    const sso = 'https://github.com/orgs/acme/sso?authorization_request=abc';
    expect(
      await denied('/acme/widget', '/-/api/repositories/acme/widget', { denied: 'sso', url: sso }),
    ).toEqual([`${SSO_REQUIRED} ${AUTHORIZE_SSO}, ${THEN_RELOAD}`, sso]);
    // Under the resource's head.
    expect(page().querySelector('app-repository-header + app-denied')).not.toBeNull();
    expect(
      await denied('/acme', '/-/api/organizations/acme', {
        denied: 'sso',
        url: 'https://evil.example/sso',
      }),
    ).toEqual([
      `${SSO_REQUIRED} ${AUTHORIZE_TOKEN}, ${THEN_RELOAD}`,
      'https://github.com/settings/tokens',
    ]);
    expect(
      await denied('/acme/other', '/-/api/repositories/acme/other', { denied: 'token' }),
    ).toEqual([`${TOKEN_REFUSED} Replace it in Settings`, '/-/settings']);
    expect(await denied('/acme/plain', '/-/api/repositories/acme/plain', null)).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores an answer that names no such resource', async () => {
    for (const name of [
      'acme',
      '../evil',
      'acme/widget/x',
      'acme/widget.git',
      'github.com/acme/widget',
      '//evil.example/x',
    ]) {
      await harness.navigateByUrl('/ACME/widget');
      http.expectOne('/-/api/repositories/ACME/widget').flush({ name });
      await harness.fixture.whenStable();
      expect(router.url, name).toBe('/ACME/widget');
      await harness.navigateByUrl('/-/about');
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not move from a dashboard left before GitHub answered', async () => {
    await harness.navigateByUrl('/OWNER/first');
    const first = http.expectOne('/-/api/repositories/OWNER/first');
    await harness.navigateByUrl('/owner/second');
    expect(first.cancelled).toBe(true);
    http.expectOne('/-/api/repositories/owner/second').flush({ name: 'owner/second' });
    await harness.fixture.whenStable();
    expect(router.url).toBe('/owner/second');

    await harness.navigateByUrl('/OWNER/third');
    const third = http.expectOne('/-/api/repositories/OWNER/third');
    await harness.navigateByUrl('/-/about');
    expect(third.cancelled).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('has a slim header: the wordmark, the search box filled in, and "Sign in" (UI-03)', async () => {
    await open('/vercel/next.js', '/-/api/repositories/vercel/next.js', {
      name: 'vercel/next.js',
    });
    http.expectOne('/-/api/session').flush({ user: null });
    await harness.fixture.whenStable();
    const header = page().querySelector('header')!;
    const wordmark = header.querySelector('a')!;
    expect([wordmark.textContent?.trim(), wordmark.getAttribute('href')]).toEqual(['BuhTig', '/']);
    expect(header.querySelector('input')!.value).toBe('github.com/vercel/next.js');
    expect(header.querySelector('button[type="submit"]')).toBeNull();
    expect(header.querySelector('.sign-in')?.textContent?.trim()).toBe('Sign in');
  });

  it("opens another dashboard from the header's search box", async () => {
    await open('/vercel/next.js', '/-/api/repositories/vercel/next.js', {
      name: 'vercel/next.js',
    });
    const input = page().querySelector('header input') as HTMLInputElement;
    input.value = 'github.com/angular';
    input.dispatchEvent(new Event('input'));
    page()
      .querySelector('header form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectOne('/-/api/accounts/angular').flush({ type: 'organization', login: 'angular' });
    await vi.waitFor(() => expect(router.url).toBe('/angular'));
    http.expectOne('/-/api/organizations/angular').flush({ name: 'angular' });
    await harness.fixture.whenStable();
    expect(heading()).toBe('angular');
    expect(title()).toBe('angular · BuhTig');
    expect((page().querySelector('header input') as HTMLInputElement).value).toBe(
      'github.com/angular',
    );
  });

  it('says when its data was fetched from GitHub (FR-DATA-06)', async () => {
    const now = new Date('2026-10-22T12:04:30Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    const fetchedAt = '2026-10-22T12:00:00.000Z';
    await open('/acme', '/-/api/organizations/acme', { name: 'acme', fetched_at: fetchedAt });
    expect(shown(updated()!)).toBe(`Updated ${relativeTime(new Date(fetchedAt), now.getTime())}`);
    expect(updated()!.querySelector('time')!.getAttribute('datetime')).toBe(fetchedAt);
    expect(updated()!.querySelector('[role="tooltip"]')!.textContent).toBe(
      exactTime(new Date(fetchedAt)),
    );
  });

  it('says nothing of when its data was fetched until the server does', async () => {
    await harness.navigateByUrl('/acme/widget');
    expect(updated()).toBeNull();
    http.expectOne('/-/api/repositories/acme/widget').flush({ name: 'acme/widget' });
    await harness.fixture.whenStable();
    expect(updated()).toBeNull();

    await harness.navigateByUrl('/acme/gadget');
    http
      .expectOne('/-/api/repositories/acme/gadget')
      .flush({ name: 'acme/gadget', fetched_at: 'yesterday' });
    await harness.fixture.whenStable();
    expect(updated()).toBeNull();
  });

  it("forgets when one dashboard's data was fetched as it moves to another", async () => {
    await open('/acme/widget', '/-/api/repositories/acme/widget', {
      name: 'acme/widget',
      fetched_at: '2026-10-22T12:00:00.000Z',
    });
    expect(updated()).not.toBeNull();
    await harness.navigateByUrl('/acme/gadget');
    expect(updated()).toBeNull();
    http.expectOne('/-/api/repositories/acme/gadget').flush({ name: 'acme/gadget' });
  });

  /** All that the server says of `Acme/Widget` for its header. */
  const WIDGET = {
    name: 'Acme/Widget',
    fetched_at: '2026-10-22T12:00:00.000Z',
    owner_avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    description: 'Widgets for everyone',
    visibility: 'public',
    archived: true,
    template: false,
    fork: true,
    parent: 'Upstream/Widget',
    topics: ['widgets'],
    license: 'MIT License',
    default_branch: 'main',
    homepage: 'https://widget.example/',
    created_at: '2015-03-01T10:00:00Z',
    pushed_at: '2026-10-20T08:30:00Z',
  };

  it("heads a repository's dashboard with what the server says of it (FR-REPO-01)", async () => {
    await open('/Acme/Widget', '/-/api/repositories/Acme/Widget', WIDGET);
    const header = page().querySelector('app-repository-header')!;
    expect(heading()).toBe('Acme/Widget');
    expect(header.querySelector('img')!.getAttribute('src')).toBe(WIDGET.owner_avatar_url);
    expect(header.querySelector('.description')?.textContent).toBe('Widgets for everyone');
    expect(
      [...header.querySelectorAll('.badge')].map((badge) => badge.textContent?.trim()),
    ).toEqual(['Public', 'Archived', 'Fork of Upstream/Widget']);
    expect(header.querySelector('a.badge')!.getAttribute('href')).toBe('/Upstream/Widget');
    expect(header.querySelector('.updated')).not.toBeNull();
  });

  it('loads its widgets at once, alongside the rest, with the stat cards first', async () => {
    await harness.navigateByUrl('/acme/widget');
    const widgets = [...page().querySelectorAll('.grid > * > app-widget')];
    expect(widgets.map((widget) => widget.parentElement!.tagName.toLowerCase())).toEqual([
      'app-repository-stats',
      'app-repository-activity',
      'app-repository-languages',
      'app-repository-contributors',
      'app-repository-issues',
      'app-repository-commits',
      'app-repository-releases',
    ]);
    expect(widgets.map((widget) => widget.classList.contains('wide'))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    for (const widget of widgets) {
      expect(widget.querySelector('.skeleton')).not.toBeNull();
    }
    expect(http.match(isWidget).map((request) => request.request.url)).toEqual(
      WIDGETS.map((part) => `/-/api/repositories/acme/widget/${part}`),
    );
    http.expectOne('/-/api/repositories/acme/widget').flush({ name: 'acme/widget' });
  });

  it("loads its widgets again under the repository's canonical name", async () => {
    await harness.navigateByUrl('/ACME/Widget');
    const first = WIDGETS.map((part) => http.expectOne(`/-/api/repositories/ACME/Widget/${part}`));
    http.expectOne('/-/api/repositories/ACME/Widget').flush({ name: 'Acme/Widget' });
    await vi.waitFor(() => expect(router.url).toBe('/Acme/Widget'));
    await harness.fixture.whenStable();
    expect(first.map((request) => request.cancelled)).toEqual(WIDGETS.map(() => true));
    for (const part of WIDGETS) {
      http.expectOne(`/-/api/repositories/Acme/Widget/${part}`);
    }
    http.expectOne('/-/api/repositories/Acme/Widget').flush(WIDGET);
  });

  it('shows nothing of an answer that names no such resource', async () => {
    await open('/acme/widget', '/-/api/repositories/acme/widget', { ...WIDGET, name: '../evil' });
    const header = page().querySelector('app-repository-header')!;
    expect(heading()).toBe('acme/widget');
    expect(header.querySelector('.description, .badge, img, dl')).toBeNull();
  });

  it('shows only what it can show safely (NFR-SEC-03)', async () => {
    await open('/acme/widget', '/-/api/repositories/acme/widget', {
      ...WIDGET,
      name: 'acme/widget',
      owner_avatar_url: 'http://avatars.example/u/1',
      visibility: 'secret',
      parent: '../evil',
      homepage: 'javascript:alert(1)',
      created_at: 'yesterday',
    });
    const header = page().querySelector('app-repository-header')!;
    expect(header.querySelector('img, a.badge')).toBeNull();
    expect(
      [...header.querySelectorAll('.badge')].map((badge) => badge.textContent?.trim()),
    ).toEqual(['Public', 'Archived', 'Fork']);
    expect([...header.querySelectorAll('dt')].map((label) => label.textContent?.trim())).toEqual([
      'License',
      'Default branch',
      'Last push',
    ]);
  });

  it('forgets what it said of one repository as it moves to another', async () => {
    await open('/Acme/Widget', '/-/api/repositories/Acme/Widget', WIDGET);
    expect(page().querySelector('.description')).not.toBeNull();
    await harness.navigateByUrl('/acme/gadget');
    expect(heading()).toBe('acme/gadget');
    expect(page().querySelector('.description, .badge')).toBeNull();
    http.expectOne('/-/api/repositories/acme/gadget').flush({ name: 'acme/gadget' });
  });

  it("heads an organization's dashboard with what the server says of it (FR-ORG-01)", async () => {
    await open('/Acme', '/-/api/organizations/Acme', {
      name: 'Acme',
      fetched_at: '2026-10-22T12:00:00.000Z',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      display_name: 'Acme Corporation',
      description: 'Widgets for everyone',
      location: 'Springfield',
      website: 'javascript:alert(1)',
      created_at: 'yesterday',
      verified: true,
    });
    const header = page().querySelector('app-organization-header')!;
    expect(heading()).toBe('Acme Corporation');
    expect(header.querySelector('.login')?.textContent?.trim()).toBe('Acme');
    expect(header.querySelector('img')!.getAttribute('src')).toBe(
      'https://avatars.githubusercontent.com/u/1?v=4',
    );
    expect(header.querySelector('.badge')?.textContent?.trim()).toBe('Verified');
    expect(header.querySelector('.description')?.textContent).toBe('Widgets for everyone');
    // Only what it can show safely (NFR-SEC-03).
    expect([...header.querySelectorAll('dt')].map((label) => label.textContent?.trim())).toEqual([
      'Location',
    ]);
    expect(header.querySelector('.updated')).not.toBeNull();
    expect(page().querySelector('app-repository-header')).toBeNull();
  });

  it("loads an organization's widgets, not a repository's (FR-ORG-02 to FR-ORG-07)", async () => {
    await harness.navigateByUrl('/acme');
    const widgets = [...page().querySelectorAll('.grid > * > app-widget')];
    expect(widgets.map((widget) => widget.parentElement!.tagName.toLowerCase())).toEqual([
      'app-organization-stats',
      'app-organization-languages',
      'app-organization-top-repositories',
      'app-organization-last-push',
      'app-organization-created',
      'app-organization-repositories',
      'app-organization-members',
    ]);
    // The charts side by side, between the stat cards and the table, and the members below.
    expect(widgets.map((widget) => widget.classList.contains('wide'))).toEqual([
      true,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(http.match(isWidget).map((request) => request.request.url)).toEqual([
      '/-/api/organizations/acme/stats',
      '/-/api/organizations/acme/languages',
      '/-/api/organizations/acme/top-repositories',
      '/-/api/organizations/acme/last-push',
      '/-/api/organizations/acme/created-per-year',
      '/-/api/organizations/acme/repositories',
      '/-/api/organizations/acme/members',
    ]);
    http.expectOne('/-/api/organizations/acme').flush({ name: 'acme' });
  });

  it('shows nothing of an answer that names no such organization', async () => {
    await open('/acme', '/-/api/organizations/acme', {
      name: 'acme/widget',
      display_name: 'Acme Corporation',
      description: 'Widgets for everyone',
      verified: true,
    });
    const header = page().querySelector('app-organization-header')!;
    expect(heading()).toBe('acme');
    expect(header.querySelector('.description, .badge, .github, img, dl')).toBeNull();
  });
});
