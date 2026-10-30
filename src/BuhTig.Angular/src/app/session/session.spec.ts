import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Session, Token, noticeSignOut, signInUrl, token } from './session';

describe('Session', () => {
  let http: HttpTestingController;
  let session: Session;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([noticeSignOut])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(Session);
  });

  afterEach(() => {
    http.verify();
  });

  const MONA = { login: 'mona', name: 'Mona Lisa', avatar_url: 'https://example.com/mona.png' };

  /** Makes a request that the server answers with `status`. */
  function answer(url: string, status: number) {
    TestBed.inject(HttpClient)
      .get(url)
      .subscribe({ error: () => undefined });
    http.expectOne(url).flush(null, { status, statusText: 'Status' });
  }

  it('knows who is viewing once the server says', () => {
    expect(session.user()).toBeUndefined();
    http.expectOne('/-/api/session').flush({ user: MONA });
    expect(session.user()).toEqual(MONA);
    expect(session.ended()).toBe(false);
  });

  it('takes a visitor for one when the server cannot tell (NFR-UX-01)', () => {
    http.expectOne('/-/api/session').flush(null, { status: 503, statusText: 'Unavailable' });
    expect(session.user()).toBeNull();
  });

  it("learns that the user was signed out from a 401 of BuhTig's own (FR-AUTH-09)", () => {
    http.expectOne('/-/api/session').flush({ user: MONA });
    answer('/-/api/repositories/owner/repo', 502);
    answer('https://example.com/elsewhere', 401);
    expect(session.user()).toEqual(MONA);

    answer('/-/api/repositories/owner/repo/stats', 401);
    expect(session.user()).toBeNull();
    expect(session.ended()).toBe(true);
  });

  it('tells a visitor of no sign-out', () => {
    http.expectOne('/-/api/session').flush({ user: null });
    answer('/-/api/shortcuts', 401);
    expect(session.user()).toBeNull();
    expect(session.ended()).toBe(false);
  });

  const CLASSIC = {
    type: 'classic',
    last_four: 'abcd',
    scopes: ['repo', 'read:org'],
    expires_at: '2026-11-25T12:00:00.000Z',
    status: 'valid',
    last_validated_at: '2026-10-26T09:30:00.000Z',
  };

  it("knows the user's token once the server says, but never the token itself (FR-PAT-04)", () => {
    expect(session.token()).toBeUndefined();
    http.expectOne('/-/api/session').flush({ user: MONA, token: CLASSIC });
    expect(session.token()).toEqual<Token>({
      type: 'classic',
      lastFour: 'abcd',
      scopes: ['repo', 'read:org'],
      expiresAt: new Date('2026-11-25T12:00:00Z'),
      status: 'valid',
      lastValidatedAt: new Date('2026-10-26T09:30:00Z'),
    });
  });

  it('knows of no token for a user without one, or a visitor', () => {
    http.expectOne('/-/api/session').flush({ user: MONA, token: null });
    expect(session.token()).toBeNull();
  });

  it('reads a fine-grained token, and one that GitHub no longer accepts (FR-PAT-07)', () => {
    http.expectOne('/-/api/session');
    expect(
      token({
        type: 'fine_grained',
        last_four: 'wxyz',
        scopes: null,
        expires_at: null,
        status: 'invalid',
        last_validated_at: 'not a time',
      }),
    ).toEqual<Token>({
      type: 'fine_grained',
      lastFour: 'wxyz',
      scopes: undefined,
      expiresAt: undefined,
      status: 'invalid',
      lastValidatedAt: undefined,
    });
    expect(token({ ...CLASSIC, scopes: ['repo', 7] })?.scopes).toEqual(['repo']);
    expect(token({ ...CLASSIC, status: 'odd' })?.status).toBe('invalid');
  });

  it('takes note of a token saved or removed in Settings', () => {
    http.expectOne('/-/api/session').flush({ user: MONA, token: null });
    const saved = token(CLASSIC)!;
    session.setToken(saved);
    expect(session.token()).toEqual(saved);
    session.setToken(null);
    expect(session.token()).toBeNull();
  });

  it('forgets the token of a user signed out while the page was open', () => {
    http.expectOne('/-/api/session').flush({ user: MONA, token: CLASSIC });
    session.end();
    expect(session.token()).toBeNull();
  });

  it('forgets a user who deleted their data, without saying that they were signed out (FR-PERS-04)', () => {
    http.expectOne('/-/api/session').flush({ user: MONA, token: CLASSIC });
    let done = false;
    session.deleteUser().subscribe(() => (done = true));
    expect(session.deleted()).toBe(false);
    const request = http.expectOne('/-/api/user');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(true);
    expect(session.deleted()).toBe(true);
    expect(session.user()).toBeNull();
    expect(session.token()).toBeNull();
    expect(session.ended()).toBe(false);
    // Nor later, when BuhTig's own requests meet a 401.
    answer('/-/api/shortcuts', 401);
    expect(session.ended()).toBe(false);
  });

  it('keeps the user signed in when their data could not be deleted', () => {
    http.expectOne('/-/api/session').flush({ user: MONA, token: null });
    session.deleteUser().subscribe({ error: () => undefined });
    http.expectOne('/-/api/user').flush(null, { status: 503, statusText: 'Unavailable' });
    expect(session.deleted()).toBe(false);
    expect(session.user()).toEqual(MONA);
  });

  it('knows when the user signed in on this browser, once the server says', () => {
    const since = { ...MONA, signed_in_at: '2026-10-20T08:15:00Z' };
    http.expectOne('/-/api/session').flush({ user: since, token: null });
    expect(session.user()?.signed_in_at).toBe('2026-10-20T08:15:00Z');
  });

  it('takes a user whom the server tells no sign-in time of as they are', () => {
    http.expectOne('/-/api/session').flush({ user: MONA });
    expect(session.user()?.signed_in_at).toBeUndefined();
  });

  it('starts sign-in with the page to return to (FR-AUTH-05)', () => {
    http.expectOne('/-/api/session');
    expect(signInUrl('/owner/repo?tab=x')).toBe(
      '/-/auth/sign-in?return_to=%2Fowner%2Frepo%3Ftab%3Dx',
    );
  });
});
