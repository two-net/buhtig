import { Observation, Period } from '../dashboard/resources';
import { duration, exactNumber, exactTime, percent, utcDay, weekDate } from '../format/format';
import {
  commitComparison,
  noBaseline,
  trendChartDescription,
  trendsDescription,
  unsupportedReason,
  activityDescription,
  codeFrequencyDescription,
  issueAgeDescription,
  mergeVelocityDescription,
  releaseCadenceDescription,
  workflowRunsDescription,
  commitsLabel,
  contributorsDescription,
  issueLabel,
  issuesDescription,
  languagesDescription,
  moreReleases,
  onAverageOf,
  pullRequestsDescription,
  weekOf,
} from './messages';

describe('repository messages', () => {
  const week = (day: number, commits: number) => ({
    start: new Date(Date.UTC(2026, 9, day)),
    commits,
  });

  it('counts commits in the singular and plural', () => {
    expect([commitsLabel(0), commitsLabel(1), commitsLabel(2)]).toEqual([
      'commits',
      'commit',
      'commits',
    ]);
  });

  it('names a week of the commit-activity chart by its first day', () => {
    expect(weekOf(new Date('2025-10-26'))).toBe(`Week of ${weekDate(new Date('2025-10-26'))}`);
  });

  it('describes commit activity, the busiest week first among equals, and its branch', () => {
    const activity = { weeks: [week(4, 1), week(11, 1), week(18, 0)], total: 2 };
    expect(activityDescription(activity, 'main')).toBe(
      '2 commits to main in the last 52 weeks. The busiest week was that of ' +
        `${weekDate(activity.weeks[0].start)}, with 1 commit.`,
    );
    expect(activityDescription({ weeks: [week(4, 1_234)], total: 1_234 }, undefined)).toBe(
      `${exactNumber(1_234)} commits in the last 52 weeks. The busiest week was that of ` +
        `${weekDate(week(4, 0).start)}, with ${exactNumber(1_234)} commits.`,
    );
  });

  it('describes languages by their shares of the code', () => {
    expect(
      languagesDescription([
        { name: 'TypeScript', share: 0.624 },
        { name: 'JavaScript', share: 0.201 },
      ]),
    ).toBe(
      `TypeScript has the largest share of the code, ${percent(0.624)}, then JavaScript, ` +
        `${percent(0.201)}.`,
    );
    expect(languagesDescription([{ name: 'Rust', share: 1 }])).toBe('All of the code is in Rust.');
    expect(languagesDescription([{ name: 'Rust', share: 0.9 }])).toBe(
      `${percent(0.9)} of the code is in Rust.`,
    );
  });

  it('describes the contributors chart, to the default branch if known', () => {
    expect(contributorsDescription(10, 'main')).toBe(
      'The 10 most active contributors to main, by commits.',
    );
    expect(contributorsDescription(1_000, undefined)).toBe(
      `The ${exactNumber(1_000)} most active contributors, by commits.`,
    );
  });

  it('names what an issue or pull request is, and its state', () => {
    expect(issueLabel({ kind: 'issue', state: 'closed' } as never)).toBe('Issue, closed');
    expect(issueLabel({ kind: 'pull_request', state: 'merged' } as never)).toBe(
      'Pull request, merged',
    );
  });

  it('describes issues and pull requests by state', () => {
    expect(issuesDescription(12_345, 4)).toBe(`Issues: ${exactNumber(12_345)} open, 4 closed.`);
    expect(pullRequestsDescription(3, 5, 1)).toBe(
      'Pull requests: 3 open, 5 merged, 1 closed without merging.',
    );
  });

  it('counts the releases besides the latest', () => {
    expect([moreReleases(1), moreReleases(41), moreReleases(1_234)]).toEqual([
      '+ 1 release',
      '+ 41 releases',
      `+ ${exactNumber(1_234)} releases`,
    ]);
  });

  it('describes how pull requests came to an end, over those read (FR-REPO-13)', () => {
    const day = 24 * 60 * 60;
    expect(
      mergeVelocityDescription({
        sampled: 100,
        merged: 61,
        closed: 9,
        medianTimeToMerge: 2 * day,
        truncated: true,
      }),
    ).toBe(
      `Of the 100 pull requests updated last, 61 were merged, in a median of ${duration(2 * day)}, ` +
        'and 9 were closed without merging.',
    );
    expect(
      mergeVelocityDescription({
        sampled: 2,
        merged: 1,
        closed: 1,
        medianTimeToMerge: 3_600,
        truncated: false,
      }),
    ).toBe(
      `Of its 2 pull requests, 1 was merged, in ${duration(3_600)}, and 1 was closed without merging.`,
    );
    expect(
      mergeVelocityDescription({
        sampled: 1,
        merged: 0,
        closed: 1,
        medianTimeToMerge: undefined,
        truncated: false,
      }),
    ).toBe('Of its 1 pull request, 0 were merged, and 1 was closed without merging.');
  });

  it('describes how long open issues have been open, over those read (FR-REPO-13)', () => {
    const age = 66 * 24 * 60 * 60;
    expect(issueAgeDescription({ sampled: 37, medianAge: age, truncated: true })).toBe(
      `The 37 open issues updated last have been open for a median of ${duration(age)}.`,
    );
    expect(issueAgeDescription({ sampled: 1, medianAge: age, truncated: false })).toBe(
      `Its 1 open issue has been open for ${duration(age)}.`,
    );
  });

  it('describes how workflow runs fared, with their pass rate and duration (FR-REPO-14)', () => {
    const runs = {
      branch: 'main',
      sampled: 50,
      passed: 45,
      failed: 3,
      averageDuration: 252,
      latest: undefined,
      hidden: false,
    };
    expect(workflowRunsDescription(runs)).toBe(
      `Of the 50 latest workflow runs for pushes to main, 45 passed and 3 failed: a pass rate of ` +
        `${percent(45 / 48)}. Those completed took ${duration(252)} on average.`,
    );
    expect(
      workflowRunsDescription({
        ...runs,
        branch: undefined,
        sampled: 1,
        passed: 0,
        failed: 0,
        averageDuration: undefined,
      }),
    ).toBe('Of the latest workflow run for pushes to the default branch, 0 passed and 0 failed.');
  });

  it('describes the code frequency, its busiest week first among equals, and its branch (FR-REPO-15)', () => {
    const week = (day: number, additions: number, deletions: number) => ({
      start: new Date(Date.UTC(2026, 9, day)),
      additions,
      deletions,
    });
    const weeks = [week(4, 10, 5), week(11, 5, 10), week(18, 1, 0)];
    expect(
      codeFrequencyDescription({ weeks, additions: 16, deletions: 15, tooLarge: false }, 'main'),
    ).toBe(
      '16 lines added and 15 deleted on main in the last 52 weeks. The week with the most ' +
        `changes was that of ${weekDate(weeks[0].start)}, with 10 added and 5 deleted.`,
    );
    expect(
      codeFrequencyDescription(
        { weeks: [week(4, 1_234, 0)], additions: 1_234, deletions: 0, tooLarge: false },
        undefined,
      ),
    ).toBe(
      `${exactNumber(1_234)} lines added and 0 deleted in the last 52 weeks. The week with the ` +
        `most changes was that of ${weekDate(weeks[0].start)}, with ${exactNumber(1_234)} added ` +
        'and 0 deleted.',
    );
  });

  it('describes how often releases come, and how often they were downloaded (FR-REPO-16)', () => {
    const day = 24 * 60 * 60;
    expect(
      releaseCadenceDescription({
        sampled: 100,
        stable: 80,
        prereleases: 20,
        averageInterval: 12 * day,
        assets: 240,
        downloads: 123_456,
        truncated: true,
      }),
    ).toBe(
      `Of the 100 latest releases, 80 are stable and 20 are pre-releases, one every ` +
        `${duration(12 * day)} on average. Their files were downloaded ${exactNumber(123_456)} times.`,
    );
    expect(
      releaseCadenceDescription({
        sampled: 2,
        stable: 1,
        prereleases: 1,
        averageInterval: day,
        assets: 1,
        downloads: 1,
        truncated: false,
      }),
    ).toBe(
      `Of its 2 releases, 1 is stable and 1 is a pre-release, one every ${duration(day)} on ` +
        'average. Their files were downloaded once.',
    );
    expect(
      releaseCadenceDescription({
        sampled: 1,
        stable: 1,
        prereleases: 0,
        averageInterval: undefined,
        assets: 1,
        downloads: 0,
        truncated: false,
      }),
    ).toBe(
      'Of its one release, 1 is stable and 0 are pre-releases. Its files were downloaded 0 times.',
    );
    expect(
      releaseCadenceDescription({
        sampled: 3,
        stable: 3,
        prereleases: 0,
        averageInterval: day,
        assets: 0,
        downloads: 0,
        truncated: false,
      }),
    ).toBe(
      `Of its 3 releases, 3 are stable and 0 are pre-releases, one every ${duration(day)} on ` +
        'average. None of them has files attached.',
    );
  });

  it('says what the time between releases is of (FR-REPO-16)', () => {
    const cadence = {
      sampled: 100,
      stable: 100,
      prereleases: 0,
      averageInterval: 60,
      assets: 0,
      downloads: 0,
      truncated: true,
    };
    expect(onAverageOf(cadence)).toBe('on average, of the 100 latest');
    expect(onAverageOf({ ...cadence, sampled: 7, truncated: false })).toBe(
      'on average, of all releases',
    );
  });
});

describe('trends messages', () => {
  const observation = (at: string, stars: number, openIssues: number): Observation => ({
    day: new Date(`${at.slice(0, 10)}T00:00:00Z`),
    observedAt: new Date(at),
    pullRequestsObservedAt: new Date(at),
    figures: { stars, forks: 10, openIssues, openPullRequests: 7 },
  });
  const from = observation('2026-11-02T10:00:00Z', 100, 50);
  const to = observation('2026-11-09T09:00:00Z', 112, 44);
  const told = {
    days: 7,
    firstDay: new Date('2026-11-02T00:00:00Z'),
    observedDays: 3,
    target: new Date('2026-11-02T09:00:00Z'),
  };
  const supported: Period = {
    ...told,
    supported: true,
    from,
    to,
    changes: { stars: 12, forks: 0, openIssues: -6, openPullRequests: 0 },
  };
  const observed = `Observed on 3 of the 8 days from ${utcDay(told.firstDay)} to ${utcDay(to.day)}.`;

  it('tells what changed between which observations, and on how many days (FR-REPO-17)', () => {
    expect(trendsDescription(supported, to, from.observedAt)).toBe(
      `Between ${exactTime(from.observedAt)} and ${exactTime(to.observedAt)}, stars went from ` +
        '100 to 112 (+12), forks stayed at 10, open issues went from 50 to 44 (-6) and open ' +
        `pull requests stayed at 7. ${observed}`,
    );
  });

  it('says why a period has no change, never that it is zero', () => {
    const without = (reason: 'first_observation' | 'tracked_later' | 'no_observation_then') =>
      ({ ...told, supported: false, reason }) as Period;
    expect(trendsDescription(without('first_observation'), to, to.observedAt)).toBe(
      `There is no earlier observation to compare with yet. ${observed}`,
    );
    expect(unsupportedReason('tracked_later', without('tracked_later'), from.observedAt)).toBe(
      `BuhTig began recording on ${utcDay(from.observedAt)}, after this period began, so it ` +
        'cannot tell the change over 7 days.',
    );
    expect(
      unsupportedReason('no_observation_then', without('no_observation_then'), from.observedAt),
    ).toBe(`BuhTig has no observation from around ${utcDay(told.target)} to compare with.`);
    expect(noBaseline(to)).toBe(
      `BuhTig began recording this repository's figures on ${exactTime(to.observedAt)}. It has ` +
        'no earlier figures, so there is nothing to compare yet. Changes show once it has ' +
        'observed the repository on another day.',
    );
  });

  it('counts the days of a period from its first, its baseline if that is earlier', () => {
    const month: Period = {
      ...supported,
      days: 30,
      firstDay: new Date('2026-10-08T00:00:00Z'),
    };
    expect(trendsDescription(month, to, from.observedAt)).toContain(
      `Observed on 3 of the 33 days from ${utcDay(month.firstDay!)} to ${utcDay(to.day)}.`,
    );
  });

  it('describes each chart, with the days not observed (NFR-UX-04)', () => {
    expect(trendChartDescription('stars', [100, null, 112])).toBe(
      'Stars, from 100 to 112, observed on 2 of 3 days, with days not observed between.',
    );
    expect(trendChartDescription('openIssues', [5, 5])).toBe(
      'Open issues, from 5 to 5, observed on 2 of 2 days.',
    );
    expect(trendChartDescription('forks', [null])).toBe('Forks: not observed in this period.');
  });

  it('compares the commits of whole weeks (FR-REPO-18)', () => {
    const weeks = (from: string, to: string, commits: number) => ({
      from: new Date(`${from}T00:00:00Z`),
      to: new Date(`${to}T00:00:00Z`),
      commits,
    });
    expect(
      commitComparison({
        weeks: 4,
        recent: weeks('2026-10-04', '2026-10-31', 34),
        before: weeks('2026-09-06', '2026-10-03', 1),
      }),
    ).toBe(
      `34 commits in the 4 weeks from ${weekDate(new Date('2026-10-04T00:00:00Z'))} to ` +
        `${weekDate(new Date('2026-10-31T00:00:00Z'))}, and 1 in the 4 weeks before.`,
    );
    expect(
      commitComparison({
        weeks: 1,
        recent: weeks('2026-10-25', '2026-10-31', 1),
        before: weeks('2026-10-18', '2026-10-24', 0),
      }),
    ).toBe(
      `1 commit in the week from ${weekDate(new Date('2026-10-25T00:00:00Z'))} to ` +
        `${weekDate(new Date('2026-10-31T00:00:00Z'))}, and 0 in the week before.`,
    );
  });
});
