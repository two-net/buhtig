import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Session, noticeSignOut } from '../session/session';
import {
  NEVER_EXPIRES,
  PERMISSIONS_UNKNOWN,
  REMOVED,
  REMOVE_FAILED,
  SAVED,
  SIGN_IN_FIRST,
  TOKEN_ADVICE,
  TOKEN_INVALID,
  TOKEN_PURPOSE,
  saveProblemMessage,
} from './messages';
import { Settings } from './settings';

describe('Settings', () => {
  let fixture: ComponentFixture<Settings>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        provideRouter([{ path: '-/settings', children: [] }]),
        provideHttpClient(withInterceptors([noticeSignOut])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Settings);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const MONA = { login: 'mona', name: 'Mona Lisa', avatar_url: 'https://example.com/mona.png' };
  const CLASSIC = {
    type: 'classic',
    last_four: 'abcd',
    scopes: ['repo', 'read:org'],
    expires_at: null,
    status: 'valid',
    last_validated_at: new Date().toISOString(),
  };

  const page = () => fixture.nativeElement as HTMLElement;
  const main = () => page().querySelector('main')!;
  const text = () => main().textContent!.replace(/\s+/g, ' ');
  const input = () => main().querySelector<HTMLInputElement>('input');
  const button = (label: string) =>
    [...main().querySelectorAll('button')].find((button) => button.textContent?.trim() === label);
  /** Each detail of the token, as its name and what it shows, without hover's tooltips. */
  const details = () =>
    [...main().querySelectorAll('dt')].map((term) => {
      const detail = term.nextElementSibling!.cloneNode(true) as Element;
      detail.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
      return [term.textContent?.trim(), detail.textContent?.replace(/\s+/g, ' ').trim()];
    });
  const status = () => main().querySelector('[role="status"]')?.textContent?.trim();
  const alert = () => main().querySelector('[role="alert"]')?.textContent?.trim();

  async function signedIn(token: object | null): Promise<void> {
    http.expectOne('/-/api/session').flush({ user: MONA, token });
    await fixture.whenStable();
  }

  /** Types `value` into the token input, and saves it. */
  async function enter(value: string): Promise<void> {
    input()!.value = value;
    input()!.dispatchEvent(new Event('input'));
    main()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  }

  it('asks a visitor to sign in, and to come back here (FR-ACC-02)', async () => {
    http.expectOne('/-/api/session').flush({ user: null });
    await fixture.whenStable();
    expect(text()).toContain(SIGN_IN_FIRST);
    expect(main().querySelector('a')!.getAttribute('href')).toBe(
      '/-/auth/sign-in?return_to=%2F-%2Fsettings',
    );
    expect(input()).toBeNull();
  });

  it('says what a token is for, and which to create (FR-PAT-09)', async () => {
    await signedIn(null);
    expect(text()).toContain(TOKEN_PURPOSE);
    expect(text()).toContain(TOKEN_ADVICE);
    const links = [...main().querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(links).toEqual([
      'https://github.com/settings/personal-access-tokens/new',
      'https://github.com/settings/tokens',
    ]);
    // A field for a secret, which the browser neither shows nor offers to fill in.
    expect(input()!.type).toBe('password');
    expect(input()!.getAttribute('autocomplete')).toBe('off');
    expect(main().querySelector('label')!.textContent?.trim()).toBe('Token');
  });

  it('saves a token, and shows only what BuhTig may show of it (FR-PAT-04)', async () => {
    await signedIn(null);
    await enter('ghp_secret');
    const request = http.expectOne('/-/api/token');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ token: 'ghp_secret' });
    expect(button('Save token')!.disabled).toBe(true);
    request.flush(CLASSIC);
    await fixture.whenStable();

    expect(status()).toBe(SAVED);
    expect(details()).toEqual([
      ['Type', 'Classic'],
      ['Ends in', '…abcd'],
      ['Scopes', 'repo, read:org'],
      ['Expires', NEVER_EXPIRES],
      ['Last checked with GitHub', 'now'],
    ]);
    expect(page().textContent).not.toContain('ghp_secret');
    expect(input()).toBeNull();
    expect(TestBed.inject(Session).token()?.lastFour).toBe('abcd');
  });

  it("shows a fine-grained token's expiry, and that GitHub does not report its permissions", async () => {
    await signedIn({
      ...CLASSIC,
      type: 'fine_grained',
      scopes: null,
      expires_at: '2026-11-25T12:00:00.000Z',
    });
    const shown = Object.fromEntries(details());
    expect(shown['Type']).toBe('Fine-grained');
    expect(shown['Permissions']).toBe(PERMISSIONS_UNKNOWN);
    expect(shown['Expires']).toMatch(/2026/);
    expect(shown['Scopes']).toBeUndefined();
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
      expect(input()!.getAttribute('aria-invalid')).toBe('true');
      expect(input()!.getAttribute('aria-describedby')).toBe('token-problem');
      expect(button('Save token')!.disabled).toBe(false);
    }
    expect(TestBed.inject(Session).token()).toBeNull();
  });

  it('replaces a token, or leaves it be', async () => {
    await signedIn(CLASSIC);
    expect(input()).toBeNull();
    button('Replace token')!.click();
    await fixture.whenStable();
    expect(main().querySelector('label')!.textContent?.trim()).toBe('New token');
    button('Cancel')!.click();
    await fixture.whenStable();
    expect(input()).toBeNull();

    button('Replace token')!.click();
    await fixture.whenStable();
    await enter('github_pat_new');
    http.expectOne('/-/api/token').flush({ ...CLASSIC, type: 'fine_grained', last_four: 'wxyz' });
    await fixture.whenStable();
    expect(Object.fromEntries(details())['Ends in']).toBe('…wxyz');
    expect(input()).toBeNull();
  });

  it('removes a token at once (FR-PAT-05)', async () => {
    await signedIn(CLASSIC);
    button('Remove token')!.click();
    const request = http.expectOne('/-/api/token');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(status()).toBe(REMOVED);
    expect(details()).toEqual([]);
    expect(input()).not.toBeNull();
    expect(TestBed.inject(Session).token()).toBeNull();
  });

  it('says when a token could not be removed', async () => {
    await signedIn(CLASSIC);
    button('Remove token')!.click();
    http.expectOne('/-/api/token').flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(alert()).toBe(REMOVE_FAILED);
    expect(details().length).toBe(5);
  });

  it('asks to replace a token that GitHub no longer accepts (FR-PAT-07)', async () => {
    await TestBed.inject(Router).navigateByUrl('/-/settings');
    await signedIn({ ...CLASSIC, status: 'invalid' });
    expect(text()).toContain(TOKEN_INVALID);
    // Settings says so itself, so the account corner need not.
    expect(page().querySelector('app-account .note')).toBeNull();
  });

  it('asks a user signed out meanwhile to sign in again', async () => {
    await signedIn(null);
    await enter('ghp_secret');
    http.expectOne('/-/api/token').flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(text()).toContain(SIGN_IN_FIRST);
  });
});
