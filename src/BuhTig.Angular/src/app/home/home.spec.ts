import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Glide } from '../motion/glide';
import { Home } from './home';
import { HEADLINE } from './messages';
import { RECENT_HEADING } from './signed-in-messages';

@Component({ template: '<h1>Elsewhere</h1>' })
class Elsewhere {}

describe('Home', () => {
  let fixture: ComponentFixture<Home>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        provideRouter([{ path: 'acme', component: Elsewhere }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
      // The signed-in home page's code comes as it is needed, at once.
      deferBlockBehavior: DeferBlockBehavior.Playthrough,
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
  });

  afterEach(() => {
    // What others opened here lately, which `recent.spec.ts` tests.
    http.match('/-/api/recent');
    http.verify();
  });

  const MONA = { login: 'mona', name: 'Mona Lisa', avatar_url: 'https://example.com/mona.png' };
  const RECENT = {
    repositories: ['acme/a', 'acme/b'].map((name) => ({
      name,
      owner_avatar_url: null,
      description: null,
      language: null,
      stars: 1,
      forks: 0,
      pushed_at: null,
      fetched_at: null,
    })),
  };

  const element = () => fixture.nativeElement as HTMLElement;
  const visitor = () => element().querySelector('app-visitor-home');
  const signedIn = () => element().querySelector('app-signed-in-home');

  async function session(user: object | null): Promise<void> {
    http.expectOne('/-/api/session').flush({ user, token: null });
    await fixture.whenStable();
  }

  async function recent(): Promise<void> {
    http.expectOne('/-/api/recent').flush(RECENT);
    await fixture.whenStable();
  }

  it('shows neither home page until it knows who is viewing', () => {
    expect(visitor()).toBeNull();
    expect(signedIn()).toBeNull();
    http.expectOne('/-/api/session');
  });

  it('shows a visitor what BuhTig is, and what others opened here lately to try (UI-02)', async () => {
    await session(null);
    await recent();
    expect(signedIn()).toBeNull();
    expect(visitor()!.querySelector('h1')!.textContent?.trim()).toBe(HEADLINE);
    expect(
      [...visitor()!.querySelectorAll('.hero-more a')].map((link) => link.getAttribute('href')),
    ).toEqual(['/acme/a', '/acme/b']);
    // Only the visitor's home page offers a surprise.
    http.expectOne('/-/api/surprise').flush(null, { status: 404, statusText: 'Not Found' });
    // Nor does it ask for a visitor's dashboards, which a visitor has none of.
    http.expectNone('/-/api/shortcuts');
  });

  it('shows a signed-in user their dashboards, and what others opened here lately (FR-SRCH-08)', async () => {
    await session(MONA);
    await recent();
    expect(visitor()).toBeNull();
    expect(signedIn()).not.toBeNull();
    http.expectOne('/-/api/shortcuts').flush({ pins: [], recent: [] });
    await fixture.whenStable();
    expect(signedIn()!.querySelector('h1')!.textContent?.trim()).toBe('Home');
    expect(signedIn()!.querySelector('.recent-title')!.textContent?.trim()).toBe(RECENT_HEADING);
    expect(
      [...signedIn()!.querySelectorAll('.feed .fc-top a')].map((link) => link.getAttribute('href')),
    ).toEqual(['/acme/a', '/acme/b']);
    http.expectNone('/-/api/surprise');
  });

  it('asks once what others opened here lately, whoever is viewing', async () => {
    http.expectOne('/-/api/recent');
    await session(null);
    http.expectNone('/-/api/recent');
    http.expectOne('/-/api/surprise');
  });

  it('notes where the search box was as the page gives way to another, for it to glide from (FR-ANIM-03)', async () => {
    const leave = vi.spyOn(TestBed.inject(Glide), 'leave');
    await session(null);
    await recent();
    http.expectOne('/-/api/surprise').flush(null, { status: 404, statusText: 'Not Found' });
    const bounds = new DOMRect(120, 300, 640, 48);
    visitor()!.querySelector<HTMLElement>('.hero .search')!.getBoundingClientRect = () => bounds;
    await TestBed.inject(Router).navigateByUrl('/acme');
    expect(leave).toHaveBeenCalledOnce();
    const [navigation, from] = leave.mock.calls[0];
    expect(navigation).toBeGreaterThan(0);
    expect(from).toBe(bounds);
  });

  it("notes where the signed-in home page's own search box was", async () => {
    const leave = vi.spyOn(TestBed.inject(Glide), 'leave');
    await session(MONA);
    http.expectOne('/-/api/shortcuts').flush({ pins: [], recent: [] });
    await fixture.whenStable();
    const bounds = new DOMRect(200, 120, 560, 40);
    signedIn()!.querySelector<HTMLElement>('.dash-search .search')!.getBoundingClientRect = () =>
      bounds;
    await TestBed.inject(Router).navigateByUrl('/acme');
    expect(leave).toHaveBeenCalledExactlyOnceWith(expect.any(Number), bounds);
  });

  it('notes nothing as it gives way before it shows a search box', async () => {
    const leave = vi.spyOn(TestBed.inject(Glide), 'leave');
    await TestBed.inject(Router).navigateByUrl('/acme');
    expect(leave).not.toHaveBeenCalled();
    http.expectOne('/-/api/session');
  });
});
