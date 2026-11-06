import { fuzzy, segments } from './fuzzy';

/** The names that `query` matches, best first, as the palette ranks them. */
function ranked(query: string, names: string[]): string[] {
  return names
    .map((name) => ({ name, match: fuzzy(query, name) }))
    .filter(({ match }) => match !== undefined)
    .sort((a, b) => b.match!.score - a.match!.score)
    .map(({ name }) => name);
}

describe('fuzzy (FR-SRCH-12)', () => {
  it('matches what has the characters of the query in their order, whatever their case', () => {
    expect(fuzzy('AXM', 'tokio-rs/axum')?.matches).toEqual([9, 10, 12]);
    expect(fuzzy('xa', 'tokio-rs/axum')).toBeUndefined();
    expect(fuzzy('axumm', 'tokio-rs/axum')).toBeUndefined();
  });

  it('matches everything with an empty query, and nothing of it', () => {
    expect(fuzzy('', 'tokio-rs/axum')).toEqual({ score: 0, matches: [] });
  });

  it('ranks the name itself first, then the name of a repository or its owner', () => {
    expect(ranked('rust', ['rust-lang/rust-analyzer', 'rust-lang/rust', 'rust'])).toEqual([
      'rust',
      'rust-lang/rust',
      'rust-lang/rust-analyzer',
    ]);
    expect(fuzzy('rust', 'rust-lang/rust')?.matches).toEqual([10, 11, 12, 13]);
    expect(fuzzy('tokio-rs', 'tokio-rs/axum')?.matches).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("ranks a repository's name that starts with the query above a name that does", () => {
    expect(ranked('ax', ['axios/axios-docs', 'tokio-rs/axum'])).toEqual([
      'tokio-rs/axum',
      'axios/axios-docs',
    ]);
  });

  it('ranks the query at the start of a word above the query within one', () => {
    expect(ranked('lang', ['golang/go', 'rust-lang/rust'])).toEqual([
      'rust-lang/rust',
      'golang/go',
    ]);
    expect(fuzzy('lang', 'golang/lang-tools')?.matches).toEqual([7, 8, 9, 10]);
  });

  it('ranks the query in one piece above its characters scattered', () => {
    expect(ranked('ana', ['angular/angular', 'rust-lang/rust-analyzer'])).toEqual([
      'rust-lang/rust-analyzer',
      'angular/angular',
    ]);
  });

  it('prefers starts of words, and characters next to each other, when scattered', () => {
    expect(fuzzy('ra', 'rust-lang/rust-analyzer')?.matches).toEqual([0, 15]);
    expect(ranked('ra', ['rerxa/x', 'rust-lang/rust-analyzer'])).toEqual([
      'rust-lang/rust-analyzer',
      'rerxa/x',
    ]);
  });

  it('finds scattered characters where starts of words would leave too few', () => {
    expect(fuzzy('ab', 'xa-b-a')?.matches).toEqual([1, 3]);
    expect(fuzzy('aab', 'xaa-b')?.matches).toEqual([1, 2, 4]);
  });
});

describe('segments', () => {
  it('cuts a name into runs of matched and unmatched characters', () => {
    expect(segments('tokio-rs/axum', [9, 10, 12])).toEqual([
      { text: 'tokio-rs/', hit: false },
      { text: 'ax', hit: true },
      { text: 'u', hit: false },
      { text: 'm', hit: true },
    ]);
    expect(segments('axum', [])).toEqual([{ text: 'axum', hit: false }]);
    expect(segments('', [])).toEqual([]);
  });
});
