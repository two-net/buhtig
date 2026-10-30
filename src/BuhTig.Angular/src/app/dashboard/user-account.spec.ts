import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { avatarOf } from '../avatar/avatar';
import { NO_USER_REPOSITORIES, OPEN_A_REPOSITORY, userAccount } from './messages';
import { UserAccount } from './user-account';

@Component({
  imports: [UserAccount],
  template: `<app-user-account [login]="login()" />`,
})
class Host {
  readonly login = signal('mona');
}

describe('UserAccount', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const heading = () => element().querySelector('h1')!.textContent?.trim();
  const text = () => element().querySelector('.center p')!.textContent?.trim();
  /** The repositories offered, as their chips' text and where they lead. */
  const chips = () =>
    [...element().querySelectorAll('a.chip')].map((chip) => [
      chip.textContent?.trim(),
      chip.getAttribute('href'),
    ]);

  async function answer(login: string, body: object | null, status = 200): Promise<void> {
    http
      .expectOne(`/-/api/users/${login}/repositories`)
      .flush(body, { status, statusText: `${status}` });
    await fixture.whenStable();
  }

  it("says that the name is a user's, and offers their repositories instead (FR-SRCH-06)", async () => {
    // What BuhTig offers in general, until it knows what it can offer.
    expect(heading()).toBe(userAccount('mona'));
    expect(userAccount('mona')).toBe('@mona is a user account');
    expect(text()).toBe(OPEN_A_REPOSITORY);
    expect(chips()).toEqual([]);

    await answer('mona', { repositories: [{ name: 'mona/dotfiles' }, { name: 'octo/fork' }] });
    expect(chips()).toEqual([
      ['mona/dotfiles', '/mona/dotfiles'],
      ['octo/fork', '/octo/fork'],
    ]);
    // Each with the user's avatar.
    expect(
      [...element().querySelectorAll('a.chip img')].map((image) => image.getAttribute('src')),
    ).toEqual([avatarOf('mona', 20), avatarOf('mona', 20)]);
    const again = element().querySelector('a.btn')!;
    expect([again.textContent?.trim(), again.getAttribute('href')]).toEqual(['Search again', '/']);
  });

  it('leaves out what names no repository', async () => {
    await answer('mona', {
      repositories: [
        { name: 'mona' },
        { name: '../evil' },
        { name: 'github.com/mona/x' },
        { name: 'mona/ok' },
      ],
    });
    expect(chips()).toEqual([['mona/ok', '/mona/ok']]);
  });

  it('says what to do instead when it has no repositories to offer', async () => {
    await answer('mona', { repositories: [] });
    expect(text()).toBe(NO_USER_REPOSITORIES);
    expect(chips()).toEqual([]);
  });

  it('says the same when the server cannot list them', async () => {
    await answer('mona', null, 503);
    expect(text()).toBe(NO_USER_REPOSITORIES);
  });

  it('asks about another user as the name changes, and forgets the first', async () => {
    const first = http.expectOne('/-/api/users/mona/repositories');
    fixture.componentInstance.login.set('octocat');
    await fixture.whenStable();
    expect(first.cancelled).toBe(true);
    expect(heading()).toBe(userAccount('octocat'));
    await answer('octocat', { repositories: [{ name: 'octocat/hello-world' }] });
    expect(chips()).toEqual([['octocat/hello-world', '/octocat/hello-world']]);
  });
});
