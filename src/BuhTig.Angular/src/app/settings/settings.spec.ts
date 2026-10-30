import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Mock } from 'vitest';
import { Clock } from '../format/clock';
import { exactDay, list, relativeTime, timeUntil } from '../format/format';
import { Session, noticeSignOut } from '../session/session';
import { Toasts } from '../toast/toasts';
import {
  CREATE_TOKEN,
  MANAGE_TOKENS,
  NEVER_EXPIRES,
  NO_SCOPES,
  PERMISSIONS_UNKNOWN,
  REMOVED,
  REMOVE_FAILED,
  SAVED,
  SIGN_IN_FIRST,
  SIGN_IN_TO_MANAGE,
  TOKEN_ACTIVE,
  TOKEN_ADVICE,
  TOKEN_HANDLING,
  TOKEN_INVALID,
  TOKEN_PURPOSE,
  expiresSoon,
  saveProblemMessage,
  scopes,
} from './messages';
import { Settings } from './settings';

describe('Settings', () => {
  const NOW = new Date('2026-10-22T12:00:00Z').getTime();
  let fixture: ComponentFixture<Settings>;
  let http: HttpTestingController;
  const scrolling = Element.prototype.scrollIntoView;
  let scrollIntoView: Mock<Element['scrollIntoView']>;

  beforeEach(async () => {
    // The tests' jsdom scrolls nothing, and has no way to.
    scrollIntoView = vi.fn<Element['scrollIntoView']>();
    Element.prototype.scrollIntoView = scrollIntoView;
    TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        provideRouter([{ path: '-/settings', children: [] }]),
        provideHttpClient(withInterceptors([noticeSignOut])),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(NOW) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Settings);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    Element.prototype.scrollIntoView = scrolling;
  });

  const MONA = {
    login: 'mona',
    name: 'Mona Lisa',
    avatar_url: 'https://example.com/mona.png',
    signed_in_at: '2026-10-20T12:00:00Z',
  };
  const CLASSIC = {
    type: 'classic',
    last_four: 'abcd',
    scopes: ['repo', 'read:org'],
    expires_at: null,
    status: 'valid',
    last_validated_at: '2026-10-22T11:00:00Z',
  };

  const page = () => fixture.nativeElement as HTMLElement;
  const main = () => page().querySelector('main')!;
  const text = () => main().textContent!.replace(/\s+/g, ' ');
  const input = () => main().querySelector<HTMLInputElement>('#token-input');
  const button = (label: string) =>
    [...main().querySelectorAll('button')].find(
      (button) => button.textContent?.replace(/\s+/g, ' ').trim() === label,
    );
  /** The text that `element` shows, without the tooltips that hover and focus show. */
  const shown = (element: Element) => {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  };
  /** Each detail of the token, as its name and what it shows. */
  const details = () =>
    [...main().querySelectorAll('.kv dt')].map((term) => [
      term.textContent?.trim(),
      shown(term.nextElementSibling!),
    ]);
  const notice = () => main().querySelector('.notice[role="status"]');
  const alert = () => main().querySelector('#token-problem')?.textContent?.trim();
  const toasts = () =>
    TestBed.inject(Toasts)
      .toasts()
      .map((toast) => toast.message);
  const session = () => TestBed.inject(Session);
  /** The links of the side navigation, as their text, and whether each is marked current. */
  const navigation = () =>
    [...main().querySelectorAll('nav[aria-label="Settings"] a')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('aria-current'),
    ]);

  async function signedIn(token: object | null, user: object = MONA): Promise<void> {
    http.expectOne('/-/api/session').flush({ user, token });
    await fixture.whenStable();
    // Pins and history, which `shortcuts.spec.ts` tests.
    http.expectOne('/-/api/shortcuts').flush({ pins: [], recent: [] });
    await fixture.whenStable();
  }

  /** Types `value` into the token input, and saves it. */
  async function enter(value: string): Promise<void> {
    input()!.value = value;
    input()!.dispatchEvent(new Event('input'));
    main()
      .querySelector('form.field')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  }

  async function click(label: string): Promise<void> {
    button(label)!.click();
    await fixture.whenStable();
  }

  it('shows nothing until it knows who is viewing', () => {
    expect(main().children).toHaveLength(0);
    http.expectOne('/-/api/session');
  });

  it('asks a visitor to sign in, and to come back here (FR-ACC-02)', async () => {
    http.expectOne('/-/api/session').flush({ user: null });
    await fixture.whenStable();
    expect(main().querySelector('h1')!.textContent?.trim()).toBe(SIGN_IN_TO_MANAGE);
    expect(text()).toContain(SIGN_IN_FIRST);
    const link = main().querySelector('a')!;
    expect(link.textContent?.trim()).toBe('Sign in with GitHub');
    expect(link.getAttribute('href')).toBe('/-/auth/sign-in?return_to=%2F-%2Fsettings');
    expect(input()).toBeNull();
    expect(main().querySelector('nav')).toBeNull();
  });

  it('says who is signed in, since when, and offers to sign out', async () => {
    await signedIn(null);
    expect(main().querySelector('h1')!.textContent?.trim()).toBe('Mona Lisa');
    expect(shown(main().querySelector('.settings-who small')!)).toBe(
      `@mona, signed in ${relativeTime(new Date(MONA.signed_in_at), NOW)}`,
    );
    expect(main().querySelector('.settings-who img')!.getAttribute('src')).toBe(MONA.avatar_url);
    const form = main().querySelector<HTMLFormElement>('.settings-who form')!;
    expect([form.getAttribute('method'), form.getAttribute('action')]).toEqual([
      'post',
      '/-/auth/sign-out',
    ]);
    expect(form.querySelector('button')!.textContent?.trim()).toBe('Sign out');
  });

  it('names a user without a display name by their login, and leaves out what it does not know', async () => {
    await signedIn(null, { ...MONA, name: null, signed_in_at: null });
    expect(main().querySelector('h1')!.textContent?.trim()).toBe('mona');
    expect(shown(main().querySelector('.settings-who small')!)).toBe('@mona, signed in');
    expect(main().querySelector('.settings-who time')).toBeNull();
  });

  it('leads to each section, and marks the one in view', async () => {
    await signedIn(null);
    expect(navigation()).toEqual([
      ['Personal access token', 'true'],
      ['Pins and history', null],
      ['Your data', null],
    ]);
    expect(
      [...main().querySelectorAll('nav[aria-label="Settings"] a')].map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual(['/-/settings#token', '/-/settings#shortcuts', '/-/settings#data']);

    const link = [...main().querySelectorAll<HTMLElement>('nav a')].find(
      (link) => link.textContent?.trim() === 'Your data',
    )!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    await fixture.whenStable();
    // In place, rather than by the URL.
    expect(click.defaultPrevented).toBe(true);
    expect(navigation()).toEqual([
      ['Personal access token', null],
      ['Pins and history', null],
      ['Your data', 'true'],
    ]);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(main().querySelector('#data'));
    // Focus goes to where it leads (NFR-UX-03).
    expect(document.activeElement).toBe(main().querySelector('#data-heading'));
  });

  it('says what a token is for, how BuhTig keeps it, and which to create (FR-PAT-09)', async () => {
    await signedIn(null);
    expect(text()).toContain(TOKEN_PURPOSE);
    expect(text()).toContain(TOKEN_HANDLING);
    expect(text()).toContain(TOKEN_ADVICE);
    const section = main().querySelector('#token')!;
    expect(
      [...section.querySelectorAll('a')].map((link) => [
        link.textContent?.trim(),
        link.getAttribute('href'),
      ]),
    ).toEqual([
      [CREATE_TOKEN, 'https://github.com/settings/personal-access-tokens/new'],
      [MANAGE_TOKENS, 'https://github.com/settings/tokens'],
    ]);
    // A field for a secret, which the browser neither shows nor offers to fill in.
    expect(input()!.type).toBe('password');
    expect(input()!.getAttribute('autocomplete')).toBe('off');
    expect(input()!.getAttribute('aria-label')).toBe('Personal access token');
    expect(input()!.hasAttribute('aria-invalid')).toBe(false);
    // Nothing yet to show, replace or remove.
    expect(details()).toEqual([]);
    expect(button('Replace token')).toBeUndefined();
    expect(button('Remove token')).toBeUndefined();
    expect(button('Cancel')).toBeUndefined();
  });

  it('saves a token, and shows only what BuhTig may show of it (FR-PAT-04)', async () => {
    await signedIn(null);
    await enter('ghp_secret');
    const request = http.expectOne('/-/api/token');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ token: 'ghp_secret' });
    expect(button('Save token')!.getAttribute('aria-disabled')).toBe('true');
    // Saving once is enough.
    await enter('ghp_secret');
    request.flush(CLASSIC);
    await fixture.whenStable();

    expect(toasts()).toEqual([SAVED]);
    expect(main().querySelector('.status')!.textContent?.trim()).toBe(TOKEN_ACTIVE);
    expect(details()).toEqual([
      ['Type', 'Classic'],
      ['Token', '••••••••abcd'],
      ['Access', scopes(list(['repo', 'read:org']))],
      ['Expires', NEVER_EXPIRES],
      ['Last checked', relativeTime(new Date(CLASSIC.last_validated_at), NOW)],
    ]);
    expect(page().textContent).not.toContain('ghp_secret');
    expect(input()).toBeNull();
    // Focus goes to what took the form's place (NFR-UX-03).
    expect(document.activeElement).toBe(button('Replace token'));
    expect(session().token()?.lastFour).toBe('abcd');
  });

  it("shows a fine-grained token's expiry, and that GitHub does not report its permissions", async () => {
    const expiresAt = '2027-03-01T12:00:00.000Z';
    await signedIn({ ...CLASSIC, type: 'fine_grained', scopes: null, expires_at: expiresAt });
    expect(Object.fromEntries(details())).toEqual({
      Type: 'Fine-grained',
      Token: '••••••••abcd',
      Access: PERMISSIONS_UNKNOWN,
      Expires: exactDay(new Date(expiresAt)),
      'Last checked': relativeTime(new Date(CLASSIC.last_validated_at), NOW),
    });
    // Months away, so no reminder yet.
    expect(notice()).toBeNull();
  });

  it('says that a classic token without scopes reads public data only', async () => {
    await signedIn({ ...CLASSIC, scopes: [], last_validated_at: null });
    expect(details()).toEqual([
      ['Type', 'Classic'],
      ['Token', '••••••••abcd'],
      ['Access', NO_SCOPES],
      ['Expires', NEVER_EXPIRES],
    ]);
  });

  it('reminds the user to replace a token that expires within 7 days (FR-PAT-10)', async () => {
    const expiresAt = new Date(NOW + 3 * 24 * 60 * 60 * 1000 + 60_000);
    await signedIn({ ...CLASSIC, expires_at: expiresAt.toISOString() });
    expect(notice()!.textContent?.trim()).toBe(expiresSoon(timeUntil(expiresAt, NOW)));
    expect(timeUntil(expiresAt, NOW)).toBe('in 3 days');
  });

  it('reminds of no expiry 8 days away, nor of that of a token that no longer works', async () => {
    const soon = new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString();
    await signedIn({ ...CLASSIC, status: 'invalid', expires_at: soon });
    expect(notice()).toBeNull();

    session().setToken({
      ...session().token()!,
      status: 'valid',
      expiresAt: new Date(NOW + 8 * 24 * 60 * 60 * 1000),
    });
    await fixture.whenStable();
    expect(notice()).toBeNull();
  });

  it('asks to replace a token that GitHub no longer accepts (FR-PAT-07)', async () => {
    await signedIn({ ...CLASSIC, status: 'invalid' });
    const status = main().querySelector('.status')!;
    expect(status.textContent?.trim()).toBe(TOKEN_INVALID);
    expect(status.classList).toContain('bad');
    expect(text()).not.toContain(TOKEN_ACTIVE);
    expect(button('Replace token')).toBeDefined();
  });

  it('says why a token was not saved, and what to do (NFR-UX-06)', async () => {
    await signedIn(null);
    for (const [status, body, problem] of [
      [422, { error: 'not_a_token' }, 'not_a_token'],
      [422, { error: 'rejected' }, 'rejected'],
      [422, { error: 'other_account' }, 'other_account'],
      [429, null, 'too_many'],
      [502, null, 'github'],
      [503, null, 'failed'],
      [422, { error: 'odd' }, 'failed'],
    ] as const) {
      await enter('ghp_secret');
      http.expectOne('/-/api/token').flush(body, { status, statusText: 'Status' });
      await fixture.whenStable();
      expect(alert(), problem).toBe(saveProblemMessage(problem));
      expect(main().querySelector('#token-problem')!.getAttribute('role')).toBe('alert');
      expect(input()!.getAttribute('aria-invalid')).toBe('true');
      expect(input()!.getAttribute('aria-describedby')).toBe('token-problem');
      expect(button('Save token')!.hasAttribute('aria-disabled')).toBe(false);
      // Focus goes to the input to correct (NFR-UX-03).
      expect(document.activeElement).toBe(input());
    }
    expect(toasts()).toEqual([]);
    expect(session().token()).toBeNull();
  });

  it('forgets the last problem as it tries again', async () => {
    await signedIn(null);
    await enter('nope');
    http
      .expectOne('/-/api/token')
      .flush({ error: 'not_a_token' }, { status: 422, statusText: 'Unprocessable' });
    await fixture.whenStable();
    expect(alert()).toBe(saveProblemMessage('not_a_token'));
    await enter('ghp_secret');
    expect(alert()).toBeUndefined();
    expect(input()!.hasAttribute('aria-invalid')).toBe(false);
    http.expectOne('/-/api/token').flush(CLASSIC);
    await fixture.whenStable();
  });

  it('replaces a token, or leaves it be, with focus on what each shows (NFR-UX-03)', async () => {
    await signedIn(CLASSIC);
    expect(input()).toBeNull();
    await click('Replace token');
    expect(input()!.getAttribute('aria-label')).toBe('New personal access token');
    expect(document.activeElement).toBe(input());
    // What the token is stays in view meanwhile, without the buttons that change it.
    expect(details()).toHaveLength(5);
    expect(button('Replace token')).toBeUndefined();
    expect(button('Remove token')).toBeUndefined();

    input()!.value = 'github_pat_typed';
    input()!.dispatchEvent(new Event('input'));
    await click('Cancel');
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(button('Replace token'));

    // What was typed is forgotten.
    await click('Replace token');
    expect(input()!.value).toBe('');
    await enter('github_pat_new');
    http
      .expectOne({ method: 'PUT', url: '/-/api/token' })
      .flush({ ...CLASSIC, type: 'fine_grained', scopes: null, last_four: 'wxyz' });
    await fixture.whenStable();
    expect(Object.fromEntries(details())['Token']).toBe('••••••••wxyz');
    expect(Object.fromEntries(details())['Type']).toBe('Fine-grained');
    expect(input()).toBeNull();
    expect(toasts()).toEqual([SAVED]);
    expect(document.activeElement).toBe(button('Replace token'));
  });

  it('removes a token at once (FR-PAT-05)', async () => {
    await signedIn(CLASSIC);
    await click('Remove token');
    const request = http.expectOne('/-/api/token');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(toasts()).toEqual([REMOVED]);
    expect(details()).toEqual([]);
    expect(main().querySelector('.status')).toBeNull();
    expect(input()!.getAttribute('aria-label')).toBe('Personal access token');
    expect(document.activeElement).toBe(input());
    expect(session().token()).toBeNull();
  });

  it('says when a token could not be removed, with focus back on the button', async () => {
    await signedIn(CLASSIC);
    button('Remove token')!.focus();
    await click('Remove token');
    // Waiting for the server, the buttons keep focus, and do nothing more.
    expect(button('Remove token')!.getAttribute('aria-disabled')).toBe('true');
    expect(button('Replace token')!.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button('Remove token'));
    await click('Remove token');
    await click('Replace token');
    expect(input()).toBeNull();
    http.expectOne('/-/api/token').flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(alert()).toBe(REMOVE_FAILED);
    expect(toasts()).toEqual([]);
    expect(details()).toHaveLength(5);
    expect(button('Remove token')!.hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(button('Remove token'));
    expect(session().token()?.lastFour).toBe('abcd');
  });

  it('asks a user signed out meanwhile to sign in again', async () => {
    await signedIn(null);
    await enter('ghp_secret');
    http.expectOne('/-/api/token').flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(main().querySelector('h1')!.textContent?.trim()).toBe(SIGN_IN_TO_MANAGE);
    expect(input()).toBeNull();
  });
});
