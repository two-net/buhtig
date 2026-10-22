import { Component, computed, inject, input, signal } from '@angular/core';
import { CommitActivity, Resources, Week } from '../dashboard/resources';
import { monthLabel } from '../format/format';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { activityDescription, activityTotal, weekSummary } from './messages';

/** How wide each week's column is in the chart, of which its bar takes `BAR`. */
const COLUMN = 10;
const BAR = 7;

/** How high the busiest week's bar is. */
const HEIGHT = 100;

/** How high a week's bar is at least, if it has commits, so that it shows beside a busy week. */
const LEAST = 2;

/** How many weeks a month's label needs, so that the last one stays within the chart. */
const LABEL_WEEKS = 3;

/** The chart of a repository's commit activity, as it is drawn. */
interface Chart {
  /** The width of all the columns together. */
  width: number;
  bars: Bar[];
  /** The months that start within the chart, labelled where they start. */
  months: { label: string; at: number }[];
  description: string;
}

interface Bar {
  week: Week;
  /** Where its column starts. */
  column: number;
  height: number;
}

/**
 * A repository's commits per week to its default branch over the last 52 weeks, as a bar
 * chart (FR-REPO-03). Pointing at a week tells its commits. Its text alternative is a sentence
 * that says what it shows in all (NFR-UX-04).
 */
@Component({
  selector: 'app-repository-activity',
  imports: [Loaded, Widget],
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

  /** The week pointed at, if any. */
  protected readonly pointed = signal<Week | undefined>(undefined);

  protected readonly caption = computed(() => {
    const state = this.activity.state();
    const pointed = this.pointed();
    if (pointed !== undefined) {
      return weekSummary(pointed);
    }
    return state.status === 'ready' ? activityTotal(state.data) : '';
  });

  protected readonly offset = (COLUMN - BAR) / 2;
  protected readonly barWidth = BAR;
  protected readonly columnWidth = COLUMN;
  protected readonly height = HEIGHT;
}

/** How `activity` is drawn: the busiest week's bar as high as the chart. */
function chart(activity: CommitActivity): Chart {
  const weeks = activity.weeks;
  const busiest = Math.max(...weeks.map((week) => week.commits));
  const bars = weeks.map((week, index) => ({
    week,
    column: index * COLUMN,
    height: week.commits === 0 ? 0 : Math.max(LEAST, (week.commits / busiest) * HEIGHT),
  }));
  const months = weeks.flatMap((week, index) => {
    const before = weeks[index - 1];
    const starts = before !== undefined && before.start.getUTCMonth() !== week.start.getUTCMonth();
    return starts && index <= weeks.length - LABEL_WEEKS
      ? [{ label: monthLabel(week.start), at: (index / weeks.length) * 100 }]
      : [];
  });
  return {
    width: weeks.length * COLUMN,
    bars,
    months,
    description: activityDescription(activity),
  };
}
