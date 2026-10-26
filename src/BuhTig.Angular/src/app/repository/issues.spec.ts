import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clock } from '../format/clock';
import { compactNumber, exactNumber, relativeTime } from '../format/format';
import { FAILED } from '../widget/messages';
import { RepositoryIssues } from './issues';
import { TURNED_OFF } from './messages';

@Component({
  imports: [RepositoryIssues],
  template: `<app-repository-issues [owner]="owner()" [repo]="repo()" />`,
})
class Host {
  readonly owner = signal('acme');
  readonly repo = signal('widget');
}

/** The issues and pull requests of `acme/widget`, as the server gives them. */
const WIDGET = {
  issues: { open: 12_345, closed: 120 },
  pull_requests: { open: 12, merged: 300, closed: 40 },
  recent: [
    {
      number: 50,
      title: 'Widgets wobble',
      kind: 'issue',
      state: 'open',
      author: 'alice',
      created_at: '2026-10-20T08:00:00Z',
      url: 'https://github.com/acme/widget/issues/50',
    },
    {
      number: 49,
      title: 'Steady the widgets',
      kind: 'pull_request',
      state: 'merged',
      author: 'bob',
      created_at: '2026-10-19T08:00:00Z',
      url: 'https://github.com/acme/widget/pull/49',
    },
    {
      number: 48,
      title: 'Paint the widgets',
      kind: 'pull_request',
      state: 'closed',
      author: 'carol',
      created_at: '2026-10-18T08:00:00Z',
      url: 'https://github.com/acme/widget/pull/48',
    },
    {
      number: 47,
      title: 'Widgets are too blue',
      kind: 'issue',
      state: 'closed',
      author: null,
      created_at: null,
      url: null,
    },
  ],
};

describe('RepositoryIssues', () => {
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
  const groups = () => [...element().querySelectorAll('dl > div')];
  /** Each kind's name, then its figures. */
  const counts = () => groups().map((group) => [...group.children].map(shown));
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
    http.expectOne('/-/api/repositories/acme/widget/issues').flush(body);
    await fixture.whenStable();
  }

  it('counts issues and pull requests by state (FR-REPO-06)', async () => {
    await answer(WIDGET);
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Issues & pull requests');
    expect(counts()).toEqual([
      ['Issues', `${compactNumber(12_345)} open`, '120 closed'],
      ['Pull requests', '12 open', '300 merged', '40 closed'],
    ]);
    expect(groups()[0].querySelector('[role="tooltip"]')?.textContent).toBe(exactNumber(12_345));
  });

  it('lists those updated last, with their state, number, age and author', async () => {
    await answer(WIDGET);
    expect(
      rows().map((row) => [
        row.querySelector('.title')?.textContent,
        shown(row.querySelector('.meta')!),
      ]),
    ).toEqual([
      ['Widgets wobble', `Open issue #50 opened ${ago('2026-10-20T08:00:00Z')} by alice`],
      [
        'Steady the widgets',
        `Merged pull request #49 opened ${ago('2026-10-19T08:00:00Z')} by bob`,
      ],
      [
        'Paint the widgets',
        `Closed pull request #48 opened ${ago('2026-10-18T08:00:00Z')} by carol`,
      ],
      // GitHub left out who opened it, and when.
      ['Widgets are too blue', 'Closed issue #47'],
    ]);
    // The state is in words, whatever its color (NFR-UX-05).
    expect(rows().map((row) => row.querySelector('.state')?.getAttribute('data-state'))).toEqual([
      'open',
      'merged',
      'closed',
      'closed',
    ]);
  });

  it('links each to its page on GitHub (FR-REPO-12), and only to web pages', async () => {
    await answer({
      ...WIDGET,
      recent: [...WIDGET.recent.slice(0, 2), { ...WIDGET.recent[2], url: 'javascript:alert(1)' }],
    });
    expect(rows().map((row) => row.querySelector('a.title')?.getAttribute('href'))).toEqual([
      'https://github.com/acme/widget/issues/50',
      'https://github.com/acme/widget/pull/49',
      undefined,
    ]);
    expect(rows()[2].querySelector('.title')?.textContent).toBe('Paint the widgets');
  });

  it('says which the repository has turned off, and lists the rest', async () => {
    await answer({ ...WIDGET, issues: null, recent: WIDGET.recent.slice(1, 2) });
    expect(counts()).toEqual([
      ['Issues', TURNED_OFF],
      ['Pull requests', '12 open', '300 merged', '40 closed'],
    ]);
    expect(rows()).toHaveLength(1);
  });

  it('says that both are turned off, rather than that there are none', async () => {
    await answer({ issues: null, pull_requests: null, recent: [] });
    expect(counts()).toEqual([
      ['Issues', TURNED_OFF],
      ['Pull requests', TURNED_OFF],
    ]);
  });

  it('says when there are none (FR-REPO-11)', async () => {
    await answer({
      issues: { open: 0, closed: 0 },
      pull_requests: { open: 0, merged: 0, closed: 0 },
      recent: [],
    });
    expect(message()).toBe('No issues or pull requests yet.');
    expect(element().querySelector('dl, ol, button')).toBeNull();
  });

  it('says when they failed to load, and tries again (FR-REPO-09)', async () => {
    http
      .expectOne('/-/api/repositories/acme/widget/issues')
      .flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    element().querySelector('button')!.click();
    await fixture.whenStable();
    await answer(WIDGET);
    expect(rows()).toHaveLength(4);
  });
});
