import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Mock } from 'vitest';
import { routes } from './app.routes';

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

  it('shows the search box on the home page', async () => {
    const harness = await RouterTestingHarness.create('/');
    const page = harness.routeNativeElement!;
    expect(page.querySelector('h1')?.textContent).toBe('BuhTig');
    expect(page.querySelector('form[role="search"] input')).not.toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('BuhTig');
  });

  it('links the home page to About and Privacy, and says whose it is not (UI-08)', async () => {
    const harness = await RouterTestingHarness.create('/');
    const footer = harness.routeNativeElement!.querySelector('footer')!;
    const links = [...footer.querySelectorAll('a')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['About', '/-/about'],
      ['Privacy', '/-/privacy'],
    ]);
    expect(footer.textContent).toContain('Not affiliated with GitHub');
  });

  it('opens a dashboard from a pasted URL and Enter alone (NFR-UX-01)', async () => {
    // The server has not yet said who is viewing, and a visitor need not wait for it.
    const harness = await RouterTestingHarness.create('/');
    const page = harness.routeNativeElement!;
    const input = page.querySelector('input')!;
    input.value = 'https://github.com/owner/repo/tree/main';
    input.dispatchEvent(new Event('input'));
    page.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/owner/repo'));
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe('owner/repo');
  });

  it('offers a surprise beside "Show dashboard" on the home page (UI-02, FR-SRCH-10)', async () => {
    const harness = await RouterTestingHarness.create('/');
    TestBed.inject(HttpTestingController)
      .expectOne('/-/api/surprise')
      .flush({ name: 'owner/repo' });
    await harness.fixture.whenStable();
    const buttons = [
      ...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>(
        'form[role="search"] button',
      ),
    ];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Show dashboard',
      'Surprise me',
    ]);
    buttons[1].click();
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/owner/repo'));
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe('owner/repo');
  });

  it("has BuhTig's own pages under /-/, apart from dashboards (FR-NAV-03)", async () => {
    const harness = await RouterTestingHarness.create();
    const heading = () => harness.routeNativeElement?.querySelector('h1')?.textContent?.trim();
    const title = () => TestBed.inject(Title).getTitle();
    await harness.navigateByUrl('/-/about');
    expect([heading(), title()]).toEqual(['About BuhTig', 'About · BuhTig']);
    expect(harness.routeNativeElement?.textContent).toContain(
      'It is not affiliated with or endorsed by GitHub.',
    );
    await harness.navigateByUrl('/-/privacy');
    expect([heading(), title()]).toEqual(['Privacy', 'Privacy · BuhTig']);
    await harness.navigateByUrl('/-/settings');
    expect([heading(), title()]).toEqual(['Settings', 'Settings · BuhTig']);
    for (const path of ['/-/auth/sign-in', '/-']) {
      await harness.navigateByUrl(path);
      expect([heading(), title()], path).toEqual(['Page not found', 'Page not found · BuhTig']);
    }
  });

  it('has a dashboard for each repository and organization (FR-NAV-01)', async () => {
    const harness = await RouterTestingHarness.create();
    const heading = () => harness.routeNativeElement?.querySelector('h1')?.textContent?.trim();
    await harness.navigateByUrl('/vercel/next.js');
    expect(heading()).toBe('vercel/next.js');
    await harness.navigateByUrl('/angular');
    expect(heading()).toBe('angular');
  });

  it('titles dashboards after their resource (UI-04)', async () => {
    const harness = await RouterTestingHarness.create();
    const title = () => TestBed.inject(Title).getTitle();
    await harness.navigateByUrl('/vercel/next.js');
    expect(title()).toBe('vercel/next.js · BuhTig');
    await harness.navigateByUrl('/angular');
    expect(title()).toBe('angular · BuhTig');
    await harness.navigateByUrl('/');
    expect(title()).toBe('BuhTig');
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
      vi.spyOn(HTMLInputElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLInputElement,
      ) {
        return this.closest('app-home')
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

    const wordmark = (harness: RouterTestingHarness) =>
      harness.routeNativeElement!.querySelector('h1')!;

    it("makes the wordmark's entrance on the session's first home page alone (FR-ANIM-01)", async () => {
      const harness = await RouterTestingHarness.create('/');
      expect(wordmark(harness).classList).toContain('entrance');
      await harness.navigateByUrl('/-/about');
      await harness.navigateByUrl('/');
      expect(wordmark(harness).classList).not.toContain('entrance');
    });

    it('glides the search box into the header of a dashboard opened from home, as it fades in (FR-ANIM-03)', async () => {
      const harness = await RouterTestingHarness.create('/');
      await harness.navigateByUrl('/owner/repo');
      const dashboard = harness.routeNativeElement!;
      expect(dashboard.classList).toContain('arriving');
      expect(animate).toHaveBeenCalledOnce();
      expect(animate.mock.contexts[0]).toBe(dashboard.querySelector('header input'));
      const [keyframes] = animate.mock.calls[0];
      expect((keyframes as Keyframe[])[0]['transform']).toBe(
        'translate(-50px, 288px) scale(1, 1.2)',
      );
    });

    it('opens a dashboard at once unless it is opened from home', async () => {
      const harness = await RouterTestingHarness.create('/owner/repo');
      expect(harness.routeNativeElement!.classList).not.toContain('arriving');
      // Nor from home by way of another page.
      await harness.navigateByUrl('/');
      await harness.navigateByUrl('/-/about');
      await harness.navigateByUrl('/acme');
      expect(harness.routeNativeElement!.classList).not.toContain('arriving');
      expect(animate).not.toHaveBeenCalled();
    });

    it('keeps still while the browser asks for reduced motion (FR-ANIM-10)', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      const harness = await RouterTestingHarness.create('/');
      expect(wordmark(harness).classList).not.toContain('entrance');
      await harness.navigateByUrl('/owner/repo');
      expect(harness.routeNativeElement!.classList).not.toContain('arriving');
      expect(animate).not.toHaveBeenCalled();
    });
  });
});
