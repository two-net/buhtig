import { duration, exactNumber, percent, weekDate } from '../format/format';
import {
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
});
