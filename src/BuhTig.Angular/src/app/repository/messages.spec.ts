import { exactNumber, percent, weekDate } from '../format/format';
import {
  activityDescription,
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
});
