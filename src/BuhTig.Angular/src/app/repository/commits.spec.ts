import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clock } from '../format/clock';
import { exactTime, relativeTime } from '../format/format';
import { FAILED } from '../widget/messages';
import { RepositoryCommits } from './commits';
import { NO_MESSAGE } from './messages';

@Component({
  imports: [RepositoryCommits],
  template: `<app-repository-commits [owner]="owner()" [repo]="repo()" />`,
})
class Host {
  readonly owner = signal('acme');
  readonly repo = signal('widget');
}

/** The latest commits of `acme/widget`, as the server gives them. */
const WIDGET = {
  commits: [
    {
      sha: 'a1b2c3d',
      message: 'Steady the widgets (#49)',
      author: 'alice',
      committed_at: '2026-10-21T08:00:00Z',
      url: 'https://github.com/acme/widget/commit/a1b2c3d',
    },
    {
      sha: 'b2c3d4e',
      message: 'Fix a typo',
      author: 'Bob Example',
      committed_at: '2026-10-18T08:00:00Z',
      url: 'https://github.com/acme/widget/commit/b2c3d4e',
    },
  ],
};

describe('RepositoryCommits', () => {
  const now = new Date('2026-10-22T12:00:00Z').getTime();
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(now) } },
      ],
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
  const ago = (time: string) => relativeTime(new Date(time), now);

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  async function answer(body: object): Promise<void> {
    http.expectOne('/-/api/repositories/acme/widget/commits').flush(body);
    await fixture.whenStable();
  }

  it('lists the latest commits with their message, author and age (FR-REPO-07)', async () => {
    await answer(WIDGET);
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Recent commits');
    expect(
      rows().map((row) => [
        shown(row.querySelector('.subject')!),
        shown(row.querySelector('.meta')!),
      ]),
    ).toEqual([
      ['Steady the widgets (#49)', `alice committed ${ago('2026-10-21T08:00:00Z')}`],
      ['Fix a typo', `Bob Example committed ${ago('2026-10-18T08:00:00Z')}`],
    ]);
    expect(rows()[0].querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-10-21T08:00:00.000Z',
    );
    expect(rows()[0].querySelector('[role="tooltip"]')?.textContent).toBe(
      exactTime(new Date('2026-10-21T08:00:00Z')),
    );
  });

  it("links each message to the commit's page on GitHub (FR-REPO-12)", async () => {
    await answer(WIDGET);
    expect(rows().map((row) => row.querySelector('a.subject')?.getAttribute('href'))).toEqual([
      'https://github.com/acme/widget/commit/a1b2c3d',
      'https://github.com/acme/widget/commit/b2c3d4e',
    ]);
  });

  it('links only to web pages, and says when a commit has no message', async () => {
    await answer({
      commits: [
        { sha: 'c3d4e5f', message: null, author: null, committed_at: null, url: 'javascript:x' },
      ],
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('a')).toBeNull();
    expect(rows()[0].querySelector('.subject')?.textContent?.trim()).toBe(NO_MESSAGE);
    expect(shown(rows()[0].querySelector('.meta')!)).toBe('');
  });

  it('says when there are no commits (FR-REPO-11)', async () => {
    await answer({ commits: [] });
    expect(message()).toBe('No commits yet.');
    expect(element().querySelector('ol, button')).toBeNull();
  });

  it('says when they failed to load, and tries again (FR-REPO-09)', async () => {
    http
      .expectOne('/-/api/repositories/acme/widget/commits')
      .flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    element().querySelector('button')!.click();
    await fixture.whenStable();
    await answer(WIDGET);
    expect(rows()).toHaveLength(2);
  });
});
