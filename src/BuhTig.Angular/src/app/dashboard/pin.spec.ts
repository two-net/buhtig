import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Shortcut } from '../shortcuts/pick';
import { Toasts } from '../toast/toasts';
import { PIN, PINNED_LABEL, PIN_FAILED, PIN_LIMIT, pinned, unpinned } from './messages';
import { Pin } from './pin';

@Component({
  imports: [Pin],
  template: `<app-pin [shortcut]="shortcut()" />`,
})
class Host {
  readonly shortcut = signal<Shortcut>({ kind: 'repository', name: 'acme/widget' });
}

/** The comparison of `acme/widget` with `octo/thing` (FR-CMP-05). */
const COMPARISON: Shortcut = { kind: 'repository_comparison', name: 'acme/widget...octo/thing' };
const COMPARISON_PIN = '/-/api/comparisons/repositories/acme/widget/octo/thing/pin';

describe('Pin', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const button = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement | null;
  /** What the button says, and whether it is pressed. */
  const state = () => [button()?.textContent?.trim(), button()?.getAttribute('aria-pressed')];
  const toasts = () =>
    TestBed.inject(Toasts)
      .toasts()
      .map((toast) => [toast.message, toast.icon]);
  const WIDGET = { kind: 'repository', name: 'acme/widget' };

  /** Opens it for a signed-in user, and answers what they pinned with `pins`. */
  async function signedIn(pins: object[]): Promise<void> {
    http.expectOne('/-/api/session').flush({
      user: { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' },
      token: null,
    });
    await fixture.whenStable();
    http.expectOne('/-/api/shortcuts').flush({ pins, recent: [] });
    await fixture.whenStable();
  }

  /**
   * Clicks the button, and answers the server's part, `method`, with `answer` as `status`.
   * Meanwhile, the button keeps focus, and clicking it again does nothing (NFR-UX-03).
   */
  async function toggle(
    method: string,
    status: number,
    answer: object | null,
    url = '/-/api/repositories/acme/widget/pin',
  ): Promise<void> {
    button()!.focus();
    button()!.click();
    await fixture.whenStable();
    expect(button()!.getAttribute('aria-disabled')).toBe('true');
    button()!.click();
    http.expectOne({ method, url }).flush(answer, { status, statusText: `${status}` });
    await fixture.whenStable();
    expect(button()!.getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(button());
  }

  it('is not offered to visitors, whose pins it does not ask for (FR-ACC-02)', async () => {
    http.expectOne('/-/api/session').flush({ user: null });
    await fixture.whenStable();
    expect(button()).toBeNull();
    http.expectNone('/-/api/shortcuts');
  });

  it('is not offered when the server cannot say what is pinned', async () => {
    http.expectOne('/-/api/session').flush({
      user: { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' },
      token: null,
    });
    await fixture.whenStable();
    expect(button()).toBeNull();
    http.expectOne('/-/api/shortcuts').flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(button()).toBeNull();
  });

  it('pins a dashboard, and unpins it, saying so (FR-PERS-02)', async () => {
    await signedIn([{ kind: 'organization', name: 'acme' }]);
    expect(state()).toEqual([PIN, 'false']);

    await toggle('PUT', 200, { pins: [{ kind: 'organization', name: 'acme' }, WIDGET] });
    expect(state()).toEqual([PINNED_LABEL, 'true']);
    expect(toasts()).toEqual([[pinned('acme/widget'), 'pin-fill']]);

    await toggle('DELETE', 200, { pins: [{ kind: 'organization', name: 'acme' }] });
    expect(state()).toEqual([PIN, 'false']);
    expect(toasts().at(-1)).toEqual([unpinned('acme/widget'), 'pin']);
  });

  it('knows a dashboard pinned already, whatever the case of its name', async () => {
    await signedIn([{ kind: 'repository', name: 'ACME/Widget' }]);
    expect(state()).toEqual([PINNED_LABEL, 'true']);
  });

  it('says when 12 dashboards are pinned already', async () => {
    await signedIn([]);
    await toggle('PUT', 409, { error: 'too_many_pins' });
    expect(state()).toEqual([PIN, 'false']);
    expect(toasts()).toEqual([[PIN_LIMIT, 'alert']]);
  });

  it('says when it could not change the pins', async () => {
    await signedIn([WIDGET]);
    await toggle('DELETE', 503, null);
    expect(state()).toEqual([PINNED_LABEL, 'true']);
    expect(toasts()).toEqual([[PIN_FAILED, 'alert']]);
  });

  it('pins a comparison, and unpins it, as a dashboard (FR-CMP-05)', async () => {
    fixture.componentInstance.shortcut.set(COMPARISON);
    await signedIn([WIDGET]);
    expect(state()).toEqual([PIN, 'false']);

    await toggle('PUT', 200, { pins: [WIDGET, COMPARISON] }, COMPARISON_PIN);
    expect(state()).toEqual([PINNED_LABEL, 'true']);
    expect(toasts()).toEqual([[pinned('acme/widget vs octo/thing'), 'pin-fill']]);

    await toggle('DELETE', 200, { pins: [WIDGET] }, COMPARISON_PIN);
    expect(state()).toEqual([PIN, 'false']);
    expect(toasts().at(-1)).toEqual([unpinned('acme/widget vs octo/thing'), 'pin']);
  });

  it('pins comparisons until the twelfth pin, as dashboards (FR-PERS-02)', async () => {
    fixture.componentInstance.shortcut.set(COMPARISON);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ kind: 'organization', name: `o${i}` }));
    await signedIn(eleven);
    await toggle('PUT', 200, { pins: [...eleven, COMPARISON] }, COMPARISON_PIN);
    expect(state()).toEqual([PINNED_LABEL, 'true']);

    fixture.componentInstance.shortcut.set({
      kind: 'account_comparison',
      name: 'mona...acme',
    });
    await fixture.whenStable();
    http.expectOne('/-/api/shortcuts').flush({ pins: [...eleven, COMPARISON], recent: [] });
    await fixture.whenStable();
    await toggle(
      'PUT',
      409,
      { error: 'too_many_pins' },
      '/-/api/comparisons/accounts/mona/acme/pin',
    );
    expect(state()).toEqual([PIN, 'false']);
    expect(toasts().at(-1)).toEqual([PIN_LIMIT, 'alert']);
  });
});
