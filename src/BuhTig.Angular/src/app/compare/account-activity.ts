import { Component, computed, inject } from '@angular/core';
import { Column, ColumnChart, Tick } from '../chart/columns';
import { Bar, BarChart } from '../chart/hbars';
import { ChartTable } from '../chart/table';
import { yearTicks } from '../chart/ticks';
import { CreatedPerYear, LastPush } from '../dashboard/resources';
import { ACCOUNT_COLUMNS, accountCells, exportName } from '../export/provenance';
import { exactNumber } from '../format/format';
import { LAST_PUSH as PERIODS, NO_REPOSITORIES, createdIn } from '../organization/messages';
import { PERIOD_KEYS } from '../organization/csv';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { ComparisonData } from './data';
import {
  CREATED_PER_YEAR,
  LAST_PUSH,
  NO_REPOSITORIES_EITHER,
  YEAR,
  bothSides,
  lastPushComparison,
  pairHeaders,
  sentence,
  sideCreated,
  sideLastPush,
} from './messages';

/** All the repositories `pushes` counts, of every period. */
function pushed(pushes: LastPush): number {
  return pushes.last7Days + pushes.last30Days + pushes.last12Months + pushes.older;
}

/**
 * Two accounts' repositories by when each last received a push, as two charts of bars side by
 * side, the first on the left as their heads are, against one scale (FR-CMP-04). Its summary
 * says how many of each were pushed to in the last 7 days, and its table lists each period's
 * repositories of both (NFR-UX-04). Its CSV file has a row for each period and side, in the order
 * of the table, each with what its side's figures cover and when they were fetched (FR-EXP-02).
 */
@Component({
  selector: 'app-compare-last-push',
  imports: [BarChart, Loaded, Widget],
  template: `
    <app-widget
      [heading]="LAST_PUSH"
      [empty]="NO_REPOSITORIES_EITHER"
      emptyIcon="clock"
      skeleton="bars"
      [summary]="summary()"
      [table]="table()"
    >
      <ng-template [appLoaded]="lastPush">
        <div class="cmp-pair">
          @for (side of sides(); track $index) {
            <figure class="cmp-fig">
              <figcaption>
                <span class="cmp-fig-name">{{ side.name }}</span>
              </figcaption>
              @if (side.bars.length > 0) {
                <app-bar-chart
                  [bars]="side.bars"
                  unit="repositories"
                  [summary]="side.summary"
                  [max]="max()"
                />
              } @else {
                <p class="muted">{{ NO_REPOSITORIES }}</p>
              }
            </figure>
          }
        </div>
      </ng-template>
    </app-widget>
  `,
})
export class CompareLastPush {
  private readonly data = inject(ComparisonData);

  protected readonly lastPush = emptyWhen(
    this.data.lastPush(),
    ([a, b]) => pushed(a) + pushed(b) === 0,
  );

  private readonly ready = computed(() => {
    const state = this.lastPush.state();
    return state.status === 'ready' ? state.data : undefined;
  });

  private readonly periods = Object.keys(PERIODS) as (keyof LastPush)[];

  protected readonly sides = computed(() =>
    (this.ready() ?? []).map((pushes, index) => {
      const name = this.data.names()[index];
      return {
        name,
        bars:
          pushed(pushes) > 0
            ? this.periods.map((period): Bar => ({ label: PERIODS[period], value: pushes[period] }))
            : [],
        summary: sideLastPush(name),
      };
    }),
  );

  /** The most repositories of a period of either, which both charts reach to. */
  protected readonly max = computed(() =>
    Math.max(0, ...(this.ready() ?? []).flatMap((pushes) => this.periods.map((p) => pushes[p]))),
  );

  protected readonly summary = computed(() => {
    const ready = this.ready();
    const [first, second] = this.data.names();
    return ready ? lastPushComparison(first, ready[0], second, ready[1]) : '';
  });

  protected readonly table = computed((): ChartTable | undefined => {
    const ready = this.ready();
    const names = this.data.names();
    const [first, second] = names;
    return ready
      ? {
          headers: pairHeaders(LAST_PUSH, first, second),
          rows: this.periods.map((period) => ({
            label: PERIODS[period],
            values: ready.map((pushes) => exactNumber(pushes[period])),
          })),
          csv: {
            name: exportName(first, 'vs', second, 'last-push'),
            columns: ['side', 'period', 'repositories', ...ACCOUNT_COLUMNS],
            rows: this.periods.flatMap((period) =>
              ready.map((pushes, side) => [
                side + 1,
                PERIOD_KEYS[period],
                pushes[period],
                ...accountCells(names[side], pushes),
              ]),
            ),
          },
        }
      : undefined;
  });

  protected readonly LAST_PUSH = LAST_PUSH;
  protected readonly NO_REPOSITORIES = NO_REPOSITORIES;
  protected readonly NO_REPOSITORIES_EITHER = NO_REPOSITORIES_EITHER;
}

/**
 * Two accounts' repositories created in each year, as two charts of columns side by side, the
 * first on the left as their heads are, over the same years, from the first either created a
 * repository in, and against one scale (FR-CMP-04). Its summary says how many each created since
 * when, and its table lists each year's repositories of both (NFR-UX-04). Its CSV file has a
 * row for each year and side, in the order of the table, each with what its side's figures cover
 * and when they were fetched (FR-EXP-02).
 */
@Component({
  selector: 'app-compare-created',
  imports: [ColumnChart, Loaded, Widget],
  template: `
    <app-widget
      [heading]="CREATED_PER_YEAR"
      [empty]="NO_REPOSITORIES_EITHER"
      emptyIcon="calendar"
      [summary]="summary()"
      [table]="table()"
    >
      <ng-template [appLoaded]="createdPerYear">
        <div class="cmp-pair">
          @for (side of sides(); track $index) {
            <figure class="cmp-fig">
              <figcaption>
                <span class="cmp-fig-name">{{ side.name }}</span>
              </figcaption>
              <app-column-chart
                [columns]="side.columns"
                [ticks]="ticks()"
                unit="repositories"
                [summary]="side.summary"
                [height]="150"
                [caps]="true"
                [max]="max()"
              />
            </figure>
          }
        </div>
      </ng-template>
    </app-widget>
  `,
})
export class CompareCreated {
  private readonly data = inject(ComparisonData);

  protected readonly createdPerYear = emptyWhen(
    this.data.createdPerYear(),
    ([a, b]) => a.years.length === 0 && b.years.length === 0,
  );

  private readonly ready = computed(() => {
    const state = this.createdPerYear.state();
    return state.status === 'ready' ? state.data : undefined;
  });

  /** Every year from the first either created a repository in to the last either did. */
  private readonly years = computed(() => {
    const years = (this.ready() ?? []).flatMap((created) => created.years.map(({ year }) => year));
    if (years.length === 0) {
      return [];
    }
    const [from, to] = [Math.min(...years), Math.max(...years)];
    return Array.from({ length: to - from + 1 }, (_, at) => from + at);
  });

  /** How many repositories each side created in each of `years`, none in those it has not. */
  private readonly counts = computed(() =>
    (this.ready() ?? []).map((created) => {
      const of = new Map(created.years.map(({ year, repositories }) => [year, repositories]));
      return this.years().map((year) => of.get(year) ?? 0);
    }),
  );

  protected readonly ticks = computed((): Tick[] =>
    yearTicks(this.years().map((year) => ({ year }))),
  );

  protected readonly sides = computed(() =>
    (this.ready() ?? []).map((created: CreatedPerYear, index) => {
      const name = this.data.names()[index];
      return {
        name,
        columns: this.years().map((year, at): Column => ({
          value: this.counts()[index][at],
          label: createdIn(year),
        })),
        summary: sentence(sideCreated(name, created.years)),
      };
    }),
  );

  /** The most repositories either created in a year, which both charts reach to. */
  protected readonly max = computed(() => Math.max(0, ...this.counts().flat()));

  protected readonly summary = computed(() => {
    const ready = this.ready();
    const [first, second] = this.data.names();
    return ready
      ? bothSides(sideCreated(first, ready[0].years), sideCreated(second, ready[1].years))
      : '';
  });

  protected readonly table = computed((): ChartTable | undefined => {
    const names = this.data.names();
    const [first, second] = names;
    const counts = this.counts();
    const ready = this.ready();
    return ready
      ? {
          headers: pairHeaders(YEAR, first, second),
          rows: this.years().map((year, at) => ({
            label: String(year),
            values: counts.map((count) => exactNumber(count[at])),
          })),
          csv: {
            name: exportName(first, 'vs', second, 'created-per-year'),
            columns: ['side', 'year', 'repositories', ...ACCOUNT_COLUMNS],
            rows: this.years().flatMap((year, at) =>
              counts.map((count, side) => [
                side + 1,
                year,
                count[at],
                ...accountCells(names[side], ready[side]),
              ]),
            ),
          },
        }
      : undefined;
  });

  protected readonly CREATED_PER_YEAR = CREATED_PER_YEAR;
  protected readonly NO_REPOSITORIES_EITHER = NO_REPOSITORIES_EITHER;
}
