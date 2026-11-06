import { Sources, Suggestion, suggest } from './suggest';

const SOURCES: Sources = {
  pins: [
    { kind: 'repository', name: 'tokio-rs/axum' },
    { kind: 'organization', name: 'rust-lang' },
  ],
  recent: [
    { kind: 'user', name: 'mona' },
    { kind: 'repository', name: 'Tokio-rs/Axum' },
    { kind: 'repository', name: 'rust-lang/rust' },
  ],
  opened: [
    { name: 'angular/angular', ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/1' },
    { name: 'rust-lang/rust' },
  ],
};

/** What the palette lists for `query`, as `name (source)` or `name › tab (source)`. */
function listed(query: string, sources = SOURCES): string[] {
  return suggest(query, sources).items.map(
    (item: Suggestion) =>
      `${item.name}${item.tabLabel ? ` › ${item.tabLabel}` : ''} (${item.source})`,
  );
}

function first(query: string): Suggestion {
  return suggest(query, SOURCES).items[0];
}

describe('suggest (FR-SRCH-12)', () => {
  it('lists the pins, then what the user viewed, then what was opened here, each once', () => {
    expect(listed('')).toEqual([
      'tokio-rs/axum (pinned)',
      'rust-lang (pinned)',
      'mona (recent)',
      'rust-lang/rust (recent)',
      'angular/angular (opened)',
    ]);
    expect(listed('   ')).toEqual(listed(''));
  });

  it('lists what was opened here alone for a visitor (FR-SRCH-11)', () => {
    expect(listed('', { pins: [], recent: [], opened: SOURCES.opened })).toEqual([
      'angular/angular (opened)',
      'rust-lang/rust (opened)',
    ]);
  });

  it('opens each at its dashboard', () => {
    expect(suggest('', SOURCES).items.map((item) => item.path)).toEqual([
      '/tokio-rs/axum',
      '/rust-lang',
      '/mona',
      '/rust-lang/rust',
      '/angular/angular',
    ]);
  });

  it("keeps the owner's avatar of what was opened here", () => {
    expect(suggest('angular', SOURCES).items[0].avatar).toBe(
      'https://avatars.githubusercontent.com/u/1',
    );
  });

  it('ranks what matches the query best first, and what the query names last', () => {
    expect(listed('rust')).toEqual([
      'rust-lang/rust (recent)',
      'rust-lang (pinned)',
      'rust (typed)',
    ]);
    expect(first('ax')).toMatchObject({ name: 'tokio-rs/axum', matches: [9, 10] });
    expect(listed('mna')).toEqual(['mona (recent)', 'mna (typed)']);
  });

  it('names what the query names once, when the user has it already', () => {
    expect(listed('mona')).toEqual(['mona (recent)']);
    expect(listed('RUST-LANG')).toEqual(['rust-lang (pinned)', 'rust-lang/rust (recent)']);
  });

  it('puts a repository or a URL that the query names first, so that Enter opens it', () => {
    expect(listed('o/r')).toEqual(['o/r (typed)']);
    expect(listed('rust/x')[0]).toBe('rust/x (typed)');
    expect(listed('https://github.com/rust-lang/rust/pull/1')[0]).toBe('rust-lang/rust (recent)');
    expect(listed('github.com/tokio-rs/axum')).toEqual(['tokio-rs/axum (pinned)']);
    expect(first('git@github.com:Owner/Repo.git')).toMatchObject({
      name: 'Owner/Repo',
      source: 'typed',
      path: '/Owner/Repo',
    });
  });

  it('turns each into its tabs of the name after the query (FR-SRCH-13)', () => {
    expect(listed('axum pulls')).toEqual(['tokio-rs/axum › Pull requests (pinned)']);
    expect(first('axum pulls').path).toBe('/tokio-rs/axum/pulls');
    expect(listed('rust re')).toEqual([
      'rust-lang/rust › Releases (recent)',
      'rust-lang › Repositories (pinned)',
      'rust › Repositories (typed)',
    ]);
    expect(listed('rust-lang/rust co')).toEqual([
      'rust-lang/rust › Activity (recent)',
      'rust-lang/rust › Contributors (recent)',
    ]);
    expect(listed('org people')).toEqual(['org › People (typed)']);
    expect(first('org people').path).toBe('/orgs/org/people');
  });

  it('tells rows apart, tabs too', () => {
    const keys = suggest('rust-lang/rust co', SOURCES).items.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('says why what the user typed opens nothing, when nothing matches it either', () => {
    expect(suggest('gitlab.com/x/y', SOURCES)).toEqual({
      items: [],
      problem: 'BuhTig supports github.com URLs only.',
    });
    expect(suggest('owner/repo people', SOURCES).problem).toContain(
      "“people” is not a tab of a repository's dashboard.",
    );
  });

  it('says nothing is wrong while the query is the beginning of a URL', () => {
    expect(suggest('https://github.c', SOURCES)).toEqual({ items: [] });
  });
});
