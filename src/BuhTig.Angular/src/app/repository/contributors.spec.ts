import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { compactNumber, exactNumber } from '../format/format';
import { FAILED } from '../widget/messages';
import { RepositoryContributors } from './contributors';
import { TOO_MANY_CONTRIBUTORS } from './messages';

@Component({
  imports: [RepositoryContributors],
  template: `<app-repository-contributors [owner]="owner()" [repo]="repo()" />`,
})
class Host {
  readonly owner = signal('acme');
  readonly repo = signal('widget');
}

/** The top contributors of `acme/widget`, as the server gives them. */
const WIDGET = {
  contributors: [
    {
      login: 'alice',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      url: 'https://github.com/alice',
      commits: 12_345,
    },
    {
      login: 'dependabot[bot]',
      avatar_url: 'https://avatars.githubusercontent.com/in/29110?v=4',
      url: 'https://github.com/apps/dependabot',
      commits: 1,
    },
  ],
  too_large: false,
};

describe('RepositoryContributors', () => {
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

  const element = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...element().querySelectorAll('ol > li')];
  const message = () => element().querySelector('.message')?.textContent?.trim();

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  async function answer(body: object): Promise<void> {
    http.expectOne('/-/api/repositories/acme/widget/contributors').flush(body);
    await fixture.whenStable();
  }

  it('lists the top contributors with their avatars and commits (FR-REPO-05)', async () => {
    await answer(WIDGET);
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Top contributors');
    expect(
      rows().map((row) => [
        row.querySelector('.login')?.textContent,
        shown(row.querySelector('.commits')!),
      ]),
    ).toEqual([
      ['alice', `${compactNumber(12_345)} commits`],
      ['dependabot[bot]', '1 commit'],
    ]);
    const avatar = rows()[0].querySelector('img')!;
    expect(avatar.getAttribute('src')).toBe(WIDGET.contributors[0].avatar_url);
    // The login beside it says who it is.
    expect(avatar.getAttribute('alt')).toBe('');
    expect(rows()[0].querySelector('[role="tooltip"]')?.textContent).toBe(exactNumber(12_345));
  });

  it("links each login to the contributor's page on GitHub (FR-REPO-12)", async () => {
    await answer(WIDGET);
    expect(rows().map((row) => row.querySelector('a.login')?.getAttribute('href'))).toEqual([
      'https://github.com/alice',
      'https://github.com/apps/dependabot',
    ]);
  });

  it('links only to web pages, and shows avatars only from https URLs', async () => {
    await answer({
      contributors: [
        {
          login: 'mallory',
          avatar_url: 'http://avatars.example/u/3',
          url: 'javascript:alert(1)',
          commits: 7,
        },
      ],
      too_large: false,
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('a, img')).toBeNull();
    expect(rows()[0].querySelector('.login')?.textContent).toBe('mallory');
  });

  it('says when GitHub does not list the contributors, without "Try again"', async () => {
    await answer({ contributors: [], too_large: true });
    expect(message()).toBe(TOO_MANY_CONTRIBUTORS);
    expect(element().querySelector('ol, button')).toBeNull();
  });

  it('says when there are no contributors (FR-REPO-11)', async () => {
    await answer({ contributors: [], too_large: false });
    expect(message()).toBe('No contributors yet.');
    expect(element().querySelector('ol, button')).toBeNull();
  });

  it('says when they failed to load, and tries again (FR-REPO-09)', async () => {
    http
      .expectOne('/-/api/repositories/acme/widget/contributors')
      .flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    element().querySelector('button')!.click();
    await fixture.whenStable();
    await answer(WIDGET);
    expect(rows()).toHaveLength(2);
  });
});
