import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Session, noticeSignOut, signInUrl } from './session';

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

  it('starts sign-in with the page to return to (FR-AUTH-05)', () => {
    http.expectOne('/-/api/session');
    expect(signInUrl('/owner/repo?tab=x')).toBe(
      '/-/auth/sign-in?return_to=%2Fowner%2Frepo%3Ftab%3Dx',
    );
  });
});
