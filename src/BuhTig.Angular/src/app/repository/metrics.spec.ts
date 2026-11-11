import { Contributor } from '../dashboard/resources';
import { commitShare } from './metrics';

/** Contributors who made `commits` each, in that order. */
function made(...commits: number[]): Contributor[] {
  return commits.map((count, index) => ({
    login: `author-${index + 1}`,
    avatarUrl: undefined,
    url: undefined,
    commits: count,
  }));
}

describe('commitShare (FR-REPO-05)', () => {
  it('is one of two who share the commits evenly, as half is enough', () => {
    expect(commitShare(made(50, 50))).toEqual({ few: 1, listed: 2, made: 50, total: 100 });
  });

  it('is one, when one made at least half the commits', () => {
    expect(commitShare(made(640, 100, 60))).toEqual({ few: 1, listed: 3, made: 640, total: 800 });
    expect(commitShare(made(400, 300, 100))).toEqual({ few: 1, listed: 3, made: 400, total: 800 });
  });

  it('is as few as made at least half the commits together, most first', () => {
    expect(commitShare(made(300, 200, 150, 100, 50))).toEqual({
      few: 2,
      listed: 5,
      made: 500,
      total: 800,
    });
    expect(commitShare(made(390, 250, 60, 40, 20, 15, 10, 8, 5, 2))).toEqual({
      few: 2,
      listed: 10,
      made: 640,
      total: 800,
    });
    // However GitHub ordered them.
    expect(commitShare(made(50, 100, 150, 200, 300))).toEqual({
      few: 2,
      listed: 5,
      made: 500,
      total: 800,
    });
    // Even ones need more than half of them.
    expect(commitShare(made(10, 10, 10, 10))).toEqual({ few: 2, listed: 4, made: 20, total: 40 });
    expect(commitShare(made(10, 10, 10))).toEqual({ few: 2, listed: 3, made: 20, total: 30 });
  });

  it('is nothing for a single listed author', () => {
    expect(commitShare(made(1_000))).toBeUndefined();
  });

  it('is nothing when GitHub lists none, as for its largest repositories', () => {
    expect(commitShare([])).toBeUndefined();
  });

  it('counts only the authors listed with a count of commits', () => {
    expect(commitShare(made(0, 0))).toBeUndefined();
    expect(commitShare(made(100, 0))).toBeUndefined();
    expect(commitShare(made(100, 0, 100))).toEqual({ few: 1, listed: 2, made: 100, total: 200 });
  });
});
