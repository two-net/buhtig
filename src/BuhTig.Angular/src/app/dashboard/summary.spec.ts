import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { MockInstance } from 'vitest';
import { Announcer } from '../live/announcer';
import { Resource } from '../search/parse';
import { Toasts } from '../toast/toasts';
import { REFRESHED, STILL_SAVED, loaded, renamed } from './messages';
import { Resources } from './resources';
import { followSummary, same } from './summary';

@Component({ selector: 'app-blank', template: '' })
class Blank {}

@Component({ selector: 'app-host', template: '' })
class Host {
  readonly opened = signal<Resource>({ kind: 'repository', owner: 'ACME', repo: 'Widget' });
  /** As a dashboard has it: the same whatever the letter case of its names. */
  readonly resource = computed(() => this.opened(), { equal: same });
  readonly followed = followSummary(this.resource, (path) => `${path}/issues`);
}

describe('followSummary', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;
  let router: Router;
  let navigateByUrl: MockInstance<Router['navigateByUrl']>;

  const MONA = { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' };

  /** Makes the dashboard, at `url`, for the viewer that `session` describes, if it says. */
  async function make(url: string, session?: object): Promise<void> {
    await router.navigateByUrl(url);
    navigateByUrl = vi.spyOn(router, 'navigateByUrl');
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    if (session) {
      http.expectOne('/-/api/session').flush(session);
      await fixture.whenStable();
    }
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    http.match('/-/api/session');
    http.verify();
  });

  const followed = () => fixture.componentInstance.followed;
  const toasts = () =>
    TestBed.inject(Toasts)
      .toasts()
      .map((toast) => [toast.message, toast.icon]);
  /** Where the dashboard moved itself to, in place of the URL it was at. */
  const moves = () =>
    navigateByUrl.mock.calls.filter(([, extras]) => extras?.replaceUrl).map(([url]) => `${url}`);
  /** The views recorded since last asked, as the URLs they were recorded at. */
  const views = () =>
    http
      .match(
        (request: HttpRequest<unknown>) =>
          request.method === 'POST' && request.url.endsWith('/view'),
      )
      .map((request) => request.request.url);

  async function answer(body: object | null, status = 200): Promise<void> {
    http
      .expectOne('/-/api/repositories/ACME/Widget')
      .flush(body, { status, statusText: `${status}` });
    await fixture.whenStable();
  }

  /** Refreshes the dashboard, as its Refresh button does. */
  async function refresh(): Promise<void> {
    followed().refreshing.set(true);
    TestBed.inject(Resources)
      .refresh({ kind: 'repository', owner: 'acme', repo: 'widget' })
      .subscribe();
    http
      .expectOne('/-/api/repositories/acme/widget/refresh')
      .flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
  }

  it('knows nothing of the resource until the server says', async () => {
    await make('/ACME/Widget/issues');
    expect(followed().summary()).toBeUndefined();
    await answer({ name: 'acme/widget' });
    expect(followed().summary()?.path).toBe('/acme/widget');
  });

  it("moves to the path that GitHub's spelling gives, in place (FR-NAV-04)", async () => {
    await make('/ACME/Widget/issues');
    await answer({ name: 'acme/widget' });
    expect(moves()).toEqual(['/acme/widget/issues']);
    await vi.waitFor(() => expect(router.url).toBe('/acme/widget/issues'));
    // Not renamed: only spelled otherwise.
    expect(toasts()).toEqual([]);
  });

  it('moves back when the same dashboard is opened spelled otherwise, asking nothing anew', async () => {
    await make('/ACME/Widget/issues');
    await answer({ name: 'acme/widget' });
    await vi.waitFor(() => expect(router.url).toBe('/acme/widget/issues'));
    navigateByUrl.mockClear();
    // As from the dashboard's own search box.
    await router.navigateByUrl('/Acme/WIDGET/issues');
    fixture.componentInstance.opened.set({ kind: 'repository', owner: 'Acme', repo: 'WIDGET' });
    await fixture.whenStable();
    await vi.waitFor(() => expect(router.url).toBe('/acme/widget/issues'));
    expect(moves()).toEqual(['/acme/widget/issues']);
  });

  it('stays where it is already, whatever the query and fragment', async () => {
    await make('/acme/widget/issues?q=1#top');
    http.expectOne('/-/api/repositories/ACME/Widget').flush({ name: 'acme/widget' });
    await fixture.whenStable();
    expect(moves()).toEqual([]);
  });

  it('says so when the repository was renamed or transferred (FR-NAV-05)', async () => {
    await make('/ACME/Widget/issues');
    await answer({ name: 'other/gadget' });
    expect(moves()).toEqual(['/other/gadget/issues']);
    expect(toasts()).toEqual([[renamed('ACME/Widget', 'other/gadget'), 'info']]);
  });

  it('stays where it is when the server names no such resource, or cannot tell', async () => {
    await make('/ACME/Widget/issues');
    await answer({ name: '../evil' });
    for (const status of [404, 429, 502]) {
      followed().retry();
      await fixture.whenStable();
      await answer(null, status);
    }
    expect(moves()).toEqual([]);
  });

  it('tells assistive technology that the dashboard loaded, once', async () => {
    const announce = vi.spyOn(TestBed.inject(Announcer), 'announce');
    await make('/acme/widget/issues');
    await answer({ name: 'acme/widget' });
    expect(announce).toHaveBeenCalledExactlyOnceWith(loaded('acme/widget'));
    await refresh();
    http.expectOne('/-/api/repositories/ACME/Widget').flush({ name: 'acme/widget' });
    expect(announce).toHaveBeenCalledOnce();
  });

  it('forgets one resource as it moves to another, and leaves what it asked of it', async () => {
    await make('/acme/widget/issues');
    await answer({ name: 'acme/widget' });
    // The same resource, spelled otherwise.
    fixture.componentInstance.opened.set({ kind: 'repository', owner: 'acme', repo: 'widget' });
    await fixture.whenStable();
    expect(followed().summary()?.path).toBe('/acme/widget');
    http.expectNone('/-/api/repositories/acme/widget');

    fixture.componentInstance.opened.set({ kind: 'repository', owner: 'acme', repo: 'gadget' });
    await fixture.whenStable();
    expect(followed().summary()).toBeUndefined();
    const gadget = http.expectOne('/-/api/repositories/acme/gadget');
    fixture.componentInstance.opened.set({ kind: 'repository', owner: 'acme', repo: 'rocket' });
    await fixture.whenStable();
    expect(gadget.cancelled).toBe(true);
    http.expectOne('/-/api/repositories/acme/rocket').flush({ name: 'acme/rocket' });
  });

  it('shows why it could show nothing, and asks again on retry', async () => {
    await make('/acme/widget/issues');
    await answer(null, 502);
    expect(followed().summary()?.failure).toBe('github');
    followed().retry();
    await fixture.whenStable();
    await answer({ name: 'acme/widget' });
    expect(followed().summary()?.failure).toBeUndefined();
    // Nothing was refreshed.
    expect(toasts()).toEqual([]);
  });

  describe('refreshing (FR-DATA-07)', () => {
    beforeEach(async () => {
      await make('/acme/widget/issues');
      await answer({ name: 'acme/widget', fetched_at: '2026-10-22T12:00:00Z' });
    });

    it('says the dashboard was refreshed, once its data has come again', async () => {
      await refresh();
      expect(followed().refreshing()).toBe(true);
      await answer({ name: 'acme/widget', fetched_at: '2026-10-22T12:05:00Z' });
      expect(followed().refreshing()).toBe(false);
      expect(followed().summary()?.fetchedAt).toEqual(new Date('2026-10-22T12:05:00Z'));
      expect(toasts()).toEqual([[REFRESHED, 'check']]);
    });

    it("says GitHub couldn't be reached when the data that came is saved data", async () => {
      await refresh();
      await answer({ name: 'acme/widget', fetched_at: '2026-10-22T12:00:00Z', stale: 'github' });
      expect(followed().summary()?.stale).toBe('github');
      expect(toasts()).toEqual([[STILL_SAVED, 'cloudoff']]);
    });

    it('keeps what it showed when nothing came', async () => {
      await refresh();
      await answer(null, 502);
      expect(followed().refreshing()).toBe(false);
      expect(followed().summary()).toEqual(
        expect.objectContaining({ path: '/acme/widget', failure: undefined }),
      );
      expect(toasts()).toEqual([[STILL_SAVED, 'cloudoff']]);
    });
  });

  describe('history (FR-PERS-01)', () => {
    it("records a signed-in user's view, with the names as GitHub spells them", async () => {
      await make('/ACME/Widget/issues', { user: MONA, token: null });
      expect(views()).toEqual([]);
      await answer({ name: 'acme/widget' });
      expect(views()).toEqual(['/-/api/repositories/acme/widget/view']);
    });

    it('records it once per dashboard, not again on a refresh or a retry', async () => {
      await make('/acme/widget/issues', { user: MONA, token: null });
      await answer({ name: 'acme/widget' });
      http
        .expectOne({ method: 'POST', url: '/-/api/repositories/acme/widget/view' })
        .flush(null, { status: 503, statusText: 'Unavailable' });
      await refresh();
      await answer({ name: 'acme/widget' });
      followed().retry();
      await fixture.whenStable();
      await answer({ name: 'acme/widget' });
      fixture.componentInstance.opened.set({ kind: 'repository', owner: 'acme', repo: 'widget' });
      await fixture.whenStable();
      expect(views()).toEqual([]);
    });

    it('records a dashboard for a user known only after it loads', async () => {
      await make('/acme/widget/issues');
      await answer({ name: 'acme/widget' });
      http.expectOne('/-/api/session').flush({ user: MONA, token: null });
      await fixture.whenStable();
      expect(views()).toEqual(['/-/api/repositories/acme/widget/view']);
    });

    it("records no visitor's views", async () => {
      await make('/acme/widget/issues', { user: null });
      await answer({ name: 'acme/widget' });
      expect(views()).toEqual([]);
    });

    it('records nothing GitHub says is not there, or keeps from the viewer', async () => {
      await make('/acme/widget/issues', { user: MONA, token: null });
      await answer(null, 404);
      followed().retry();
      await fixture.whenStable();
      await answer({ denied: 'token' }, 403);
      expect(views()).toEqual([]);
    });

    it('records the new name of a renamed repository only once it is shown there', async () => {
      await make('/ACME/Widget/issues', { user: MONA, token: null });
      await answer({ name: 'other/gadget' });
      expect(views()).toEqual([]);
      fixture.componentInstance.opened.set({ kind: 'repository', owner: 'other', repo: 'gadget' });
      await fixture.whenStable();
      http.expectOne('/-/api/repositories/other/gadget').flush({ name: 'other/gadget' });
      await fixture.whenStable();
      expect(views()).toEqual(['/-/api/repositories/other/gadget/view']);
    });
  });
});
