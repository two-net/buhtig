import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { LineChart } from '../chart/line';
import { RepositoryData } from '../dashboard/data';
import { CommitActivity, Dated, Observation, Period, Trends } from '../dashboard/resources';
import { exactTime, utcDay } from '../format/format';
import { Load } from '../widget/load';
import { Widget } from '../widget/widget';
import {
  NOT_OBSERVED,
  NOT_TRACKED,
  NO_FIGURE,
  NO_TRENDS,
  PRIVATE_TRENDS,
  TRENDS,
  noBaseline,
  trendsDescription,
} from './messages';
import { RepositoryTrends } from './trends';

/** An observation of `acme/widget` at noon UTC on `on`, with `stars`. */
function observation(on: string, stars: number): Observation {
  return {
    day: new Date(`${on}T00:00:00Z`),
    observedAt: new Date(`${on}T12:00:00Z`),
    pullRequestsObservedAt: new Date(`${on}T12:00:00Z`),
    figures: { stars, forks: 10, openIssues: 40, openPullRequests: 7 },
  };
}

const FIRST = observation('2026-11-02', 100);
const LATEST = observation('2026-11-09', 112);

/** Observed on Nov 2, 5 and 9: a week's change, and a month not tracked for. */
const TRENDS_OF: Trends = {
  scope: 'shared',
  keptDays: 90,
  trackingSince: FIRST.observedAt,
  observations: [FIRST, observation('2026-11-05', 104), LATEST],
  gaps: [
    { from: new Date('2026-11-03T00:00:00Z'), to: new Date('2026-11-04T00:00:00Z') },
    { from: new Date('2026-11-06T00:00:00Z'), to: new Date('2026-11-08T00:00:00Z') },
  ],
  periods: [
    {
      days: 7,
      firstDay: new Date('2026-11-02T00:00:00Z'),
      observedDays: 3,
      target: new Date('2026-11-02T12:00:00Z'),
      supported: true,
      from: FIRST,
      to: LATEST,
      changes: { stars: 12, forks: 0, openIssues: 0, openPullRequests: 0 },
    },
    {
      days: 30,
      firstDay: new Date('2026-10-10T00:00:00Z'),
      observedDays: 3,
      target: new Date('2026-10-10T12:00:00Z'),
      supported: false,
      reason: 'tracked_later',
    },
    {
      days: 90,
      firstDay: new Date('2026-08-11T00:00:00Z'),
      observedDays: 3,
      target: new Date('2026-08-11T12:00:00Z'),
      supported: false,
      reason: 'tracked_later',
    },
  ],
};

/** The stat cards' names and figures in `element`, each a list. */
function figures(element: HTMLElement): string[][] {
  return [...element.querySelectorAll('.stat')].map((card) =>
    [...card.children].map((part) => part.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
  );
}

describe('RepositoryTrends', () => {
  const trends = signal<Load<Trends>>({ status: 'loading' });
  const activity = signal<Load<CommitActivity>>({ status: 'loading' });
  let fixture: ComponentFixture<RepositoryTrends>;

  beforeEach(async () => {
    trends.set({ status: 'loading' });
    activity.set({ status: 'loading' });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RepositoryData,
          useValue: {
            name: signal('acme/widget'),
            trends: () => ({ state: trends, retry: () => {} }),
            activity: () => ({ state: activity, retry: () => {} }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(RepositoryTrends);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) =>
    element().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

  async function answer(data: Trends): Promise<void> {
    trends.set({ status: 'ready', data });
    await fixture.whenStable();
  }

  async function choose(period: string): Promise<void> {
    const button = [...element().querySelectorAll<HTMLButtonElement>('.seg button')].find(
      (button) => button.textContent?.trim() === period,
    );
    button!.click();
    await fixture.whenStable();
  }

  /** The table's rows, after showing it. */
  async function table(): Promise<string[][]> {
    element().querySelector<HTMLButtonElement>('.w-head button')!.click();
    await fixture.whenStable();
    return [...element().querySelectorAll('tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent?.trim() ?? ''),
    );
  }

  it('shows a placeholder the size of its figures until they load', () => {
    expect(element().querySelector('h2')?.textContent).toBe(TRENDS);
    expect(element().querySelector('.figures-skel')).not.toBeNull();
  });

  it('says when nothing has been observed', async () => {
    await answer({ ...TRENDS_OF, observations: [], trackingSince: undefined, gaps: [] });
    expect(text('.w-state span')).toBe(NO_TRENDS);
  });

  it("tells each figure's change between two observations, and when they were made (FR-REPO-17)", async () => {
    await answer(TRENDS_OF);
    await choose('7 days');
    expect(figures(element())).toEqual([
      ['Stars', '+12', 'from 100 to 112'],
      ['Forks', '0', 'from 10 to 10'],
      ['Open issues', '0', 'from 40 to 40'],
      ['Open pull requests', '0', 'from 7 to 7'],
    ]);
    const period = TRENDS_OF.periods[0];
    expect(text('.w-sub')).toBe(trendsDescription(period, LATEST, TRENDS_OF.trackingSince));
    expect(text('.w-sub')).toContain(exactTime(FIRST.observedAt));
    expect(element().querySelector('.why')).toBeNull();
    // A small chart of each figure, which leaves the days not observed as gaps.
    const charts = fixture.debugElement.queryAll(By.directive(LineChart));
    expect(charts).toHaveLength(4);
    const stars = charts[0].componentInstance as LineChart;
    expect(stars.values()).toEqual([100, null, null, 104, null, null, null, 112]);
  });

  it('says why a period has no change, rather than show one of zero', async () => {
    await answer(TRENDS_OF);
    // A month, the period first shown.
    expect(element().querySelector('.seg [aria-pressed="true"]')?.textContent?.trim()).toBe(
      '30 days',
    );
    expect(figures(element())).toEqual([
      ['Stars', NO_FIGURE, '112 now'],
      ['Forks', NO_FIGURE, '10 now'],
      ['Open issues', NO_FIGURE, '40 now'],
      ['Open pull requests', NO_FIGURE, '7 now'],
    ]);
    expect(text('.why')).toContain(`BuhTig began recording on ${utcDay(FIRST.observedAt)}`);
  });

  it('explains that a newly tracked repository has no earlier baseline', async () => {
    const first: Period = {
      days: 30,
      firstDay: new Date('2026-10-10T00:00:00Z'),
      observedDays: 1,
      target: new Date('2026-10-10T12:00:00Z'),
      supported: false,
      reason: 'first_observation',
    };
    await answer({
      ...TRENDS_OF,
      trackingSince: LATEST.observedAt,
      observations: [LATEST],
      gaps: [],
      periods: [first],
    });
    expect(text('.why')).toBe(noBaseline(LATEST));
    expect(figures(element()).map(([, value]) => value)).toEqual(Array(4).fill(NO_FIGURE));
    // Nothing to chart from one day.
    expect(fixture.debugElement.queryAll(By.directive(LineChart))).toHaveLength(0);
  });

  it('lists every day of the period, those without an observation said to be so (NFR-UX-04)', async () => {
    await answer(TRENDS_OF);
    await choose('7 days');
    const rows = await table();
    expect(rows.map(([day]) => day)).toEqual(
      ['09', '08', '07', '06', '05', '04', '03', '02'].map((day) =>
        utcDay(new Date(`2026-11-${day}T00:00:00Z`)),
      ),
    );
    expect(rows[0].slice(1)).toEqual([exactTime(LATEST.observedAt), '112', '10', '40', '7']);
    expect(rows[1].slice(1)).toEqual([NOT_OBSERVED, NO_FIGURE, NO_FIGURE, NO_FIGURE, NO_FIGURE]);
    expect(rows.flat()).not.toContain('0');
  });

  it('tells the days before tracking began apart from gaps', async () => {
    await answer(TRENDS_OF);
    // Not charted, as nothing could have been observed then.
    const stars = fixture.debugElement.query(By.directive(LineChart)).componentInstance;
    expect((stars as LineChart).values()).toHaveLength(8);
    const rows = await table();
    expect(rows).toHaveLength(31);
    expect(rows.at(-1)?.[1]).toBe(NOT_TRACKED);
  });

  it('downloads every day of the period as a CSV file, never a zero for a day without one (FR-EXP-02)', async () => {
    const fetchedAt = new Date('2026-11-09T12:00:00.000Z');
    const dated: Dated<Trends> = { ...TRENDS_OF, scope: 'private', fetchedAt, stale: undefined };
    await answer(dated);
    await choose('7 days');
    const table = (
      fixture.debugElement.query(By.directive(Widget)).componentInstance as Widget
    ).table()!;
    const csv = table.csv!;
    expect(csv.name).toBe('acme-widget-trends-7-days');
    expect(csv.columns).toEqual([
      'day',
      'observation',
      'observed_at',
      'pull_requests_observed_at',
      'stars',
      'forks',
      'open_issues',
      'open_pull_requests',
      'period_days',
      'scope',
      'kept_days',
      'repository',
      'fetched_at',
      'stale',
    ]);
    // The same days as the table, newest first.
    expect(csv.rows).toHaveLength(table.rows.length);
    const provenance = [7, 'private', 90, 'acme/widget', fetchedAt, undefined];
    expect(csv.rows[0]).toEqual([
      '2026-11-09',
      'observed',
      LATEST.observedAt,
      LATEST.pullRequestsObservedAt,
      112,
      10,
      40,
      7,
      ...provenance,
    ]);
    // A day without an observation has no figures, never zeros.
    expect(csv.rows[1]).toEqual([
      '2026-11-08',
      'not_observed',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ...provenance,
    ]);
    // Of the 30 days, those before BuhTig began tracking are told apart from gaps.
    await choose('30 days');
    const month = (
      fixture.debugElement.query(By.directive(Widget)).componentInstance as Widget
    ).table()!.csv!;
    expect(month.name).toBe('acme-widget-trends-30-days');
    expect(month.rows).toHaveLength(31);
    expect(month.rows.at(-1)?.slice(0, 2)).toEqual(['2026-10-10', 'not_tracked']);
    expect(month.rows.at(-1)?.[8]).toBe(30);
  });

  it("says that what the viewer's token observed is theirs alone", async () => {
    await answer({ ...TRENDS_OF, scope: 'private' });
    expect(text('.scope')).toBe(PRIVATE_TRENDS);
    await answer(TRENDS_OF);
    expect(element().querySelector('.scope')).toBeNull();
  });

  it('compares the commits of as many whole weeks as the period, once they load (FR-REPO-18)', async () => {
    await answer(TRENDS_OF);
    await choose('7 days');
    expect(element().querySelector('.commits')).toBeNull();
    // Two weeks that have ended, long ago.
    activity.set({
      status: 'ready',
      data: {
        weeks: [
          { start: new Date('2025-01-05T00:00:00Z'), commits: 3 },
          { start: new Date('2025-01-12T00:00:00Z'), commits: 5 },
        ],
        total: 8,
      },
    });
    await fixture.whenStable();
    expect(text('.commits')).toContain('5 commits in the week from');
    expect(text('.commits')).toContain('and 3 in the week before.');
    // Too few weeks for a month.
    await choose('30 days');
    expect(element().querySelector('.commits')).toBeNull();
  });
});
