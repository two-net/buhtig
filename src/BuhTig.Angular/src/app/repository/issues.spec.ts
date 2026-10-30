import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { IssueOrPullRequest, IssuesAndPullRequests } from '../dashboard/resources';
import { Clock } from '../format/clock';
import { relativeTime } from '../format/format';
import { Icon } from '../icon/icon';
import { Load } from '../widget/load';
import { FAILED } from '../widget/messages';
import { IssueRows, RepositoryIssuesTab, RepositoryRecentIssues, stateSegments } from './issues';
import {
  ALL_ISSUES,
  ALL_PULL_REQUESTS,
  ISSUES_OFF,
  NOTHING_RECENT,
  NO_ISSUES,
  NO_ISSUES_OR_PULL_REQUESTS,
  NO_PULL_REQUESTS,
  PULL_REQUESTS_OFF,
  STATE_HEADERS,
} from './messages';

/** An issue or pull request, as GitHub says of it, but for what `item` says. */
const item = (item: Partial<IssueOrPullRequest>): IssueOrPullRequest => ({
  number: 1,
  title: 'Widgets wobble',
  kind: 'issue',
  state: 'open',
  author: undefined,
  createdAt: undefined,
  updatedAt: undefined,
  url: undefined,
  ...item,
});

/** The issues and pull requests of `acme/widget` that changed last, last first. */
const RECENT = [
  item({
    number: 50,
    title: 'Widgets wobble',
    author: 'alice',
    createdAt: new Date('2026-10-10T08:00:00Z'),
    updatedAt: new Date('2026-10-21T08:00:00Z'),
    url: 'https://github.com/acme/widget/issues/50',
  }),
  item({
    number: 49,
    title: 'Steady the widgets',
    kind: 'pull_request',
    state: 'merged',
    author: 'bob',
    createdAt: new Date('2026-10-19T08:00:00Z'),
    url: 'https://github.com/acme/widget/pull/49',
  }),
  item({ number: 48, title: 'Paint the widgets', kind: 'pull_request', state: 'closed' }),
  item({ number: 47, title: 'Widgets are too blue', state: 'closed' }),
  item({ number: 46, title: 'Polish the widgets', kind: 'pull_request' }),
];

const ISSUES: IssuesAndPullRequests = {
  issues: { open: 12_345, closed: 4 },
  pullRequests: { open: 3, merged: 5, closed: 1 },
  recent: RECENT,
};

describe('IssueRows', () => {
  const now = new Date('2026-10-22T12:00:00Z').getTime();
  let fixture: ComponentFixture<IssueRows>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: Clock, useValue: { now: signal(now) } }],
    });
    fixture = TestBed.createComponent(IssueRows);
    fixture.componentRef.setInput('items', RECENT.slice(0, 4));
    await fixture.whenStable();
  });

  const rows = () => [...fixture.nativeElement.querySelectorAll('li')] as HTMLElement[];

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  it('marks each with an icon of its kind and state, in words too (FR-REPO-06, NFR-UX-05)', () => {
    const icons = fixture.debugElement
      .queryAll(By.css('.lead'))
      .map((lead) => lead.query(By.directive(Icon)).componentInstance.name());
    expect(icons).toEqual(['issue', 'merged', 'closed', 'issue-closed']);
    expect(rows().map((row) => row.querySelector('.lead .sr')?.textContent)).toEqual([
      'Issue, open',
      'Pull request, merged',
      'Pull request, closed',
      'Issue, closed',
    ]);
    expect(rows().map((row) => row.querySelector('.lead')?.getAttribute('title'))).toEqual([
      'Issue, open',
      'Pull request, merged',
      'Pull request, closed',
      'Issue, closed',
    ]);
    // A closed issue is done, as a merged pull request is.
    expect(rows().map((row) => row.querySelector('.lead')?.className)).toEqual([
      'lead st-open',
      'lead st-merged',
      'lead st-closed',
      'lead st-done',
    ]);
  });

  it('marks an open pull request apart from an open issue', async () => {
    fixture.componentRef.setInput('items', [RECENT[4]]);
    await fixture.whenStable();
    expect(fixture.debugElement.query(By.directive(Icon)).componentInstance.name()).toBe('pr');
  });

  it('says its number, when it last changed, and who opened it', () => {
    expect(rows().map((row) => shown(row.querySelector('.m')!))).toEqual([
      `#50 updated ${relativeTime(RECENT[0].updatedAt!, now)} by alice`,
      // When it was opened, when GitHub says no more.
      `#49 updated ${relativeTime(RECENT[1].createdAt!, now)} by bob`,
      '#48',
      '#47',
    ]);
  });

  it('links each title to its page on GitHub, when GitHub says where (FR-REPO-12)', () => {
    expect(
      rows().map((row) => [
        row.querySelector('.ttl')?.textContent,
        row.querySelector('a.ttl')?.getAttribute('href'),
      ]),
    ).toEqual([
      ['Widgets wobble', 'https://github.com/acme/widget/issues/50'],
      ['Steady the widgets', 'https://github.com/acme/widget/pull/49'],
      ['Paint the widgets', undefined],
      ['Widgets are too blue', undefined],
    ]);
  });
});

/** Provides the issues and pull requests of `acme/widget`, in the state that `issues` holds. */
function provideIssues(
  issues: ReturnType<typeof signal<Load<IssuesAndPullRequests>>>,
  retry = () => {},
) {
  return [
    provideRouter([]),
    {
      provide: RepositoryData,
      useValue: { name: signal('acme/widget'), issues: () => ({ state: issues, retry }) },
    },
  ];
}

describe('RepositoryRecentIssues', () => {
  const issues = signal<Load<IssuesAndPullRequests>>({ status: 'loading' });
  let fixture: ComponentFixture<RepositoryRecentIssues>;

  beforeEach(async () => {
    issues.set({ status: 'loading' });
    TestBed.configureTestingModule({ providers: provideIssues(issues) });
    fixture = TestBed.createComponent(RepositoryRecentIssues);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;

  it('lists the 6 that changed last, and links to the Issues and Pull requests tabs', async () => {
    issues.set({
      status: 'ready',
      data: {
        ...ISSUES,
        recent: [...RECENT, ...RECENT].map((item, index) => ({ ...item, number: index })),
      },
    });
    await fixture.whenStable();
    expect(element().querySelector('h2')?.textContent?.trim()).toBe(
      'Recent issues and pull requests',
    );
    expect(element().querySelectorAll('app-issue-rows li')).toHaveLength(6);
    expect(
      [...element().querySelectorAll('.Box-footer a')].map((link) => [
        link.textContent,
        link.getAttribute('href'),
      ]),
    ).toEqual([
      [ALL_ISSUES, '/acme/widget/issues'],
      [ALL_PULL_REQUESTS, '/acme/widget/pulls'],
    ]);
  });

  it('says when there are none (FR-REPO-11)', async () => {
    issues.set({ status: 'ready', data: { ...ISSUES, recent: [] } });
    await fixture.whenStable();
    expect(element().querySelector('.w-state span')?.textContent).toBe(NO_ISSUES_OR_PULL_REQUESTS);
    expect(element().querySelector('app-issue-rows, .Box-footer')).toBeNull();
  });
});

@Component({
  imports: [RepositoryIssuesTab],
  template: `<app-repository-issues-tab [kind]="kind()" />`,
})
class Host {
  readonly kind = signal<IssueOrPullRequest['kind']>('issue');
}

describe('RepositoryIssuesTab', () => {
  const issues = signal<Load<IssuesAndPullRequests>>({ status: 'loading' });
  const retry = vi.fn();
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    issues.set({ status: 'loading' });
    retry.mockClear();
    TestBed.configureTestingModule({ providers: provideIssues(issues, retry) });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const heading = () => element().querySelector('h2')?.textContent?.trim();
  const counts = () =>
    [...element().querySelectorAll('.list-tabs li')].map((count) => [
      count.textContent?.replace(/\s+/g, ' ').trim(),
      count.classList.contains('on'),
    ]);
  const titles = () =>
    [...element().querySelectorAll('app-issue-rows .ttl')].map((title) => title.textContent);
  const bar = () => element().querySelector('app-split-bar .stack');
  const message = () => element().querySelector('.w-state span')?.textContent;

  async function show(
    kind: IssueOrPullRequest['kind'],
    data: IssuesAndPullRequests,
  ): Promise<void> {
    fixture.componentInstance.kind.set(kind);
    issues.set({ status: 'ready', data });
    await fixture.whenStable();
  }

  it('counts issues by state, and lists the issues that changed last (FR-REPO-06)', async () => {
    expect(heading()).toBe('Issues');
    expect(element().querySelector('.skel-row')).not.toBeNull();
    await show('issue', ISSUES);
    expect(counts()).toEqual([
      ['12,345 Open', true],
      ['4 Closed', false],
    ]);
    expect(bar()?.getAttribute('aria-label')).toBe('12,345 open, 4 closed.');
    expect(titles()).toEqual(['Widgets wobble', 'Widgets are too blue']);
  });

  it('counts pull requests as open, merged and closed without merging', async () => {
    await show('pull_request', ISSUES);
    expect(heading()).toBe('Pull requests');
    expect(counts()).toEqual([
      ['3 Open', true],
      ['5 Merged', false],
      ['1 Closed', false],
    ]);
    expect(bar()?.getAttribute('aria-label')).toBe('3 open, 5 merged, 1 closed.');
    expect(titles()).toEqual(['Steady the widgets', 'Paint the widgets', 'Polish the widgets']);
  });

  it('shows the counts as a table on request (NFR-UX-04)', async () => {
    await show('pull_request', ISSUES);
    element().querySelector<HTMLButtonElement>('.w-head button')!.click();
    await fixture.whenStable();
    expect(
      [...element().querySelectorAll('tr')].map((row) =>
        [...row.children].map((cell) => cell.textContent?.trim()),
      ),
    ).toEqual([[...STATE_HEADERS], ['Open', '3'], ['Merged', '5'], ['Closed', '1']]);
  });

  it('says when the repository has turned them off, and still lists those it has', async () => {
    await show('issue', { ...ISSUES, issues: undefined });
    expect(element().querySelector('.pad p')?.textContent).toBe(ISSUES_OFF);
    expect(element().querySelector('.list-tabs, app-split-bar, .w-head button')).toBeNull();
    expect(titles()).toEqual(['Widgets wobble', 'Widgets are too blue']);

    await show('pull_request', { ...ISSUES, pullRequests: undefined, recent: [] });
    expect(element().querySelector('.pad p')?.textContent).toBe(PULL_REQUESTS_OFF);
    expect(element().querySelector('p.pad')?.textContent).toBe(NOTHING_RECENT);
  });

  it('says when none of those that changed last are of its kind', async () => {
    await show('pull_request', { ...ISSUES, recent: [RECENT[0]] });
    expect(counts()).toHaveLength(3);
    expect(element().querySelector('app-issue-rows')).toBeNull();
    expect(element().querySelector('p.pad')?.textContent).toBe(NOTHING_RECENT);
  });

  it('says when there are none (FR-REPO-11)', async () => {
    const none = {
      issues: { open: 0, closed: 0 },
      pullRequests: { open: 0, merged: 0, closed: 0 },
      recent: [RECENT[1]],
    };
    await show('issue', none);
    expect(message()).toBe(NO_ISSUES);
    // There is a pull request, but no issue.
    await show('pull_request', { ...none, recent: [] });
    expect(message()).toBe(NO_PULL_REQUESTS);
  });

  it('says when they failed to load, and tries again (FR-REPO-09)', async () => {
    issues.set({ status: 'error', failure: 'github' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    element().querySelector('button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('stateSegments', () => {
  it('splits issues into open and closed, and pull requests into open, merged and closed', () => {
    expect(stateSegments(ISSUES, 'issue')).toEqual([
      { label: 'Open', value: 12_345, color: 'var(--st-open)' },
      { label: 'Closed', value: 4, color: 'var(--st-merged)' },
    ]);
    expect(stateSegments(ISSUES, 'pull_request')).toEqual([
      { label: 'Open', value: 3, color: 'var(--st-open)' },
      { label: 'Merged', value: 5, color: 'var(--st-merged)' },
      { label: 'Closed', value: 1, color: 'var(--st-closed)' },
    ]);
  });

  it('has none of what the repository has turned off', () => {
    const off = { issues: undefined, pullRequests: undefined, recent: [] };
    expect(stateSegments(off, 'issue')).toBeUndefined();
    expect(stateSegments(off, 'pull_request')).toBeUndefined();
  });
});
