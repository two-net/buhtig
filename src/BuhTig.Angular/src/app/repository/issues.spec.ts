import { Location } from '@angular/common';
import { Component, Signal, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NavigationEnd, Router, Routes, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom } from 'rxjs';
import type { Mock } from 'vitest';
import { RepositoryData } from '../dashboard/data';
import {
  IssueOrPullRequest,
  IssuePage,
  IssuesAndPullRequests,
  Labels,
} from '../dashboard/resources';
import { Clock } from '../format/clock';
import { relativeTime } from '../format/format';
import { Icon } from '../icon/icon';
import { Load } from '../widget/load';
import { FAILED } from '../widget/messages';
import { IssueKind, IssueView } from './issue-query';
import { IssueRows, RepositoryIssuesTab, RepositoryRecentIssues, stateSegments } from './issues';
import {
  ALL_ISSUES,
  ALL_PULL_REQUESTS,
  CAPPED,
  INCOMPLETE,
  ISSUES_OFF,
  NO_ISSUES,
  NO_ISSUES_OR_PULL_REQUESTS,
  NO_PULL_REQUESTS,
  PULL_REQUESTS_OFF,
  STATE_HEADERS,
  listedIssues,
  noIssuesMatch,
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

  it('says when each was opened instead, when they are in the order they were opened', async () => {
    fixture.componentRef.setInput('dated', 'created');
    await fixture.whenStable();
    expect(rows().map((row) => shown(row.querySelector('.m')!))).toEqual([
      `#50 opened ${relativeTime(RECENT[0].createdAt!, now)} by alice`,
      `#49 opened ${relativeTime(RECENT[1].createdAt!, now)} by bob`,
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

@Component({ selector: 'app-blank', template: '' })
class Blank {}

@Component({
  imports: [RepositoryIssuesTab],
  template: '<app-repository-issues-tab kind="issue" />',
})
class IssuesPage {}

@Component({
  imports: [RepositoryIssuesTab],
  template: '<app-repository-issues-tab kind="pull_request" />',
})
class PullsPage {}

/** The tabs, at their paths, and a page elsewhere. */
const ROUTES: Routes = [
  { path: 'acme/widget/issues', component: IssuesPage },
  { path: 'acme/widget/pulls', component: PullsPage },
  { path: 'blank', component: Blank },
];

/**
 * The page of `total` issues or pull requests of `kind` that `view` shows, as the server gives
 * it, numbered down from `total`, each in the state the view shows, or open for all of them.
 */
function pageOf(
  kind: IssueKind,
  view: IssueView,
  total: number,
  details: Partial<IssuePage> = {},
): IssuePage {
  const start = view.page * 25;
  const items = Array.from({ length: Math.max(0, Math.min(25, total - start)) }, (_, i) => {
    const number = total - start - i;
    return item({
      number,
      title: `Widgets ${number}`,
      kind,
      state: view.state === 'all' ? 'open' : view.state,
      createdAt: new Date('2026-10-01T08:00:00Z'),
      updatedAt: new Date('2026-10-21T08:00:00Z'),
    });
  });
  return {
    view,
    items,
    total,
    page: view.page,
    pages: Math.max(1, Math.ceil(Math.min(total, 1000) / 25)),
    capped: total > 1000,
    incomplete: false,
    off: false,
    ...details,
  };
}

describe('RepositoryIssuesTab', () => {
  const scrolling = Element.prototype.scrollIntoView;
  let harness: RouterTestingHarness;
  let issues: ReturnType<typeof signal<Load<IssuesAndPullRequests>>>;
  let labels: ReturnType<typeof signal<Load<Labels>>>;
  /** How the server answers for each view of each list, as a load. */
  let server: ReturnType<typeof signal<(kind: IssueKind, view: IssueView) => Load<IssuePage>>>;
  /** The views of the lists asked for, in order. */
  let asked: [IssueKind, IssueView][];
  let retry: Mock<() => void>;
  let figures: Mock<() => unknown>;

  beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn();
    issues = signal<Load<IssuesAndPullRequests>>({ status: 'ready', data: ISSUES });
    labels = signal<Load<Labels>>({
      status: 'ready',
      data: { names: ['bug', 'docs'], truncated: false },
    });
    server = signal((kind: IssueKind, view: IssueView) => ({
      status: 'ready',
      data: pageOf(kind, view, 30),
    }));
    asked = [];
    retry = vi.fn();
    figures = vi.fn(() => ({ state: signal({ status: 'loading' }), retry: () => {} }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter(ROUTES),
        {
          provide: RepositoryData,
          useValue: {
            name: signal('acme/widget'),
            issues: () => ({ state: issues, retry: () => {} }),
            labels: () => ({ state: labels, retry: () => {} }),
            // The figures above the tab's list, which load apart, and are tested apart.
            mergeVelocity: figures,
            issueAge: figures,
            issueList: (kind: Signal<IssueKind>, view: Signal<IssueView>) => ({
              state: computed(() => {
                asked.push([kind(), view()]);
                return server()(kind(), view());
              }),
              retry,
            }),
          },
        },
      ],
    });
    harness = await RouterTestingHarness.create('/acme/widget/issues');
    await harness.fixture.whenStable();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = scrolling;
  });

  const router = () => TestBed.inject(Router);
  /** The URL's query, whatever its order. */
  const query = () => Object.fromEntries(new URLSearchParams(router().url.split('?')[1] ?? ''));
  const element = () => harness.routeNativeElement!;
  /** The heading of each widget, the figures', the counts' and the list's. */
  const headings = () =>
    [...element().querySelectorAll('app-widget h2')].map((heading) => heading.textContent?.trim());
  const list = () => element().querySelector('.issue-list');
  const counts = () =>
    [...element().querySelectorAll('.list-tabs li')].map((count) => [
      count.textContent?.replace(/\s+/g, ' ').trim(),
      count.classList.contains('on'),
    ]);
  const bar = () => element().querySelector('app-split-bar .stack');
  const titles = () =>
    [...element().querySelectorAll('app-issue-rows .ttl')].map((title) => title.textContent);
  const dated = () =>
    element().querySelector('app-issue-rows .m')?.textContent?.replace(/\s+/g, ' ').trim();
  const status = () => element().querySelector('.issue-list .count-note')?.textContent?.trim();
  const notes = () =>
    [...element().querySelectorAll('.issue-list .count-note')]
      .slice(1)
      .map((note) => note.textContent?.trim());
  const select = (label: string) =>
    element().querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const options = (label: string) =>
    [...select(label).options].map((option) => option.textContent?.trim());
  const listMessage = () => list()?.querySelector('.w-state span')?.textContent;
  const page = (label: string) =>
    [...element().querySelectorAll<HTMLButtonElement>('nav.pager button')].find(
      (button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label,
    )!;
  const current = () =>
    element().querySelector('nav.pager [aria-current="page"]')?.textContent?.trim();
  /** The last view of the list asked for. */
  const lastAsked = () => asked[asked.length - 1];

  async function choose(label: string, value: string): Promise<void> {
    select(label).value = value;
    select(label).dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
  }

  async function click(button: HTMLButtonElement): Promise<void> {
    button.click();
    await harness.fixture.whenStable();
  }

  /** Opens `url` anew, as a link or a reload does, from a page elsewhere. */
  async function open(url: string): Promise<void> {
    await harness.navigateByUrl('/blank');
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
  }

  /**
   * Steps through the history with `step`, as the browser's Back or Forward does, which the router
   * follows once the browser has moved, after the step itself.
   */
  async function traverse(step: (location: Location) => void): Promise<void> {
    const ended = firstValueFrom(router().events.pipe(filter((e) => e instanceof NavigationEnd)));
    step(TestBed.inject(Location));
    await ended;
    await harness.fixture.whenStable();
  }

  const back = () => traverse((location) => location.back());
  const forward = () => traverse((location) => location.forward());

  it('shows how long issues stay open, or how fast pull requests are merged, above (FR-REPO-13)', async () => {
    expect(element().querySelector('app-repository-issue-age')).not.toBeNull();
    await open('/acme/widget/pulls');
    expect(element().querySelector('app-repository-merge-velocity')).not.toBeNull();
  });

  it("asks for those figures once, whatever the list shows, which doesn't change them", async () => {
    const before = figures.mock.calls.length;
    await choose('State', 'closed');
    await choose('Label', 'bug');
    await click(page('Next'));
    expect(figures.mock.calls.length).toBe(before);
  });

  it('counts issues by state, of the whole repository (FR-REPO-06)', () => {
    expect(headings()).toContain('Issues');
    expect(counts()).toEqual([
      ['12,345 Open', true],
      ['4 Closed', false],
    ]);
    expect(bar()?.getAttribute('aria-label')).toBe('12,345 open, 4 closed.');
  });

  it('counts pull requests as open, merged and closed without merging', async () => {
    await open('/acme/widget/pulls');
    expect(headings()).toContain('Pull requests');
    expect(counts()).toEqual([
      ['3 Open', true],
      ['5 Merged', false],
      ['1 Closed', false],
    ]);
    expect(bar()?.getAttribute('aria-label')).toBe('3 open, 5 merged, 1 closed.');
  });

  it('shows the counts as a table on request (NFR-UX-04)', async () => {
    await open('/acme/widget/pulls');
    element().querySelector<HTMLButtonElement>('.w-head button')!.click();
    await harness.fixture.whenStable();
    expect(
      [...element().querySelectorAll('tr')].map((row) =>
        [...row.children].map((cell) => cell.textContent?.trim()),
      ),
    ).toEqual([[...STATE_HEADERS], ['Open', '3'], ['Merged', '5'], ['Closed', '1']]);
  });

  it('lists a full page of open issues, updated last first, apart from pull requests, and says how many', () => {
    expect(lastAsked()).toEqual([
      'issue',
      { state: 'open', label: undefined, sort: 'updated', page: 0 },
    ]);
    expect(headings()).toContain('Open issues');
    expect(titles()).toHaveLength(25);
    expect(titles()[0]).toBe('Widgets 30');
    expect(dated()).toMatch(/^#30 updated /);
    expect(status()).toBe(listedIssues(30, 'issue', 'open', undefined, 1, 2));
    expect(status()).toBe('30 open issues, page 1 of 2');
    expect(element().querySelector('.issue-list .count-note')!.getAttribute('aria-live')).toBe(
      'polite',
    );
    expect(router().url).toBe('/acme/widget/issues');
  });

  it('pages through them, in its URL too, from the top of the list', async () => {
    await click(page('Next'));
    expect(lastAsked()[1].page).toBe(1);
    expect(query()).toEqual({ page: '2' });
    expect(titles()).toEqual(['Widgets 5', 'Widgets 4', 'Widgets 3', 'Widgets 2', 'Widgets 1']);
    expect(current()).toBe('2');
    expect(status()).toBe('30 open issues, page 2 of 2');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce();
    await click(page('Previous'));
    expect(router().url).toBe('/acme/widget/issues');
    expect(current()).toBe('1');
  });

  it('filters by state and label, and orders by the oldest, each from the first page', async () => {
    expect(options('State')).toEqual(['Open', 'Closed', 'All']);
    expect(options('Label')).toEqual(['All labels', 'bug', 'docs']);
    expect(options('Sort')).toEqual(['Recently updated', 'Oldest']);
    await click(page('Next'));

    await choose('State', 'closed');
    expect(query()).toEqual({ q: 'is:issue is:closed sort:updated-desc' });
    expect(lastAsked()[1]).toEqual({ state: 'closed', label: undefined, sort: 'updated', page: 0 });
    expect(headings()).toContain('Closed issues');

    await choose('Label', 'bug');
    expect(query()).toEqual({ q: 'is:issue is:closed label:bug sort:updated-desc' });

    await click(page('Next'));
    await choose('Sort', 'oldest');
    expect(query()).toEqual({ q: 'is:issue is:closed label:bug sort:created-asc' });
    expect(lastAsked()[1]).toEqual({ state: 'closed', label: 'bug', sort: 'oldest', page: 0 });
    // When each was opened, as their order is.
    expect(dated()).toMatch(/^#30 opened /);
    expect(status()).toBe('30 closed issues labeled “bug”, page 1 of 2');

    await choose('Label', '');
    await choose('State', 'open');
    await choose('Sort', 'updated');
    expect(router().url).toBe('/acme/widget/issues');
  });

  it('lists pull requests merged, or closed without merging, apart', async () => {
    await open('/acme/widget/pulls');
    expect(options('State')).toEqual(['Open', 'Merged', 'Closed without merging', 'All']);
    await choose('State', 'merged');
    expect(query()).toEqual({ q: 'is:pr is:merged sort:updated-desc' });
    expect(lastAsked()).toEqual([
      'pull_request',
      { state: 'merged', label: undefined, sort: 'updated', page: 0 },
    ]);
    expect(headings()).toContain('Merged pull requests');
    expect(element().querySelector('app-issue-rows .lead .sr')?.textContent).toBe(
      'Pull request, merged',
    );
    await choose('State', 'closed');
    expect(query()).toEqual({ q: 'is:pr is:closed is:unmerged sort:updated-desc' });
    expect(element().querySelector('app-issue-rows .lead .sr')?.textContent).toBe(
      'Pull request, closed',
    );
    expect(status()).toBe('30 pull requests closed without merging, page 1 of 2');
  });

  it("keeps a label chosen that the repository's labels as listed don't have", async () => {
    await open('/acme/widget/issues?q=is:issue+label:zig');
    expect(options('Label')).toEqual(['All labels', 'bug', 'docs', 'zig']);
    expect(select('Label').value).toBe('zig');
    // Should the labels fail, the label chosen is still offered.
    labels.set({ status: 'error', failure: 'github' });
    await harness.fixture.whenStable();
    expect(options('Label')).toEqual(['All labels', 'zig']);
  });

  it("says when none match, and what GitHub's search could not reach", async () => {
    server.set((kind, view) => ({ status: 'ready', data: pageOf(kind, view, 0) }));
    await choose('Label', 'bug');
    expect(listMessage()).toBe(noIssuesMatch('issue', 'open', 'bug'));
    expect(listMessage()).toBe('No open issues labeled “bug”.');
    expect(status()).toBe('');

    server.set((kind, view) => ({
      status: 'ready',
      data: pageOf(kind, view, 1234, { incomplete: true }),
    }));
    await harness.fixture.whenStable();
    expect(status()).toBe('1,234 open issues labeled “bug”, page 1 of 40');
    expect(notes()).toEqual([CAPPED, INCOMPLETE]);
  });

  it('stands in its place while it loads, and says when it failed, and tries again', async () => {
    server.set(() => ({ status: 'loading' }));
    await harness.fixture.whenStable();
    expect(list()!.querySelector('.skel-row')).not.toBeNull();
    // What filters it stays.
    expect(select('State')).not.toBeNull();

    server.set(() => ({ status: 'error', failure: 'github' }));
    await harness.fixture.whenStable();
    expect(listMessage()).toBe(FAILED);
    list()!.querySelector<HTMLButtonElement>('.w-state button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('says when the repository has turned them off, and lists nothing', async () => {
    issues.set({ status: 'ready', data: { ...ISSUES, issues: undefined } });
    await harness.fixture.whenStable();
    expect(element().querySelector('app-widget p.muted')?.textContent).toBe(ISSUES_OFF);
    expect(element().querySelector('.list-tabs, app-split-bar, .w-head button')).toBeNull();
    expect(list()).toBeNull();

    // As the list says, while the counts load.
    issues.set({ status: 'loading' });
    server.set((kind, view) => ({ status: 'ready', data: pageOf(kind, view, 0, { off: true }) }));
    await open('/acme/widget/pulls');
    expect(list()).toBeNull();
    issues.set({ status: 'ready', data: { ...ISSUES, pullRequests: undefined } });
    await harness.fixture.whenStable();
    expect(element().querySelector('app-widget p.muted')?.textContent).toBe(PULL_REQUESTS_OFF);
  });

  it('says when there are none (FR-REPO-11)', async () => {
    const none = {
      issues: { open: 0, closed: 0 },
      pullRequests: { open: 0, merged: 0, closed: 0 },
    };
    issues.set({ status: 'ready', data: { ...none, recent: [RECENT[1]] } });
    await harness.fixture.whenStable();
    expect(element().querySelector('.w-state span')?.textContent).toBe(NO_ISSUES);
    expect(list()).toBeNull();
    await open('/acme/widget/pulls');
    expect(element().querySelector('.w-state span')?.textContent).toBe(NO_PULL_REQUESTS);
  });

  describe('in its URL, as on GitHub (FR-REPO-06)', () => {
    // As the app does as it starts, so that the router follows the browser's Back and Forward.
    beforeEach(() => router().setUpLocationChangeListener());

    it("opens at the view that GitHub's own link names", async () => {
      await open(
        '/acme/widget/issues?q=is%3Aissue+is%3Aclosed+label%3Abug+sort%3Acreated-asc&page=2',
      );
      expect(select('State').value).toBe('closed');
      expect(select('Label').value).toBe('bug');
      expect(select('Sort').value).toBe('oldest');
      expect(lastAsked()[1]).toEqual({ state: 'closed', label: 'bug', sort: 'oldest', page: 1 });
      expect(current()).toBe('2');
      expect(query()).toEqual({ q: 'is:issue is:closed label:bug sort:created-asc', page: '2' });
    });

    it('spells its URL as it does, in place, keeping what is not its own', async () => {
      await open(
        '/acme/widget/pulls?q=IS:PR+state:closed+is:unmerged+author:alice+label:"good first issue"&utm_source=chat',
      );
      expect(select('State').value).toBe('closed');
      expect(select('Label').value).toBe('good first issue');
      expect(query()).toEqual({
        q: 'is:pr is:closed is:unmerged label:"good first issue" sort:updated-desc',
        utm_source: 'chat',
      });
      await back();
      expect(router().url).toBe('/blank');
    });

    it('steps back and forward through what the user picked, with its URL and what it shows', async () => {
      await choose('State', 'all');
      await choose('Sort', 'oldest');
      await click(page('Next'));
      expect(query()).toEqual({ q: 'is:issue sort:created-asc', page: '2' });

      await back();
      expect(query()).toEqual({ q: 'is:issue sort:created-asc' });
      expect(current()).toBe('1');
      expect(lastAsked()[1]).toEqual({ state: 'all', label: undefined, sort: 'oldest', page: 0 });

      await back();
      expect(select('Sort').value).toBe('updated');
      expect(select('State').value).toBe('all');

      await back();
      expect(router().url).toBe('/acme/widget/issues');
      expect(select('State').value).toBe('open');

      await forward();
      await forward();
      await forward();
      expect(query()).toEqual({ q: 'is:issue sort:created-asc', page: '2' });
      expect(current()).toBe('2');
      expect(select('Sort').value).toBe('oldest');
    });

    it('shows the last page, in its URL too, when its URL names one past it, once it knows', async () => {
      server.set(() => ({ status: 'loading' }));
      await open('/acme/widget/issues?page=9');
      // Not while it does not know how many there are.
      expect(query()).toEqual({ page: '9' });
      server.set((kind, view) => ({ status: 'ready', data: pageOf(kind, view, 30) }));
      await harness.fixture.whenStable();
      expect(query()).toEqual({ page: '2' });
      expect(current()).toBe('2');
      expect(titles()).toHaveLength(5);
      // In place of the URL the link named, so that Back leads where the user was before.
      await back();
      expect(router().url).toBe('/blank');
    });

    it('takes no page of another view for one of the view shown, as while it loads', async () => {
      await choose('State', 'closed');
      await click(page('Next'));
      // Whatever is asked for, the page of all of them, of one page, that came before.
      const all = { state: 'all', label: undefined, sort: 'updated', page: 0 } as const;
      server.set((kind) => ({ status: 'ready', data: pageOf(kind, all, 3) }));
      await harness.fixture.whenStable();
      // So that it is not the last page that it tells, nor goes to.
      expect(query()).toEqual({ q: 'is:issue is:closed sort:updated-desc', page: '2' });
      expect(status()).toBe('');
    });
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
