import { Component, computed, inject, input } from '@angular/core';
import { Column, ColumnChart } from '../chart/columns';
import { CommitActivity, Resources } from '../dashboard/resources';
import { exactNumber, monthLabel, weekDate } from '../format/format';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import {
  ACTIVITY_CHART,
  ACTIVITY_HEADERS,
  activityDescription,
  activityTotal,
  weekSummary,
} from './messages';

/** How many weeks a month's label needs, so that the last one stays within the chart. */
const LABEL_WEEKS = 3;

/** The chart of a repository's commit activity, as it is drawn. */
interface Chart {
  columns: Column[];
  /** The months that start within the chart, labelled where they start, of 100. */
  months: { label: string; at: number }[];
  total: string;
  summary: string;
}

/**
 * A repository's commits per week to its default branch over the last 52 weeks, as a chart of
 * columns (FR-REPO-03). Pointing at a week tells its commits. Its text alternative says what it
 * shows in all, and lists every week's commits on request (NFR-UX-04).
 */
@Component({
  selector: 'app-repository-activity',
  imports: [ColumnChart, Loaded, Widget],
  templateUrl: './activity.html',
  styleUrl: './activity.css',
})
export class RepositoryActivity {
  private readonly resources = inject(Resources);

  /** The repository's names, as the URL has them. */
  readonly owner = input.required<string>();
  readonly repo = input.required<string>();

  protected readonly activity = load(
    () => this.resources.commitActivity(this.owner(), this.repo()),
    (activity) => activity.total === 0,
  );

  protected readonly chart = computed(() => {
    const state = this.activity.state();
    return state.status === 'ready' ? chart(state.data) : undefined;
  });

  protected readonly name = ACTIVITY_CHART;
  protected readonly headers = ACTIVITY_HEADERS;
}

/** How `activity` is drawn, a column for each week, with the months labelled under them. */
function chart(activity: CommitActivity): Chart {
  const weeks = activity.weeks;
  const months = weeks.flatMap((week, index) => {
    const before = weeks[index - 1];
    const starts = before !== undefined && before.start.getUTCMonth() !== week.start.getUTCMonth();
    return starts && index <= weeks.length - LABEL_WEEKS
      ? [{ label: monthLabel(week.start), at: (index / weeks.length) * 100 }]
      : [];
  });
  return {
    columns: weeks.map((week) => ({
      value: week.commits,
      readout: weekSummary(week),
      label: weekDate(week.start),
      cell: exactNumber(week.commits),
    })),
    months,
    total: activityTotal(activity),
    summary: activityDescription(activity),
  };
}
