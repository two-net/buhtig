import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Route, Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Mock } from 'vitest';
import { ENDED } from './account/messages';
import { App } from './app';
import { routes } from './app.routes';
import { OrganizationDashboard } from './dashboard/organization';
import { RepositoryDashboard } from './dashboard/repository';
import { organizationMatcher, repositoryMatcher } from './dashboard/tabs';
import { focusPageOnNavigation } from './focus/page-focus';
import { Home } from './home/home';
import { Session } from './session/session';
import { Toasts } from './toast/toasts';

const MONA = { login: 'mona', name: 'Mona Lisa', avatar_url: 'https://example.com/mona.png' };

describe('routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  const title = () => TestBed.inject(Title).getTitle();
  const router = () => TestBed.inject(Router);
  /** The page that the router shows, by its element's name. */
  const shown = (harness: RouterTestingHarness) =>
    harness.routeNativeElement?.tagName.toLowerCase();
  const heading = (harness: RouterTestingHarness) =>
    harness.routeNativeElement?.querySelector('h1')?.textContent?.trim();
  /** The routed dashboard, with the inputs it was given. */
  const dashboard = (harness: RouterTestingHarness) =>
    harness.routeDebugElement?.componentInstance as RepositoryDashboard | OrganizationDashboard;
  /** The tab that a dashboard's tab bar marks as the current page. */
  const currentTab = (harness: RouterTestingHarness) =>
    harness.routeNativeElement
      ?.querySelector('nav[aria-label="Dashboard sections"] [aria-current="page"] span')
      ?.textContent?.trim();

  /** Answers who is viewing, as the server does as the page loads. */
  async function visitor(harness: RouterTestingHarness): Promise<void> {
    TestBed.inject(HttpTestingController).expectOne('/-/api/session').flush({ user: null });
    await harness.fixture.whenStable();
  }

  it('shows the home page at the root, titled BuhTig alone (UI-04)', async () => {
    const harness = await RouterTestingHarness.create('/');
    expect(harness.routeDebugElement?.componentInstance).toBeInstanceOf(Home);
    expect(title()).toBe('BuhTig');
  });

  it('comes with the home page alone, and loads every other page as it is opened (NFR-PERF-01)', () => {
    const pages = routes
      .flatMap((route): Route[] => [route, ...(route.children ?? [])])
      .filter((route) => route.children === undefined);
    expect(pages.filter((route) => route.loadComponent === undefined)).toEqual([
      { path: '', component: Home, title: 'BuhTig' },
    ]);
    // Page not found too, below /-/ and anywhere else.
    expect(pages.filter((route) => route.path === '**')).toHaveLength(2);
    expect(pages.every((route) => route.path === '' || route.component === undefined)).toBe(true);
  });

  it("loads the dashboards' code ahead of need, and nothing else's (NFR-PERF-04)", () => {
    const all = routes.flatMap((route): Route[] => [route, ...(route.children ?? [])]);
    expect(
      all.filter((route) => route.data?.['preload'] === true).map((route) => route.matcher),
    ).toEqual([organizationMatcher, repositoryMatcher]);
  });

  it('opens a dashboard from a URL pasted on the home page and Enter alone (NFR-UX-01)', async () => {
    const harness = await RouterTestingHarness.create('/');
    await visitor(harness);
    const input = harness.routeNativeElement!.querySelector<HTMLInputElement>('main input')!;
    input.value = 'https://github.com/owner/repo/tree/main';
    input.dispatchEvent(new Event('input'));
    input.form!.requestSubmit();
    await vi.waitFor(() => expect(router().url).toBe('/owner/repo'));
    await harness.fixture.whenStable();
    expect(dashboard(harness)).toBeInstanceOf(RepositoryDashboard);
    expect(title()).toBe('owner/repo · BuhTig');
  });

  it('moves the focus into the dashboard after a search from home (WCAG 2.4.3)', async () => {
    TestBed.runInInjectionContext(focusPageOnNavigation);
    const harness = await RouterTestingHarness.create('/');
    await visitor(harness);
    const input = harness.routeNativeElement!.querySelector<HTMLInputElement>('main input')!;
    input.focus();
    input.value = 'acme';
    input.dispatchEvent(new Event('input'));
    input.form!.requestSubmit();
    await vi.waitFor(() => expect(router().url).toBe('/acme'));
    await harness.fixture.whenStable();
    expect(dashboard(harness)).toBeInstanceOf(OrganizationDashboard);
    // Its main content, until its heading has come.
    expect(document.activeElement).toBe(harness.routeNativeElement!.querySelector('main#main'));
  });

  it("has BuhTig's own pages under /-/, apart from dashboards (FR-NAV-03)", async () => {
    const harness = await RouterTestingHarness.create();
    for (const [path, page, pageTitle] of [
      ['/-/about', 'app-about', 'About · BuhTig'],
      ['/-/privacy', 'app-privacy', 'Privacy · BuhTig'],
      ['/-/settings', 'app-settings', 'Settings · BuhTig'],
      ['/-/sign-in', 'app-sign-in', 'Sign in · BuhTig'],
      ['/-/not-allowed', 'app-not-allowed', 'Not allowed · BuhTig'],
      ['/-/sign-in-failed', 'app-sign-in-failed', 'Sign-in failed · BuhTig'],
    ]) {
      await harness.navigateByUrl(path);
      expect([shown(harness), title()], path).toEqual([page, pageTitle]);
    }
    await harness.navigateByUrl('/-/about');
    expect(heading(harness)).toBe('About BuhTig');
    await harness.navigateByUrl('/-/sign-in-failed');
    expect(heading(harness)).toBe("Sign-in didn't work");
  });

  it('gives the pages of signing in what the server says in the query (FR-AUTH-05)', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/-/sign-in?return_to=%2Facme%2Fwidget');
    const link = [...harness.routeNativeElement!.querySelectorAll('main a')].find(
      (a) => a.textContent?.trim() === 'Sign in with GitHub',
    );
    expect(link?.getAttribute('href')).toBe('/-/auth/sign-in?return_to=%2Facme%2Fwidget');
  });

  it('says that BuhTig has no such page of its own, nor any other (FR-NAV-03)', async () => {
    const harness = await RouterTestingHarness.create();
    for (const path of [
      '/-/auth/sign-in',
      '/-',
      '/-/nothing/here',
      '/acme/widget/tree/main',
      '/acme/widget/issues/42',
      '/orgs/acme',
      '/orgs/acme/teams',
    ]) {
      await harness.navigateByUrl(path);
      expect([shown(harness), heading(harness), title()], path).toEqual([
        'app-not-found',
        'Page not found',
        'Page not found · BuhTig',
      ]);
    }
  });

  it("has a dashboard for each repository, and each of its tabs at GitHub's paths (FR-NAV-01, FR-NAV-02)", async () => {
    const harness = await RouterTestingHarness.create();
    for (const [path, tab, label] of [
      ['/vercel/next.js', 'overview', 'Overview'],
      ['/vercel/next.js/activity', 'activity', 'Activity'],
      ['/vercel/next.js/issues', 'issues', 'Issues'],
      ['/vercel/next.js/pulls', 'pulls', 'Pull requests'],
      ['/vercel/next.js/graphs/contributors', 'contributors', 'Contributors'],
      ['/vercel/next.js/releases', 'releases', 'Releases'],
    ]) {
      await harness.navigateByUrl(path);
      const shownDashboard = dashboard(harness) as RepositoryDashboard;
      expect(shownDashboard, path).toBeInstanceOf(RepositoryDashboard);
      expect([shownDashboard.owner(), shownDashboard.repo(), shownDashboard.tab()], path).toEqual([
        'vercel',
        'next.js',
        tab,
      ]);
      expect(currentTab(harness), path).toBe(label);
    }
  });

  it('has a dashboard for each organization, and its repositories and people (FR-NAV-01)', async () => {
    const harness = await RouterTestingHarness.create();
    for (const [path, tab, label] of [
      ['/angular', 'overview', 'Overview'],
      ['/orgs/angular/repositories', 'repositories', 'Repositories'],
      ['/orgs/angular/people', 'people', 'People'],
    ]) {
      await harness.navigateByUrl(path);
      const shownDashboard = dashboard(harness) as OrganizationDashboard;
      expect(shownDashboard, path).toBeInstanceOf(OrganizationDashboard);
      expect([shownDashboard.org(), shownDashboard.tab()], path).toEqual(['angular', tab]);
      expect(currentTab(harness), path).toBe(label);
    }
  });

  it('keeps the dashboard, and what it has loaded, as the user moves between its tabs', async () => {
    const harness = await RouterTestingHarness.create('/acme/widget');
    const first = dashboard(harness);
    await harness.navigateByUrl('/acme/widget/issues');
    await harness.navigateByUrl('/acme/widget/graphs/contributors');
    expect(dashboard(harness)).toBe(first);
    await harness.navigateByUrl('/acme');
    expect(dashboard(harness)).toBeInstanceOf(OrganizationDashboard);
  });

  it('titles dashboards after their resource, and their tab but the overview (UI-04)', async () => {
    const harness = await RouterTestingHarness.create();
    for (const [path, pageTitle] of [
      ['/vercel/next.js', 'vercel/next.js · BuhTig'],
      ['/vercel/next.js/issues', 'Issues · vercel/next.js · BuhTig'],
      ['/vercel/next.js/pulls', 'Pull requests · vercel/next.js · BuhTig'],
      ['/vercel/next.js/graphs/contributors', 'Contributors · vercel/next.js · BuhTig'],
      ['/angular', 'angular · BuhTig'],
      ['/orgs/angular/repositories', 'Repositories · angular · BuhTig'],
      ['/orgs/angular/people', 'People · angular · BuhTig'],
      ['/', 'BuhTig'],
    ]) {
      await harness.navigateByUrl(path);
      expect(title(), path).toBe(pageTitle);
    }
  });

  describe('motion', () => {
    let animate: Mock<HTMLElement['animate']>;

    beforeEach(() => {
      // Each test is a browser session of its own.
      sessionStorage.clear();
      // jsdom has no Web Animations, and lays nothing out: here the search box is in the middle
      // of the home page, and in a dashboard's header.
      animate = vi.fn();
      HTMLElement.prototype.animate = animate;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.closest('app-visitor-home')
          ? new DOMRect(100, 300, 600, 48)
          : new DOMRect(150, 12, 600, 40);
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      document.documentElement.classList.remove('still');
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    const main = (harness: RouterTestingHarness) =>
      harness.routeNativeElement!.querySelector('main#main')!;

    it('glides the search box into the header of a dashboard opened from home, as it fades in (FR-ANIM-03)', async () => {
      const harness = await RouterTestingHarness.create('/');
      await visitor(harness);
      await harness.navigateByUrl('/owner/repo');
      expect(main(harness).classList).toContain('view-enter');
      expect(animate).toHaveBeenCalledOnce();
      expect(animate.mock.contexts[0]).toBe(
        harness.routeNativeElement!.querySelector('app-header .search'),
      );
      const [keyframes] = animate.mock.calls[0];
      expect((keyframes as Keyframe[])[0]['transform']).toBe(
        'translate(-50px, 288px) scale(1, 1.2)',
      );
    });

    it('glides into an organization’s dashboard too', async () => {
      const harness = await RouterTestingHarness.create('/');
      await visitor(harness);
      await harness.navigateByUrl('/acme');
      expect(main(harness).classList).toContain('view-enter');
      expect(animate).toHaveBeenCalledOnce();
    });

    it('opens a dashboard at once unless it is opened from home', async () => {
      const harness = await RouterTestingHarness.create('/owner/repo');
      await visitor(harness);
      expect(main(harness).classList).not.toContain('view-enter');
      // Nor from home by way of another page.
      await harness.navigateByUrl('/');
      await harness.navigateByUrl('/-/about');
      await harness.navigateByUrl('/acme');
      expect(main(harness).classList).not.toContain('view-enter');
      expect(animate).not.toHaveBeenCalled();
    });

    it('keeps still while the browser asks for reduced motion (FR-ANIM-10)', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      const harness = await RouterTestingHarness.create('/');
      await visitor(harness);
      await harness.navigateByUrl('/owner/repo');
      expect(main(harness).classList).not.toContain('view-enter');
      expect(animate).not.toHaveBeenCalled();
      expect(document.documentElement.classList).toContain('still');
    });
  });
});

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  const toasts = () => TestBed.inject(Toasts).toasts();

  it('skips to the content, shows the page, and toasts and announcements over it (NFR-UX-02)', async () => {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/-/about');
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect([...root.children].map((child) => child.tagName.toLowerCase())).toEqual([
      'a',
      'router-outlet',
      'app-about',
      'app-toasts',
      'app-announcer',
    ]);
    const skip = root.querySelector('a')!;
    expect([skip.textContent, skip.getAttribute('href')]).toEqual(['Skip to content', '#main']);
    expect(skip.classList).toContain('sr');
    // Where it skips to.
    expect(root.querySelector('#main')?.tagName).toBe('MAIN');
    expect(root.querySelector('app-toasts [role="status"]')).not.toBeNull();
    expect(root.querySelector('app-announcer [role="status"]')).not.toBeNull();
  });

  it('tells a user signed out while the page was open that their sign-in has ended, once (FR-AUTH-09)', async () => {
    const fixture = TestBed.createComponent(App);
    http.expectOne('/-/api/session').flush({ user: MONA });
    await fixture.whenStable();
    expect(toasts()).toEqual([]);

    const session = TestBed.inject(Session);
    session.end();
    await fixture.whenStable();
    expect(toasts().map(({ message, icon }) => [message, icon])).toEqual([[ENDED, 'logout']]);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('app-toasts .toast')
        ?.textContent?.trim(),
    ).toBe(ENDED);

    session.end();
    await fixture.whenStable();
    expect(toasts()).toHaveLength(1);
  });

  it('tells a visitor of no sign-out', async () => {
    const fixture = TestBed.createComponent(App);
    http.expectOne('/-/api/session').flush({ user: null });
    TestBed.inject(Session).end();
    await fixture.whenStable();
    expect(toasts()).toEqual([]);
  });

  it('tells a user who deleted their data of no sign-out, as they asked for it (FR-PERS-04)', async () => {
    const fixture = TestBed.createComponent(App);
    http.expectOne('/-/api/session').flush({ user: MONA });
    const session = TestBed.inject(Session);
    session.deleteUser().subscribe();
    http.expectOne('/-/api/user').flush(null, { status: 204, statusText: 'No Content' });
    session.end();
    await fixture.whenStable();
    expect(toasts()).toEqual([]);
  });
});
