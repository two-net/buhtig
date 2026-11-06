import { exactNumber, percent } from '../format/format';
import {
  activityComparison,
  asMany,
  bothSides,
  lastPushComparison,
  moreThan,
  newerThan,
  sideCreated,
  sideLanguages,
} from './messages';

describe('compare messages (NFR-UX-07)', () => {
  it('says which has more of a figure, in one or many', () => {
    expect(moreThan('stars', 'a/b', 1, 'c/d')).toBe('a/b has 1 more star than c/d.');
    expect(moreThan('openPullRequests', 'a/b', 4_100, 'c/d')).toBe(
      `a/b has ${exactNumber(4_100)} more open pull requests than c/d.`,
    );
    expect(asMany('forks', 'a/b', 'c/d')).toBe('a/b and c/d have as many forks.');
  });

  it('says which latest release is newer, and by how much', () => {
    expect(newerThan('a/b', '2 months', 'c/d')).toBe(
      "a/b's latest release is 2 months newer than c/d's.",
    );
  });

  it('says how many commits each repository made (NFR-UX-04)', () => {
    expect(
      activityComparison('a/b', { weeks: [], total: 1 }, 'c/d', { weeks: [], total: 1_234 }),
    ).toBe(
      `In the last 52 weeks, a/b made 1 commit to its default branch, and c/d ${exactNumber(1_234)}.`,
    );
  });

  it('says what language has the largest share of each, or that one has none (NFR-UX-04)', () => {
    expect(
      bothSides(
        sideLanguages('repository', 'a/b', { name: 'Rust', share: 0.624 }),
        sideLanguages('repository', 'c/d', undefined),
      ),
    ).toBe(
      `Rust is ${percent(0.624)} of a/b's code. c/d has no code in a language GitHub detects.`,
    );
    expect(sideLanguages('account', 'acme', { name: 'Go', share: 0.5 })).toBe(
      `Go is the primary language of ${percent(0.5)} of acme's repositories`,
    );
    expect(sideLanguages('account', 'mona', undefined)).toBe(
      "None of mona's repositories has a primary language",
    );
  });

  it('says how many repositories of each were pushed to lately, and created since when', () => {
    const pushes = { last7Days: 1, last30Days: 0, last12Months: 0, older: 0 };
    expect(lastPushComparison('acme', pushes, 'mona', { ...pushes, last7Days: 0 })).toBe(
      "1 of acme's repositories and 0 of mona's were pushed to in the last 7 days.",
    );
    expect(
      sideCreated('acme', [
        { year: 2019, repositories: 1 },
        { year: 2021, repositories: 2 },
      ]),
    ).toBe('acme created 3 repositories since 2019');
    expect(sideCreated('mona', [])).toBe('mona has no repositories yet');
  });
});
