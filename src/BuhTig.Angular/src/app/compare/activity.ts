import { Component, computed, inject } from '@angular/core';
import { Column, ColumnChart, Tick } from '../chart/columns';
import { ChartTable } from '../chart/table';
import { monthTicks } from '../chart/ticks';
import { CommitActivity } from '../dashboard/resources';
import { isoDay } from '../export/csv';
import { REPOSITORY_COLUMNS, exportName, repositoryCells } from '../export/provenance';
import { exactNumber, weekDate } from '../format/format';
import { weekOf } from '../repository/messages';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { ComparisonData } from './data';
import {
  COMMIT_ACTIVITY,
  NO_COMMITS_EITHER,
  NO_FIGURE,
  WEEK_OF,
  activityComparison,
  commitTotal,
  pairHeaders,
  sideActivity,
} from './messages';

/** One repository's chart of commit activity, as the comparison draws it. */
interface Side {
  name: string;
  total: string;
  columns: Column[];
  ticks: Tick[];
  summary: string;
}

/**
 * Two repositories' commits per week to their default branches over the last 52 weeks, as two
 * charts side by side, the first on the left as their heads are, against one scale, so that the
 * taller column is the busier week (FR-CMP-04). Its summary says how many commits each made, and
 * its table lists every week's commits of both, newest first (NFR-UX-04). Its CSV file has a row
 * for each week and side, in the order of the table, with the side's commits that week, or none
 * where its activity has no such week, and when its activity was fetched (FR-EXP-02).
 */
@Component({
  selector: 'app-compare-activity',
  imports: [ColumnChart, Loaded, Widget],
  template: `
    <app-widget
      [heading]="COMMIT_ACTIVITY"
      [empty]="NO_COMMITS_EITHER"
      emptyIcon="clock"
      [summary]="summary()"
      [table]="table()"
    >
      <ng-template [appLoaded]="activity">
        <div class="cmp-pair">
          @for (side of sides(); track $index) {
            <figure class="cmp-fig">
              <figcaption>
                <span class="cmp-fig-name">{{ side.name }}</span
                >&ngsp;<span>{{ side.total }}</span>
              </figcaption>
              <app-column-chart
                [columns]="side.columns"
                [ticks]="side.ticks"
                unit="commits"
                [summary]="side.summary"
                [height]="150"
                [max]="max()"
              />
            </figure>
          }
        </div>
      </ng-template>
    </app-widget>
  `,
})
export class CompareActivity {
  private readonly data = inject(ComparisonData);

  protected readonly activity = emptyWhen(
    this.data.activity(),
    ([a, b]) => a.total === 0 && b.total === 0,
  );

  private readonly ready = computed(() => {
    const state = this.activity.state();
    return state.status === 'ready' ? state.data : undefined;
  });

  protected readonly sides = computed((): Side[] => {
    const activities = this.ready() ?? [];
    return activities.map((activity, index) => {
      const name = this.data.names()[index];
      return {
        name,
        total: commitTotal(activity.total),
        columns: activity.weeks.map((week) => ({
          value: week.commits,
          label: weekOf(week.start),
        })),
        ticks: monthTicks(activity.weeks),
        summary: sideActivity(name, activity),
      };
    });
  });

  /** The busiest week of either, which both charts reach to. */
  protected readonly max = computed(() =>
    Math.max(
      0,
      ...(this.ready() ?? []).flatMap((activity) => activity.weeks.map((w) => w.commits)),
    ),
  );

  protected readonly summary = computed(() => {
    const ready = this.ready();
    const [first, second] = this.data.names();
    return ready ? activityComparison(first, ready[0], second, ready[1]) : '';
  });

  protected readonly table = computed((): ChartTable | undefined => {
    const ready = this.ready();
    if (!ready) {
      return undefined;
    }
    const names = this.data.names();
    const [first, second] = names;
    const weeks = weeksOf(ready[0], ready[1]);
    return {
      headers: pairHeaders(WEEK_OF, first, second),
      rows: weeks.map(({ start, commits }) => ({
        label: weekDate(start),
        values: commits.map((count) => (count === undefined ? NO_FIGURE : exactNumber(count))),
      })),
      csv: {
        name: exportName(first, 'vs', second, 'commit-activity'),
        columns: ['side', 'week_start', 'commits', ...REPOSITORY_COLUMNS],
        rows: weeks.flatMap(({ start, commits }) =>
          commits.map((count, side) => [
            side + 1,
            isoDay(start),
            count,
            ...repositoryCells(names[side], ready[side]),
          ]),
        ),
      },
    };
  });

  protected readonly COMMIT_ACTIVITY = COMMIT_ACTIVITY;
  protected readonly NO_COMMITS_EITHER = NO_COMMITS_EITHER;
}

/**
 * The weeks of the table of two repositories' commit activity: each week either has, newest
 * first, with each one's commits that week, or none where its activity has no such week, as
 * when GitHub computed one's a week before the other's.
 */
function weeksOf(
  a: CommitActivity,
  b: CommitActivity,
): { start: Date; commits: [number | undefined, number | undefined] }[] {
  const weeks = new Map<
    number,
    { start: Date; commits: [number | undefined, number | undefined] }
  >();
  for (const [index, activity] of [a, b].entries()) {
    for (const week of activity.weeks) {
      const at = week.start.getTime();
      const row = weeks.get(at) ?? { start: week.start, commits: [undefined, undefined] };
      row.commits[index] = week.commits;
      weeks.set(at, row);
    }
  }
  return [...weeks.entries()].sort(([a], [b]) => b - a).map(([, week]) => week);
}
