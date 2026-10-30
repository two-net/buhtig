import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  ADD_TOKEN,
  NOT_FOUND_OR_PRIVATE,
  NO_SUCH_NAME,
  REPLACE_TOKEN,
  SEARCH_AGAIN,
  SIGN_IN_WITH_GITHUB,
  TOKEN_SETTINGS,
  invalidName,
  notFoundForSignedIn,
  notFoundForVisitor,
  notFoundWithInvalidToken,
  notFoundWithToken,
} from './messages';
import { NotFoundOrPrivate } from './not-found-or-private';

@Component({ template: '' })
class Blank {}

@Component({
  imports: [NotFoundOrPrivate],
  template: `<app-not-found-or-private [name]="name()" [kind]="kind()" [invalid]="invalid()" />`,
})
class Host {
  readonly name = signal('owner/secret');
  readonly kind = signal('repository');
  readonly invalid = signal(false);
}

describe('NotFoundOrPrivate', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    await TestBed.inject(Router).navigateByUrl('/owner/secret/issues');
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.match('/-/api/session');
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  /** Its heading, what it says, and what the viewer can do, each where it leads. */
  const page = () => [
    element().querySelector('h1')?.textContent,
    element().querySelector('p')?.textContent,
    [...element().querySelectorAll('.row a')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]),
  ];

  /** Answers who is viewing, as `session` describes them. */
  async function viewer(session: object): Promise<void> {
    http.expectOne('/-/api/session').flush(session);
    await fixture.whenStable();
  }

  const MONA = { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' };
  const token = (status: string) => ({
    type: 'fine_grained',
    last_four: 'abcd',
    scopes: null,
    expires_at: null,
    status,
    last_validated_at: null,
  });

  it('says nothing until it knows who is viewing', () => {
    expect(element().querySelector('h1')).toBeNull();
  });

  it('asks a visitor to sign in, and come back (FR-ACC-05)', async () => {
    await viewer({ user: null });
    expect(page()).toEqual([
      NOT_FOUND_OR_PRIVATE,
      notFoundForVisitor('repository', 'owner/secret'),
      [
        [SIGN_IN_WITH_GITHUB, '/-/auth/sign-in?return_to=%2Fowner%2Fsecret%2Fissues'],
        [SEARCH_AGAIN, '/'],
      ],
    ]);
  });

  it('asks a signed-in user to add a token', async () => {
    await viewer({ user: MONA, token: null });
    expect(page()).toEqual([
      NOT_FOUND_OR_PRIVATE,
      notFoundForSignedIn('repository', 'owner/secret'),
      [
        [ADD_TOKEN, '/-/settings'],
        [SEARCH_AGAIN, '/'],
      ],
    ]);
  });

  it('asks a signed-in user whose token no longer works to replace it', async () => {
    await viewer({ user: MONA, token: token('invalid') });
    expect(page()).toEqual([
      NOT_FOUND_OR_PRIVATE,
      notFoundWithInvalidToken('repository', 'owner/secret'),
      [
        [REPLACE_TOKEN, '/-/settings'],
        [SEARCH_AGAIN, '/'],
      ],
    ]);
  });

  it("tells a token user that their token can't read it, if it exists", async () => {
    await viewer({ user: MONA, token: token('valid') });
    expect(page()).toEqual([
      NOT_FOUND_OR_PRIVATE,
      notFoundWithToken('owner/secret'),
      [
        [TOKEN_SETTINGS, '/-/settings'],
        [SEARCH_AGAIN, '/'],
      ],
    ]);
  });

  it('names what kind of resource it is', async () => {
    fixture.componentInstance.name.set('acme');
    fixture.componentInstance.kind.set('organization');
    await viewer({ user: null });
    expect(page()[1]).toBe(notFoundForVisitor('organization', 'acme'));
  });

  it('says so of a name that cannot be one, which signing in would not help (NFR-UX-06)', async () => {
    fixture.componentInstance.name.set('foo/bar_');
    fixture.componentInstance.invalid.set(true);
    await fixture.whenStable();
    // Whoever is viewing.
    expect(page()).toEqual([NO_SUCH_NAME, invalidName('foo/bar_'), [[SEARCH_AGAIN, '/']]]);
    await viewer({ user: MONA, token: null });
    expect(page()).toEqual([NO_SUCH_NAME, invalidName('foo/bar_'), [[SEARCH_AGAIN, '/']]]);
  });
});
