import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Toasts } from '../toast/toasts';
import { REFRESH, REFRESH_FAILED, refreshIn } from './messages';
import { Refresh } from './refresh';
import { Resources } from './resources';

@Component({
  imports: [Refresh],
  template: `<app-refresh
    [resource]="{ kind: 'repository', owner: 'acme', repo: 'widget' }"
    (refreshed)="refreshed = refreshed + 1"
  />`,
})
class Host {
  refreshed = 0;
}

describe('Refresh', () => {
  const now = new Date('2026-10-22T12:00:00Z').getTime();
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    // The countdown's clock, which ticks each second.
    vi.useFakeTimers({ now, toFake: ['Date', 'setInterval', 'clearInterval'] });
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  const button = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement | null;
  const label = () => button()?.textContent?.trim();
  const toasts = () =>
    TestBed.inject(Toasts)
      .toasts()
      .map((toast) => toast.message);

  async function signedIn(): Promise<void> {
    http.expectOne('/-/api/session').flush({
      user: { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' },
      token: null,
    });
    await fixture.whenStable();
  }

  /**
   * Clicks the button, and answers the server with `answer` as `status`. Meanwhile, the button
   * keeps focus, and clicking it again does nothing (NFR-UX-03).
   */
  async function refresh(status: number, answer: object | null = null): Promise<void> {
    button()!.focus();
    button()!.click();
    await fixture.whenStable();
    expect(button()!.getAttribute('aria-disabled')).toBe('true');
    button()!.click();
    http
      .expectOne({ method: 'POST', url: '/-/api/repositories/acme/widget/refresh' })
      .flush(answer, { status, statusText: `${status}` });
    await fixture.whenStable();
    expect(document.activeElement).toBe(button());
  }

  /** Lets `ms` pass. */
  async function wait(ms: number): Promise<void> {
    vi.advanceTimersByTime(ms);
    await fixture.whenStable();
  }

  it('is not offered to visitors (FR-ACC-02)', async () => {
    expect(button()).toBeNull();
    http.expectOne('/-/api/session').flush({ user: null });
    await fixture.whenStable();
    expect(button()).toBeNull();
  });

  it('refreshes the dashboard, and then counts down to when it may again (FR-DATA-07)', async () => {
    await signedIn();
    expect(label()).toBe(REFRESH);
    expect(button()!.getAttribute('aria-disabled')).toBeNull();

    await refresh(204);
    expect(fixture.componentInstance.refreshed).toBe(1);
    expect(TestBed.inject(Resources).refreshes()).toBe(1);
    expect(label()).toBe(refreshIn(60));
    expect(button()!.getAttribute('aria-disabled')).toBe('true');

    await wait(1_000);
    expect(label()).toBe(refreshIn(59));
    button()!.click();
    http.expectNone('/-/api/repositories/acme/widget/refresh');

    await wait(59_000);
    expect(label()).toBe(REFRESH);
    expect(button()!.getAttribute('aria-disabled')).toBeNull();
    button()!.click();
    http.expectOne('/-/api/repositories/acme/widget/refresh');
  });

  it('counts down to when the server says, when it is too soon', async () => {
    await signedIn();
    await refresh(429, { until: new Date(now + 30_000).toISOString() });
    expect(label()).toBe(refreshIn(30));
    expect(fixture.componentInstance.refreshed).toBe(0);
    expect(toasts()).toEqual([]);
  });

  it('waits a minute when it is too soon, and the server does not say until when', async () => {
    await signedIn();
    await refresh(429);
    expect(label()).toBe(refreshIn(60));
  });

  it('says when it could not refresh, and may be pressed again at once', async () => {
    await signedIn();
    await refresh(502);
    expect(toasts()).toEqual([REFRESH_FAILED]);
    expect(fixture.componentInstance.refreshed).toBe(0);
    expect(label()).toBe(REFRESH);
    expect(button()!.getAttribute('aria-disabled')).toBeNull();
    button()!.click();
    http.expectOne('/-/api/repositories/acme/widget/refresh');
  });
});
