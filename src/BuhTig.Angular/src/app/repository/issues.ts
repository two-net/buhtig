import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Segment, SplitBar } from '../chart/stack';
import { ChartTable } from '../chart/table';
import { RepositoryData } from '../dashboard/data';
import { IssueOrPullRequest, IssuesAndPullRequests } from '../dashboard/resources';
import { repositoryTabPath } from '../dashboard/tabs';
import { exactNumber } from '../format/format';
import { RelativeTime } from '../format/relative-time';
import { Icon, IconName } from '../icon/icon';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import {
  ALL_ISSUES,
  ALL_PULL_REQUESTS,
  ISSUES_OFF,
  NOTHING_RECENT,
  NO_ISSUES,
  NO_ISSUES_OR_PULL_REQUESTS,
  NO_PULL_REQUESTS,
  PULL_REQUESTS_OFF,
  STATES,
  STATE_HEADERS,
  issueLabel,
} from './messages';

/**
 * Issues and pull requests in rows, as GitHub lists them: each with an icon of its kind and
 * state, in its state's color and named for assistive technology, its title, linking to it on
 * GitHub (FR-REPO-12), its number, when it last changed and who opened it. They come in one
 * after another (FR-ANIM-08).
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
                @if (item.updatedAt ?? item.createdAt; as when) {
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
 * A repository's Issues tab, or its Pull requests tab (FR-REPO-06): how many there are in each
 * state, as counts and as a split bar, then those of its 20 issues and pull requests that
 * changed last that are of the tab's kind.
 */
@Component({
  selector: 'app-repository-issues-tab',
  imports: [IssueRows, Loaded, SplitBar, Widget],
  template: `
    <div class="stack-v">
      <app-widget
        [heading]="kind() === 'issue' ? 'Issues' : 'Pull requests'"
        [empty]="empty()"
        emptyIcon="issue"
        skeleton="list"
        [flush]="true"
        [table]="table()"
      >
        <ng-template [appLoaded]="issues" let-issues>
          @let parts = segments();
          <div class="flushwrap">
            <div class="pad">
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
                <p class="muted">{{ kind() === 'issue' ? ISSUES_OFF : PULL_REQUESTS_OFF }}</p>
              }
            </div>
            @if (recent().length > 0) {
              <app-issue-rows [items]="recent()" />
            } @else {
              <p class="pad muted">{{ NOTHING_RECENT }}</p>
            }
          </div>
        </ng-template>
      </app-widget>
    </div>
  `,
  styles: '.tabbar { margin-top: 12px; }',
})
export class RepositoryIssuesTab {
  private readonly data = inject(RepositoryData);

  readonly kind = input.required<IssueOrPullRequest['kind']>();

  /** Empty when there are none of the tab's kind, nor any GitHub turned off. */
  protected readonly issues = emptyWhen(this.data.issues(), (issues) => {
    const segments = stateSegments(issues, this.kind());
    return (
      segments !== undefined &&
      segments.every((segment) => segment.value === 0) &&
      !issues.recent.some((item) => item.kind === this.kind())
    );
  });

  private readonly ready = computed(() => {
    const state = this.issues.state();
    return state.status === 'ready' ? state.data : undefined;
  });

  protected readonly segments = computed(() => {
    const issues = this.ready();
    return issues && stateSegments(issues, this.kind());
  });

  protected readonly recent = computed(() =>
    (this.ready()?.recent ?? []).filter((item) => item.kind === this.kind()),
  );

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
            value: exactNumber(segment.value),
          })),
        }
      : undefined;
  });

  protected readonly empty = computed(() =>
    this.kind() === 'issue' ? NO_ISSUES : NO_PULL_REQUESTS,
  );

  protected readonly count = exactNumber;
  protected readonly ISSUES_OFF = ISSUES_OFF;
  protected readonly PULL_REQUESTS_OFF = PULL_REQUESTS_OFF;
  protected readonly NOTHING_RECENT = NOTHING_RECENT;
}
