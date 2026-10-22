import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MockInstance } from 'vitest';
import { routes } from '../app.routes';
import { exactTime, relativeTime } from '../format/format';

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
    // Who is viewing is the header's own business, and the stat cards' figures theirs, which
    // these tests leave to them.
    http.match('/-/api/session');
    http.match(isStats);
    http.verify();
    vi.useRealTimers();
  });

  const page = () => harness.routeNativeElement!;
  const heading = () => page().querySelector('h1')?.textContent?.trim();
  const title = () => TestBed.inject(Title).getTitle();
  /** When the dashboard says its data was fetched, if it does. */
  const updated = () => page().querySelector('.updated');
  const isStats = (request: HttpRequest<unknown>) => request.url.endsWith('/stats');

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
    await open('/ANGULAR', '/-/api/accounts/ANGULAR', { type: 'organization', login: 'angular' });
    await vi.waitFor(() => expect(router.url).toBe('/angular'));
    http.expectOne('/-/api/accounts/angular').flush({ type: 'organization', login: 'angular' });
    await harness.fixture.whenStable();
    expect(heading()).toBe('angular');
  });

  it('keeps the query and fragment as it moves', async () => {
    await open('/ACME?tab=repositories#top', '/-/api/accounts/ACME', {
      type: 'organization',
      login: 'acme',
    });
    await vi.waitFor(() => expect(router.url).toBe('/acme?tab=repositories#top'));
    http.expectOne('/-/api/accounts/acme').flush({ type: 'organization', login: 'acme' });
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
    http.expectOne('/-/api/accounts/angular').flush({ type: 'organization', login: 'angular' });
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
    await open('/acme', '/-/api/accounts/acme', {
      type: 'organization',
      login: 'acme',
      fetched_at: fetchedAt,
    });
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

  it('loads the stat cards at once, alongside the rest', async () => {
    await harness.navigateByUrl('/acme/widget');
    const stats = page().querySelector('app-repository-stats app-widget');
    expect(stats?.classList.contains('wide')).toBe(true);
    expect(stats?.querySelector('.skeleton')).not.toBeNull();
    expect(http.match(isStats).map((request) => request.request.url)).toEqual([
      '/-/api/repositories/acme/widget/stats',
    ]);
    http.expectOne('/-/api/repositories/acme/widget').flush({ name: 'acme/widget' });
  });

  it("loads the stat cards again under the repository's canonical name", async () => {
    await harness.navigateByUrl('/ACME/Widget');
    const first = http.expectOne('/-/api/repositories/ACME/Widget/stats');
    http.expectOne('/-/api/repositories/ACME/Widget').flush({ name: 'Acme/Widget' });
    await vi.waitFor(() => expect(router.url).toBe('/Acme/Widget'));
    await harness.fixture.whenStable();
    expect(first.cancelled).toBe(true);
    http.expectOne('/-/api/repositories/Acme/Widget/stats');
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

  it("has neither a repository's head nor its stat cards for an organization", async () => {
    await open('/acme', '/-/api/accounts/acme', { type: 'organization', login: 'acme' });
    expect(page().querySelector('app-repository-header, app-repository-stats')).toBeNull();
    expect(http.match(isStats)).toEqual([]);
  });
});
