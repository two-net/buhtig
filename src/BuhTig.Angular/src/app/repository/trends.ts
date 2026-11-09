import { Component, computed, inject, signal } from '@angular/core';
import { LineChart } from '../chart/line';
import { ChartTable } from '../chart/table';
import { RepositoryData } from '../dashboard/data';
import { Observation, Period, Trends } from '../dashboard/resources';
import { exactNumber, exactTime, utcDay } from '../format/format';
import { Icon, IconName } from '../icon/icon';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import {
  METRIC_LABELS,
  NOT_OBSERVED,
  NOT_TRACKED,
  NO_FIGURE,
  NO_TRENDS,
  PERIOD,
  PRIVATE_TRENDS,
  TRENDS,
  TRENDS_HEADERS,
  changeOf,
  commitComparison,
  fromTo,
  noBaseline,
  now,
  periodLabel,
  trackingNote,
  trendChartDescription,
  trendsDescription,
  unsupportedReason,
} from './messages';
import {
  METRICS,
  Metric,
  PERIODS,
  compareCommits,
  daysOf,
  latestOf,
  trackedDays,
} from './observations';

const ICONS: Readonly<Record<Metric, IconName>> = {
  stars: 'star',
  forks: 'fork',
  openIssues: 'issue',
  openPullRequests: 'pr',
};

/** The period shown first, in days. */
const FIRST_PERIOD = 30;

/** A figure of a period, as a stat card of the widget shows it. */
interface Figure {
  metric: Metric;
  icon: IconName;
  label: string;
  /** Its change, or a dash where there is none to tell. */
  value: string;
  /** What it changed from and to, or what it is now. */
  sub: string;
}

/** A small chart of one figure over a period. */
interface Chart {
  metric: Metric;
  label: string;
  values: (number | null)[];
  summary: string;
}

/**
 * How a repository's stat cards' figures changed, on its Activity tab (FR-REPO-17): over 7, 30
 * or 90 days, as BuhTig observed them while its dashboard was opened. Each figure's change is
 * between the two observations the server chose, whose times it tells. Where the observations do
 * not allow one, it says why, rather than show a zero: a repository observed once has no earlier
 * baseline. A small chart of each figure leaves the days without an observation as gaps. Its
 * summary says what changed, and on how many days there is an observation, and its table lists
 * every day, newest first, with those without one said to be so (NFR-UX-04).
 *
 * Beside them, the commits of as many whole weeks as the period, against as many before
 * (FR-REPO-18), from the commit activity GitHub keeps.
 */
@Component({
  selector: 'app-repository-trends',
  imports: [Icon, LineChart, Loaded, Widget],
  template: `
    <app-widget
      [heading]="TRENDS"
      [empty]="NO_TRENDS"
      emptyIcon="pulse"
      skeleton="figures"
      [flush]="true"
      [summary]="summary()"
      [table]="table()"
    >
      <ng-template [appLoaded]="trends" let-trends>
        <div class="trends">
          <div class="seg" role="group" [attr.aria-label]="PERIOD">
            @for (days of PERIODS; track days) {
              <button
                type="button"
                class="btn sm"
                [attr.aria-pressed]="days === selected()"
                (click)="selected.set(days)"
              >
                {{ periodLabel(days) }}
              </button>
            }
          </div>
          <dl class="stats few" [style.--n]="4">
            @for (figure of figures(); track figure.metric) {
              <div class="stat">
                <dt><app-icon [name]="figure.icon" />{{ figure.label }}</dt>
                <dd class="val">{{ figure.value }}</dd>
                <dd class="sub">{{ figure.sub }}</dd>
              </div>
            }
          </dl>
          <div class="trend-notes">
            @if (why(); as why) {
              <p class="why">{{ why }}</p>
            }
            @if (commits(); as commits) {
              <p class="commits">{{ commits }}</p>
            }
          </div>
          @if (charts().length) {
            <div class="trend-charts">
              @for (chart of charts(); track chart.metric) {
                <figure>
                  <figcaption>{{ chart.label }}</figcaption>
                  <app-line-chart
                    [values]="chart.values"
                    [summary]="chart.summary"
                    [first]="ends()[0]"
                    [last]="ends()[1]"
                  />
                </figure>
              }
            </div>
          }
          <div class="trend-notes quiet">
            <p>{{ tracking(trends) }}</p>
            @if (trends.scope === 'private') {
              <p class="scope">{{ PRIVATE_TRENDS }}</p>
            }
          </div>
        </div>
      </ng-template>
    </app-widget>
  `,
})
export class RepositoryTrends {
  private readonly data = inject(RepositoryData);
  private readonly activity = this.data.activity();

  protected readonly trends = emptyWhen(
    this.data.trends(),
    (trends) => trends.observations.length === 0,
  );

  /** The period shown, in days. */
  readonly selected = signal(FIRST_PERIOD);

  private readonly ready = computed((): Trends | undefined => {
    const state = this.trends.state();
    return state.status === 'ready' ? state.data : undefined;
  });

  private readonly latest = computed(() => {
    const trends = this.ready();
    return trends && latestOf(trends);
  });

  private readonly period = computed((): Period | undefined =>
    this.ready()?.periods.find((period) => period.days === this.selected()),
  );

  /** The days of the period, from its first to that of the latest observation. */
  private readonly days = computed(() => {
    const [trends, period] = [this.ready(), this.period()];
    return trends && period ? daysOf(trends, period) : [];
  });

  protected readonly figures = computed((): Figure[] => {
    const [period, latest] = [this.period(), this.latest()];
    if (period === undefined || latest === undefined) {
      return [];
    }
    return METRICS.map((metric) => ({
      metric,
      icon: ICONS[metric],
      label: METRIC_LABELS[metric],
      ...(period.supported
        ? {
            value: changeOf(period.changes[metric]),
            sub: fromTo(period.from.figures[metric], period.to.figures[metric]),
          }
        : { value: NO_FIGURE, sub: now(latest.figures[metric]) }),
    }));
  });

  /** Why the period has no changes, if it has none. */
  protected readonly why = computed(() => {
    const [trends, period] = [this.ready(), this.period()];
    if (trends === undefined || period === undefined || period.supported) {
      return undefined;
    }
    const first = trends.observations[0];
    return period.reason === 'first_observation' && first !== undefined
      ? noBaseline(first)
      : unsupportedReason(period.reason, period, trends.trackingSince);
  });

  /** The commits of the latest whole weeks against as many before, if GitHub gave enough. */
  protected readonly commits = computed(() => {
    const state = this.activity.state();
    if (state.status !== 'ready') {
      return undefined;
    }
    const comparison = compareCommits(state.data, this.selected(), Date.now());
    return comparison && commitComparison(comparison);
  });

  /** The days that BuhTig was tracking the repository, which the charts show. */
  private readonly tracked = computed(() => trackedDays(this.days()));

  protected readonly ends = computed((): [string, string] => {
    const tracked = this.tracked();
    const [first, last] = [tracked[0], tracked[tracked.length - 1]];
    return first && last ? [utcDay(first.day), utcDay(last.day)] : ['', ''];
  });

  /** A chart of each figure, once two days of the period have an observation. */
  protected readonly charts = computed((): Chart[] => {
    const tracked = this.tracked();
    if (tracked.filter((day) => day.observation).length < 2) {
      return [];
    }
    return METRICS.map((metric) => {
      const values = tracked.map((day) => day.observation?.figures[metric] ?? null);
      return {
        metric,
        label: METRIC_LABELS[metric],
        values,
        summary: trendChartDescription(metric, values),
      };
    });
  });

  protected readonly summary = computed(() => {
    const [trends, period, latest] = [this.ready(), this.period(), this.latest()];
    return trends && period && latest
      ? trendsDescription(period, latest, trends.trackingSince)
      : '';
  });

  protected readonly table = computed((): ChartTable | undefined => {
    if (this.ready() === undefined) {
      return undefined;
    }
    return {
      headers: TRENDS_HEADERS,
      rows: [...this.days()].reverse().map(({ day, observation, untracked }) => ({
        label: utcDay(day),
        values: observation ? observed(observation) : missing(untracked),
      })),
    };
  });

  protected tracking(trends: Trends): string {
    return trackingNote(trends.keptDays);
  }

  protected readonly PERIODS = PERIODS;
  protected readonly periodLabel = periodLabel;
  protected readonly TRENDS = TRENDS;
  protected readonly NO_TRENDS = NO_TRENDS;
  protected readonly PERIOD = PERIOD;
  protected readonly PRIVATE_TRENDS = PRIVATE_TRENDS;
}

/** A day's row of the table, after its day: when it was observed, and its figures. */
function observed(observation: Observation): string[] {
  return [
    exactTime(observation.observedAt),
    ...METRICS.map((metric) => exactNumber(observation.figures[metric])),
  ];
}

/** A day's row without an observation: a dash for each figure, never a zero. */
function missing(untracked: boolean): string[] {
  return [untracked ? NOT_TRACKED : NOT_OBSERVED, ...METRICS.map(() => NO_FIGURE)];
}
