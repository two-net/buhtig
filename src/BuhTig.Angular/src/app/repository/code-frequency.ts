import { Component, computed, inject, input } from '@angular/core';
import { Column, ColumnChart } from '../chart/columns';
import { ChartTable } from '../chart/table';
import { RepositoryData } from '../dashboard/data';
import { exactNumber, weekDate } from '../format/format';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { monthTicks } from './activity';
import {
  ADDITIONS,
  CODE_FREQUENCY,
  CODE_FREQUENCY_HEADERS,
  DELETIONS,
  LINES_ADDED,
  LINES_DELETED,
  NO_CHANGES,
  TOO_MANY_COMMITS,
  codeFrequencyDescription,
  weekOf,
} from './messages';

/**
 * How many lines were added to and deleted from a repository each week over the last 52, on
 * its Activity tab (FR-REPO-15): a chart of columns that go up for the lines added and down for
 * those deleted, with its months below, and a legend that names each. Pointing at a week tells
 * both. Its summary says what it shows in all, and its table lists every week's lines, newest
 * first (NFR-UX-04).
 *
 * While GitHub is still computing it, it says so and asks again (FR-REPO-10). GitHub does not
 * compute it for its largest repositories, which it says.
 */
@Component({
  selector: 'app-repository-code-frequency',
  imports: [ColumnChart, Loaded, Widget],
  template: `
    <app-widget
      [heading]="CODE_FREQUENCY"
      [empty]="empty()"
      emptyIcon="code"
      [summary]="summary()"
      [table]="table()"
    >
      <ng-template [appLoaded]="frequency" let-frequency>
        <app-column-chart
          [columns]="columns()"
          [ticks]="ticks()"
          [unit]="LINES_ADDED"
          [belowUnit]="LINES_DELETED"
          [summary]="summary()"
          [height]="height()"
        />
        <ul class="legend" aria-hidden="true">
          <li>
            <span class="sw up"></span>
            <span class="nm">{{ ADDITIONS }}</span>
            <span class="pc">{{ count(frequency.additions) }}</span>
          </li>
          <li>
            <span class="sw down"></span>
            <span class="nm">{{ DELETIONS }}</span>
            <span class="pc">{{ count(frequency.deletions) }}</span>
          </li>
        </ul>
      </ng-template>
    </app-widget>
  `,
})
export class RepositoryCodeFrequency {
  private readonly data = inject(RepositoryData);
  private readonly loader = this.data.codeFrequency();

  /** How high the chart is, in pixels. */
  readonly height = input(200);

  protected readonly frequency = emptyWhen(
    this.loader,
    (frequency) => frequency.tooLarge || frequency.additions + frequency.deletions === 0,
  );

  private readonly ready = computed(() => {
    const state = this.frequency.state();
    return state.status === 'ready' ? state.data : undefined;
  });

  protected readonly empty = computed(() => {
    const state = this.loader.state();
    return state.status === 'ready' && state.data.tooLarge ? TOO_MANY_COMMITS : NO_CHANGES;
  });

  protected readonly columns = computed((): Column[] =>
    (this.ready()?.weeks ?? []).map((week) => ({
      value: week.additions,
      below: week.deletions,
      label: weekOf(week.start),
    })),
  );

  protected readonly ticks = computed(() => monthTicks(this.ready()?.weeks ?? []));

  protected readonly summary = computed(() => {
    const frequency = this.ready();
    return frequency
      ? codeFrequencyDescription(frequency, this.data.repository()?.defaultBranch)
      : '';
  });

  protected readonly table = computed((): ChartTable | undefined => {
    const frequency = this.ready();
    return frequency
      ? {
          headers: CODE_FREQUENCY_HEADERS,
          rows: [...frequency.weeks].reverse().map((week) => ({
            label: weekDate(week.start),
            values: [exactNumber(week.additions), exactNumber(week.deletions)],
          })),
        }
      : undefined;
  });

  protected readonly count = exactNumber;
  protected readonly CODE_FREQUENCY = CODE_FREQUENCY;
  protected readonly ADDITIONS = ADDITIONS;
  protected readonly DELETIONS = DELETIONS;
  protected readonly LINES_ADDED = LINES_ADDED;
  protected readonly LINES_DELETED = LINES_DELETED;
}
