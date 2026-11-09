import { CommitActivity, Observation, Period, Trends } from '../dashboard/resources';
import { compareCommits, daysOf, trackedDays } from './observations';

const day = (text: string) => new Date(`${text}T00:00:00Z`);

function observation(on: string, stars: number): Observation {
  return {
    day: day(on),
    observedAt: new Date(`${on}T12:00:00Z`),
    pullRequestsObservedAt: new Date(`${on}T12:00:00Z`),
    figures: { stars, forks: 1, openIssues: 2, openPullRequests: 3 },
  };
}

function trends(observations: Observation[]): Trends {
  return {
    scope: 'shared',
    keptDays: 90,
    trackingSince: observations[0]?.observedAt,
    observations,
    gaps: [],
    periods: [],
  };
}

function period(firstDay: string): Period {
  return {
    days: 7,
    firstDay: day(firstDay),
    observedDays: 0,
    target: undefined,
    supported: false,
    reason: 'tracked_later',
  };
}

describe('daysOf', () => {
  it('lists each day of the period, those before tracking began apart from gaps (FR-REPO-17)', () => {
    const observed = [observation('2026-11-05', 1), observation('2026-11-07', 2)];
    const days = daysOf(trends(observed), period('2026-11-03'));
    expect(
      days.map(({ day, observation, untracked }) => [
        day.toISOString().slice(0, 10),
        observation?.figures.stars,
        untracked,
      ]),
    ).toEqual([
      ['2026-11-03', undefined, true],
      ['2026-11-04', undefined, true],
      ['2026-11-05', 1, false],
      ['2026-11-06', undefined, false],
      ['2026-11-07', 2, false],
    ]);
    expect(trackedDays(days).map(({ day }) => day.getUTCDate())).toEqual([5, 6, 7]);
  });

  it('has no days without observations', () => {
    expect(daysOf(trends([]), period('2026-11-03'))).toEqual([]);
  });
});

describe('compareCommits', () => {
  /** 10 weeks of commits, from Sunday Aug 30, 2026, the nth with n commits. */
  const activity: CommitActivity = {
    weeks: Array.from({ length: 10 }, (_, n) => ({
      start: new Date(Date.UTC(2026, 7, 30 + 7 * n)),
      commits: n + 1,
    })),
    total: 55,
  };
  // During the 10th week, which started on Nov 1.
  const now = new Date('2026-11-04T12:00:00Z').getTime();

  it('compares whole weeks that have ended, leaving out the one under way (FR-REPO-18)', () => {
    expect(compareCommits(activity, 7, now)).toEqual({
      weeks: 1,
      recent: { from: day('2026-10-25'), to: day('2026-10-31'), commits: 9 },
      before: { from: day('2026-10-18'), to: day('2026-10-24'), commits: 8 },
    });
    expect(compareCommits(activity, 30, now)).toEqual({
      weeks: 4,
      recent: { from: day('2026-10-04'), to: day('2026-10-31'), commits: 6 + 7 + 8 + 9 },
      before: { from: day('2026-09-06'), to: day('2026-10-03'), commits: 2 + 3 + 4 + 5 },
    });
  });

  it('compares nothing without as many weeks again before', () => {
    expect(compareCommits(activity, 90, now)).toBeUndefined();
    expect(compareCommits({ weeks: [], total: 0 }, 7, now)).toBeUndefined();
    expect(compareCommits(activity, 14, now)).toBeUndefined();
  });
});
