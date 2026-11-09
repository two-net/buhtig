import {
  Component,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  NavigationStart,
  Router,
  RouterLink,
} from '@angular/router';
import { Segment, SplitBar } from '../chart/stack';
import { ChartTable } from '../chart/table';
import { RepositoryData } from '../dashboard/data';
import { IssueOrPullRequest, IssuePage, IssuesAndPullRequests } from '../dashboard/resources';
import { repositoryTabPath } from '../dashboard/tabs';
import { exactNumber } from '../format/format';
import { RelativeTime } from '../format/relative-time';
import { Icon, IconName } from '../icon/icon';
import { Motion } from '../motion/motion';
import { Pager } from '../pager/pager';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import {
  ISSUE_LIST_PARAMS,
  IssueKind,
  IssueSort,
  IssueView,
  issueQueryOf,
  issueViewOf,
  statesOf,
} from './issue-query';
import { RepositoryIssueAge, RepositoryMergeVelocity } from './velocity';
import {
  ALL_ISSUES,
  ALL_LABELS,
  ALL_PULL_REQUESTS,
  CAPPED,
  INCOMPLETE,
  ISSUES_OFF,
  ISSUE_SORTS,
  NO_ISSUES,
  NO_ISSUES_OR_PULL_REQUESTS,
  NO_PULL_REQUESTS,
  PULL_REQUESTS_OFF,
  STATES,
  STATE_HEADERS,
  issueLabel,
  issueListHeading,
  listedIssues,
  noIssuesMatch,
  stateOption,
} from './messages';

/** What marks the navigations that a tab's list starts itself, as the user changes its view. */
const LIST_EDIT = Symbol('issue list edit');

/**
 * Issues and pull requests in rows, as GitHub lists them: each with an icon of its kind and
 * state, in its state's color and named for assistive technology, its title, linking to it on
 * GitHub (FR-REPO-12), its number, when it last changed, or when it was opened, as the order of
 * the rows has them, and who opened it. They come in one after another (FR-ANIM-08).
 */
@Component({
  selector: 'app-issue-rows',
  imports: [Icon, RelativeTime],
  template: `
    <ul class="rows stagger" aria-label="Issues and pull requests">
      @for (item of items(); track item.kind + item.number) {
        <li [style.--i]="$index">
          <span class="lead" [class]="tone(item)" [title]="label(item)">
            <app-icon [name]="icon(item)" /><span class="sr">{{ label(item) }}</span>
          </span>
          <div class="t">
            @if (item.url; as url) {
              <a class="ttl" [href]="url">{{ item.title }}</a>
            } @else {
              <span class="ttl">{{ item.title }}</span>
            }
            <div class="m">
              <span>
                #{{ item.number }}
                @if (dated() === 'created') {
                  @if (item.createdAt; as when) {
                    opened <app-relative-time [value]="when" />
                  }
                } @else if (item.updatedAt ?? item.createdAt; as when) {
                  updated <app-relative-time [value]="when" />
                }
                @if (item.author) {
                  by {{ item.author }}
                }
              </span>
            </div>
          </div>
        </li>
      }
    </ul>
  `,
  styles: ':host { display: block; }',
})
export class IssueRows {
  readonly items = input.required<IssueOrPullRequest[]>();
  /** Which time each row tells: when it last changed, or when it was opened. */
  readonly dated = input<'updated' | 'created'>('updated');

  protected icon({ kind, state }: IssueOrPullRequest): IconName {
    if (kind === 'issue') {
      return state === 'open' ? 'issue' : 'issue-closed';
    }
    return state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : 'pr';
  }

  /** The color of its state: closed issues are done, as merged pull requests are. */
  protected tone({ kind, state }: IssueOrPullRequest): string {
    return kind === 'issue' && state === 'closed' ? 'st-done' : `st-${state}`;
  }

  protected readonly label = issueLabel;
}

/**
 * The 6 issues and pull requests of a repository that changed last, on its Overview tab
 * (FR-REPO-06), with links to its Issues and Pull requests tabs below.
 */
@Component({
  selector: 'app-repository-recent-issues',
  imports: [IssueRows, Loaded, RouterLink, Widget],
  template: `
    <app-widget
      heading="Recent issues and pull requests"
      [empty]="NO_ISSUES_OR_PULL_REQUESTS"
      emptyIcon="issue"
      skeleton="list"
      [flush]="true"
    >
      <ng-template [appLoaded]="issues" let-issues>
        <app-issue-rows [items]="issues.recent.slice(0, 6)" />
      </ng-template>
      <div class="Box-footer" footer>
        <a [routerLink]="link('issues')">{{ ALL_ISSUES }}</a>
        <a [routerLink]="link('pulls')">{{ ALL_PULL_REQUESTS }}</a>
      </div>
    </app-widget>
  `,
})
export class RepositoryRecentIssues {
  private readonly data = inject(RepositoryData);

  protected readonly issues = emptyWhen(this.data.issues(), (issues) => issues.recent.length === 0);

  protected link(tab: 'issues' | 'pulls'): string {
    return repositoryTabPath(this.data.name(), tab);
  }

  protected readonly NO_ISSUES_OR_PULL_REQUESTS = NO_ISSUES_OR_PULL_REQUESTS;
  protected readonly ALL_ISSUES = ALL_ISSUES;
  protected readonly ALL_PULL_REQUESTS = ALL_PULL_REQUESTS;
}

/** The parts of a repository's issues, or of its pull requests, by state (FR-REPO-06). */
export function stateSegments(
  issues: IssuesAndPullRequests,
  kind: IssueOrPullRequest['kind'],
): Segment[] | undefined {
  if (kind === 'issue') {
    const counts = issues.issues;
    return (
      counts && [
        { label: STATES.open, value: counts.open, color: 'var(--st-open)' },
        { label: STATES.closed, value: counts.closed, color: 'var(--st-merged)' },
      ]
    );
  }
  const counts = issues.pullRequests;
  return (
    counts && [
      { label: STATES.open, value: counts.open, color: 'var(--st-open)' },
      { label: STATES.merged, value: counts.merged, color: 'var(--st-merged)' },
      { label: STATES.closed, value: counts.closed, color: 'var(--st-closed)' },
    ]
  );
}

/**
 * A repository's Issues tab, or its Pull requests tab (FR-REPO-06). Above, how long its open
 * issues have been open, or how fast its pull requests are merged (FR-REPO-13), which say what
 * they are of, whatever the list shows. Then how many there are in each state, as counts and as a
 * split bar. Then the list of them, of the tab's kind alone, 25 to a page, as GitHub's search
 * finds them, filtered by state and by label, and in the order the user picks: those updated
 * last, or those opened first, which then say when they were opened. How many match, and which
 * page shows, is announced as it changes.
 *
 * What the list shows is in its URL's query, in the syntax of GitHub's own lists, as
 * `issue-query.ts` reads and spells it, so that it can be bookmarked, shared, reloaded, and
 * stepped through with Back and Forward. Each filter, order or page the user picks is a step of
 * the history. A new filter or order shows the first page again. A page past the last is the
 * last, once the list knows how many there are, in its URL too, in place. A label that the
 * repository's labels as listed do not have stays chosen. The list is the viewer's own, with their
 * credentials and cache (FR-ACC-06, FR-DATA-04).
 */
@Component({
  selector: 'app-repository-issues-tab',
  imports: [
    IssueRows,
    Loaded,
    Pager,
    RepositoryIssueAge,
    RepositoryMergeVelocity,
    SplitBar,
    Widget,
  ],
  template: `
    <div class="stack-v">
      @if (kind() === 'pull_request') {
        <app-repository-merge-velocity />
      } @else {
        <app-repository-issue-age />
      }
      <app-widget
        [heading]="kind() === 'issue' ? 'Issues' : 'Pull requests'"
        [empty]="empty()"
        emptyIcon="issue"
        skeleton="stack"
        [table]="table()"
      >
        <ng-template [appLoaded]="issues">
          @let parts = segments();
          @if (parts) {
            <ul class="list-tabs">
              @for (segment of parts; track segment.label; let first = $first) {
                <li [class.on]="first">
                  <span class="lang-dot" [style.background]="segment.color"></span>
                  {{ count(segment.value) }} {{ segment.label }}
                </li>
              }
            </ul>
            <app-split-bar class="tabbar" [segments]="parts" [summary]="summary()" />
          } @else {
            <p class="muted">{{ off() }}</p>
          }
        </ng-template>
      </app-widget>
      @if (listed()) {
        <section
          class="issue-list"
          [attr.aria-label]="kind() === 'issue' ? 'Issues' : 'Pull requests'"
        >
          <div #filters class="filters">
            <select
              #state
              class="select"
              aria-label="State"
              (change)="setView({ state: $any(state.value) })"
            >
              @for (option of states(); track option) {
                <option [value]="option" [selected]="view().state === option">
                  {{ stateOption(option, kind()) }}
                </option>
              }
            </select>
            <select
              #label
              class="select"
              aria-label="Label"
              (change)="setView({ label: label.value || undefined })"
            >
              <option value="" [selected]="view().label === undefined">{{ ALL_LABELS }}</option>
              @for (option of labels(); track option) {
                <option [value]="option" [selected]="view().label === option">{{ option }}</option>
              }
            </select>
            <select
              #order
              class="select"
              aria-label="Sort"
              (change)="setView({ sort: $any(order.value) })"
            >
              @for (option of sorts; track option) {
                <option [value]="option" [selected]="view().sort === option">
                  {{ ISSUE_SORTS[option] }}
                </option>
              }
            </select>
          </div>
          <p class="count-note" aria-live="polite">{{ status() }}</p>
          @for (note of notes(); track note) {
            <p class="count-note">{{ note }}</p>
          }
          <app-widget
            [heading]="heading()"
            [empty]="noMatch()"
            emptyIcon="issue"
            skeleton="list"
            [flush]="true"
          >
            <ng-template [appLoaded]="list" let-page>
              <app-issue-rows
                [items]="page.items"
                [dated]="page.view.sort === 'oldest' ? 'created' : 'updated'"
              />
              <app-pager [index]="page.page" [count]="page.pages" (go)="go($event)" />
            </ng-template>
          </app-widget>
        </section>
      }
    </div>
  `,
  styles: `
    .tabbar {
      margin-top: 12px;
    }
    .issue-list .filters {
      padding-bottom: 0;
      border-bottom: 0;
    }
    .issue-list .count-note {
      margin: 8px 0;
    }
    app-pager {
      padding: 0 16px 16px;
    }
  `,
})
export class RepositoryIssuesTab implements OnInit {
  private readonly data = inject(RepositoryData);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly motion = inject(Motion);
  private readonly filters = viewChild<ElementRef<HTMLElement>>('filters');

  readonly kind = input.required<IssueKind>();

  /** Empty when there are none of the tab's kind, nor any GitHub turned off. */
  protected readonly issues = emptyWhen(this.data.issues(), (issues) => {
    const segments = stateSegments(issues, this.kind());
    return segments !== undefined && segments.every((segment) => segment.value === 0);
  });

  private readonly ready = computed(() => {
    const state = this.issues.state();
    return state.status === 'ready' ? state.data : undefined;
  });

  protected readonly segments = computed(() => {
    const issues = this.ready();
    return issues && stateSegments(issues, this.kind());
  });

  protected readonly summary = computed(
    () =>
      (this.segments() ?? [])
        .map((segment) => `${exactNumber(segment.value)} ${segment.label.toLowerCase()}`)
        .join(', ') + '.',
  );

  protected readonly table = computed((): ChartTable | undefined => {
    const segments = this.segments();
    return segments
      ? {
          headers: STATE_HEADERS,
          rows: segments.map((segment) => ({
            label: segment.label,
            values: [exactNumber(segment.value)],
          })),
        }
      : undefined;
  });

  protected readonly empty = computed(() =>
    this.kind() === 'issue' ? NO_ISSUES : NO_PULL_REQUESTS,
  );

  /** That the repository has turned the tab's kind off on GitHub. */
  protected readonly off = computed(() =>
    this.kind() === 'issue' ? ISSUES_OFF : PULL_REQUESTS_OFF,
  );

  /**
   * What the list shows, as its URL says, and as the user changes it at once, without waiting for
   * the URL to follow. Read anew from the URL for another kind.
   */
  protected readonly view = linkedSignal<IssueKind, IssueView>({
    source: this.kind,
    computation: (kind) => issueViewOf(this.route.snapshot.queryParamMap, kind),
  });

  /** The page of the list that `view` shows, as it loads. */
  private readonly page = this.data.issueList(this.kind, this.view);

  /** The page loaded, if it is of the view shown, and not of one before. */
  private readonly shown = computed((): IssuePage | undefined => {
    const state = this.page.state();
    return state.status === 'ready' && sameView(state.data.view, this.view())
      ? state.data
      : undefined;
  });

  /** The page, empty when it has none, as when none match or the kind is turned off. */
  protected readonly list = emptyWhen(this.page, (page) => page.items.length === 0);

  /**
   * Whether the list shows, unless the counts or the list say that the repository has turned the
   * kind off, or that it has none at all.
   */
  protected readonly listed = computed(() => {
    const counts = this.issues.state();
    const page = this.page.state();
    return (
      counts.status !== 'empty' &&
      !(counts.status === 'ready' && this.segments() === undefined) &&
      !(page.status === 'ready' && page.data.off)
    );
  });

  protected readonly states = computed(() => statesOf(this.kind()));

  private readonly repositoryLabels = this.data.labels();

  /** The repository's labels, and the one chosen, even if they do not have it. */
  protected readonly labels = computed(() => {
    const state = this.repositoryLabels.state();
    const names = state.status === 'ready' ? state.data.names : [];
    const chosen = this.view().label;
    return chosen === undefined || names.includes(chosen)
      ? names
      : [...names, chosen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  });

  protected readonly heading = computed(() => issueListHeading(this.kind(), this.view().state));

  protected readonly noMatch = computed(() => {
    const page = this.shown();
    const view = this.view();
    return page?.off ? this.off() : noIssuesMatch(this.kind(), view.state, view.label);
  });

  protected readonly status = computed(() => {
    const page = this.shown();
    if (page === undefined || page.total === 0) {
      return '';
    }
    const { state, label } = page.view;
    return listedIssues(page.total, this.kind(), state, label, page.page + 1, page.pages);
  });

  /** What the list says of GitHub's search: that it reaches only so far, or ran out of time. */
  protected readonly notes = computed(() => {
    const page = this.shown();
    return [...(page?.capped ? [CAPPED] : []), ...(page?.incomplete ? [INCOMPLETE] : [])];
  });

  constructor() {
    // Back and Forward, and links to the tab, show what their URL says. The list's own
    // navigations show what it already shows.
    let own = false;
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        own = this.router.currentNavigation()?.extras.info === LIST_EDIT;
      } else if (event instanceof NavigationEnd && !own) {
        this.view.set(issueViewOf(this.route.snapshot.queryParamMap, this.kind()));
        this.spellInUrl();
      }
    });

    // A page past the last is the last, in the URL too, once the list knows how many there are,
    // as when a link names one, or a refresh brings fewer.
    effect(() => {
      const page = this.shown();
      if (page !== undefined && page.page >= page.pages) {
        this.show({ ...page.view, page: page.pages - 1 }, true);
      }
    });
  }

  ngOnInit(): void {
    this.spellInUrl();
  }

  /** Shows the list with `change` to its filters or order, from its first page. */
  protected setView(change: Partial<Pick<IssueView, 'state' | 'label' | 'sort'>>): void {
    this.show({ ...this.view(), ...change, page: 0 }, false);
  }

  /** Shows the page at `index`, from the top of the list. */
  protected go(index: number): void {
    this.show({ ...this.view(), page: index }, false);
    this.filters()?.nativeElement.scrollIntoView({
      block: 'start',
      behavior: this.motion.full() ? 'smooth' : 'auto',
    });
  }

  /**
   * Spells the view in the URL as the list does, in place of what the URL says, where it says it
   * otherwise: in GitHub's syntax, as `issueQueryOf` spells it, and without what the list does not
   * show, or what is as it starts, so that the URL and what the list shows agree.
   */
  private spellInUrl(): void {
    const params = this.route.snapshot.queryParamMap;
    const query = issueQueryOf(this.view(), this.kind());
    if (ISSUE_LIST_PARAMS.some((name) => params.get(name) !== query[name])) {
      this.show(this.view(), true);
    }
  }

  /**
   * Shows `view`, and puts it in the URL, as a new step of the history, or in place of the one
   * there if `replace`.
   */
  private show(view: IssueView, replace: boolean): void {
    this.view.set(view);
    const url = this.router.createUrlTree([], {
      relativeTo: this.route,
      queryParams: issueQueryOf(view, this.kind()),
      queryParamsHandling: 'merge',
    });
    void this.router.navigateByUrl(url, { replaceUrl: replace, info: LIST_EDIT });
  }

  protected readonly count = exactNumber;
  protected readonly stateOption = stateOption;
  protected readonly sorts = Object.keys(ISSUE_SORTS) as IssueSort[];
  protected readonly ISSUE_SORTS = ISSUE_SORTS;
  protected readonly ALL_LABELS = ALL_LABELS;
}

/** Whether `a` and `b` are the same view of a list. */
function sameView(a: IssueView, b: IssueView): boolean {
  return a.state === b.state && a.label === b.label && a.sort === b.sort && a.page === b.page;
}
