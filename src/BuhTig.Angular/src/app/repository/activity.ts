import { Component, computed, inject, input } from '@angular/core';
import { Column, ColumnChart, Tick } from '../chart/columns';
import { ChartTable } from '../chart/table';
import { RepositoryData } from '../dashboard/data';
import { CommitActivity } from '../dashboard/resources';
import { exactNumber, monthLabel, weekDate } from '../format/format';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import {
  ACTIVITY_HEADERS,
  NO_RECENT_COMMITS,
  NO_RECENT_COMMITS_ARCHIVED,
  activityDescription,
  weekOf,
} from './messages';

/**
 * A repository's commits per week to its default branch over the last 52 weeks, as a chart of
 * columns, with its months below (FR-REPO-03). Pointing at a week tells its commits. Its summary
 * says what it shows in all, and its table lists every week's commits, newest first (NFR-UX-04).
 */
@Component({
  selector: 'app-repository-activity',
  imports: [ColumnChart, Loaded, Widget],
  template: `
    <app-widget
      heading="Commit activity"
      [empty]="empty()"
      emptyIcon="clock"
      [summary]="summary()"
      [table]="table()"
    >
      <ng-template [appLoaded]="activity" let-activity>
        <app-column-chart
          [columns]="columns()"
          [ticks]="ticks()"
          unit="commits"
          [summary]="summary()"
          [height]="height()"
        />
      </ng-template>
    </app-widget>
  `,
})
export class RepositoryActivity {
  private readonly data = inject(RepositoryData);

  /** How high the chart is, in pixels. */
  readonly height = input(180);

  protected readonly activity = emptyWhen(this.data.activity(), (activity) => activity.total === 0);

  private readonly ready = computed(() => {
    const state = this.activity.state();
    return state.status === 'ready' ? state.data : undefined;
  });

  protected readonly empty = computed(() =>
    this.data.repository()?.archived ? NO_RECENT_COMMITS_ARCHIVED : NO_RECENT_COMMITS,
  );

  protected readonly columns = computed((): Column[] =>
    (this.ready()?.weeks ?? []).map((week) => ({ value: week.commits, label: weekOf(week.start) })),
  );

  protected readonly ticks = computed(() => ticks(this.ready()));

  protected readonly summary = computed(() => {
    const activity = this.ready();
    return activity ? activityDescription(activity, this.data.repository()?.defaultBranch) : '';
  });

  protected readonly table = computed((): ChartTable | undefined => {
    const activity = this.ready();
    return activity
      ? {
          headers: ACTIVITY_HEADERS,
          rows: [...activity.weeks]
            .reverse()
            .map((week) => ({ label: weekDate(week.start), value: exactNumber(week.commits) })),
        }
      : undefined;
  });
}

/** The months under the chart, where each starts, all but each quarter's first minor. */
function ticks(activity: CommitActivity | undefined): Tick[] {
  const weeks = activity?.weeks ?? [];
  return weeks.flatMap((week, index) => {
    const before = weeks[index - 1];
    const month = week.start.getUTCMonth();
    return before !== undefined && before.start.getUTCMonth() !== month
      ? [{ at: index, label: monthLabel(week.start), minor: month % 3 !== 0 }]
      : [];
  });
}
