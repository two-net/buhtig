import { CommitActivity, Observation, Period, TrendFigures, Trends } from '../dashboard/resources';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The figures that trends follow (FR-REPO-17), in the order a dashboard shows them. */
export type Metric = keyof TrendFigures;
export const METRICS: readonly Metric[] = ['stars', 'forks', 'openIssues', 'openPullRequests'];

/** The periods a dashboard compares, in days. */
export const PERIODS = [7, 30, 90] as const;

/**
 * One UTC day of a period: its observation if BuhTig made one that day, or else whether that is
 * because BuhTig was not tracking the repository yet, rather than a gap in what it observed.
 */
export interface ObservedDay {
  /** Midnight UTC. */
  day: Date;
  observation: Observation | undefined;
  /** Whether the day is before the first observation kept. */
  untracked: boolean;
}

/** The days of `period`, from its first to that of the latest observation, oldest first. */
export function daysOf(trends: Trends, period: Period): ObservedDay[] {
  const [first, latest] = [trends.observations[0], trends.observations.at(-1)];
  if (first === undefined || latest === undefined || period.firstDay === undefined) {
    return [];
  }
  const byDay = new Map(
    trends.observations.map((observation) => [dayOf(observation), observation]),
  );
  const days: ObservedDay[] = [];
  for (let day = period.firstDay.getTime(); day <= dayOf(latest); day += DAY_MS) {
    days.push({ day: new Date(day), observation: byDay.get(day), untracked: day < dayOf(first) });
  }
  return days;
}

/** The days of `days` since BuhTig began tracking, which are those a chart shows. */
export function trackedDays(days: readonly ObservedDay[]): ObservedDay[] {
  return days.filter((day) => !day.untracked);
}

/** Midnight UTC of the day an observation is of. */
function dayOf(observation: Observation): number {
  return observation.day.getTime();
}

/** The latest observation, unless there is none. */
export function latestOf(trends: Trends): Observation | undefined {
  return trends.observations.at(-1);
}

/**
 * The weeks of commits compared with each period: whole weeks, since GitHub counts commits by
 * the week (FR-REPO-18).
 */
export const COMPARED_WEEKS: Readonly<Record<number, number>> = { 7: 1, 30: 4, 90: 13 };

/** Some weeks of commits: from the Sunday the first starts on to the Saturday the last ends on. */
export interface Weeks {
  from: Date;
  to: Date;
  commits: number;
}

/** The commits of the latest whole weeks, and of as many weeks before them. */
export interface CommitComparison {
  weeks: number;
  recent: Weeks;
  before: Weeks;
}

/**
 * The commits of the latest `COMPARED_WEEKS[days]` weeks that have ended by `now`, against those
 * of as many weeks before them (FR-REPO-18), or `undefined` if GitHub gave too few weeks, as for
 * a new repository. The week under way is left out, so that it is not taken for a slow one.
 */
export function compareCommits(
  activity: CommitActivity,
  days: number,
  now: number,
): CommitComparison | undefined {
  const weeks = COMPARED_WEEKS[days];
  if (weeks === undefined) {
    return undefined;
  }
  const ended = activity.weeks.filter((week) => week.start.getTime() + 7 * DAY_MS <= now);
  if (ended.length < 2 * weeks) {
    return undefined;
  }
  const span = (some: typeof ended): Weeks => ({
    from: some[0].start,
    to: new Date(some[some.length - 1].start.getTime() + 6 * DAY_MS),
    commits: some.reduce((total, week) => total + week.commits, 0),
  });
  return {
    weeks,
    recent: span(ended.slice(-weeks)),
    before: span(ended.slice(-2 * weeks, -weeks)),
  };
}
