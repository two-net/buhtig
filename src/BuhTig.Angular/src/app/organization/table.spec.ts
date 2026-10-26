import { ListedRepository } from '../dashboard/resources';
import { DEFAULT_SORT, NO_FILTER, PAGE_SIZE, languagesOf, matches, pageOf, sorted } from './table';

function repository(name: string, details: Partial<ListedRepository> = {}): ListedRepository {
  return {
    name,
    path: `/acme/${name}`,
    description: undefined,
    language: undefined,
    stars: 0,
    forks: 0,
    openIssuesAndPullRequests: 0,
    pushedAt: undefined,
    fork: false,
    archived: false,
    visibility: 'public',
    ...details,
  };
}

const names = (repositories: ListedRepository[]) => repositories.map(({ name }) => name);

describe('matches', () => {
  const widget = repository('Widget', { language: 'Rust' });
  const fork = repository('gadget', { fork: true });
  const archived = repository('sprocket', { archived: true });
  const archivedFork = repository('cog', { fork: true, archived: true });
  const all = [widget, fork, archived, archivedFork];

  it('lets every repository through to begin with', () => {
    expect(all.filter((repository) => matches(repository, NO_FILTER))).toEqual(all);
  });

  it('finds names that hold the text, whatever its letter case', () => {
    const named = (name: string) => names(all.filter((r) => matches(r, { ...NO_FILTER, name })));
    expect(named('dge')).toEqual(['Widget', 'gadget']);
    expect(named('WIDG')).toEqual(['Widget']);
    expect(named('  get ')).toEqual(['Widget', 'gadget']);
    expect(named('rust')).toEqual([]);
  });

  it('keeps the repositories of a language', () => {
    expect(all.filter((r) => matches(r, { ...NO_FILTER, language: 'Rust' }))).toEqual([widget]);
    expect(all.filter((r) => matches(r, { ...NO_FILTER, language: 'Go' }))).toEqual([]);
  });

  it('tells sources, forks and archived repositories apart, as GitHub does', () => {
    const of = (type: 'sources' | 'forks' | 'archived') =>
      names(all.filter((r) => matches(r, { ...NO_FILTER, type })));
    expect(of('sources')).toEqual(['Widget', 'sprocket']);
    expect(of('forks')).toEqual(['gadget', 'cog']);
    expect(of('archived')).toEqual(['sprocket', 'cog']);
  });

  it('lets through only what passes every filter', () => {
    expect(
      all.filter((r) => matches(r, { name: 'o', language: undefined, type: 'archived' })),
    ).toEqual([archived, archivedFork]);
    expect(all.filter((r) => matches(r, { name: 'w', language: 'Rust', type: 'forks' }))).toEqual(
      [],
    );
  });
});

describe('sorted', () => {
  const a = repository('a', {
    stars: 10,
    forks: 1,
    openIssuesAndPullRequests: 5,
    pushedAt: new Date('2026-10-01T00:00:00Z'),
  });
  const b = repository('b', {
    stars: 30,
    forks: 1,
    openIssuesAndPullRequests: 0,
    pushedAt: new Date('2026-10-20T00:00:00Z'),
  });
  const c = repository('c', { stars: 20, forks: 3, openIssuesAndPullRequests: 9 });

  it('puts the repositories pushed to most recently first to begin with', () => {
    expect(names(sorted([c, a, b], DEFAULT_SORT))).toEqual(['b', 'a', 'c']);
  });

  it('sorts by each figure, either way', () => {
    expect(names(sorted([a, b, c], { column: 'stars', direction: 'descending' }))).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(names(sorted([a, b, c], { column: 'stars', direction: 'ascending' }))).toEqual([
      'a',
      'c',
      'b',
    ]);
    expect(names(sorted([a, b, c], { column: 'issues', direction: 'descending' }))).toEqual([
      'c',
      'a',
      'b',
    ]);
    // A repository never pushed to is the oldest.
    expect(names(sorted([a, b, c], { column: 'pushed', direction: 'ascending' }))).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('sorts those with the same figure by name, whichever way', () => {
    for (const direction of ['ascending', 'descending'] as const) {
      expect(names(sorted([c, b, a], { column: 'forks', direction })).slice(0, 2)).toEqual(
        direction === 'ascending' ? ['a', 'b'] : ['c', 'a'],
      );
    }
  });

  it('leaves the list it was given as it was', () => {
    const list = [a, b, c];
    sorted(list, { column: 'stars', direction: 'descending' });
    expect(names(list)).toEqual(['a', 'b', 'c']);
  });
});

describe('languagesOf', () => {
  it('names each language once, by name, and not the lack of one', () => {
    expect(
      languagesOf([
        repository('a', { language: 'TypeScript' }),
        repository('b', { language: 'Go' }),
        repository('c'),
        repository('d', { language: 'TypeScript' }),
        repository('e', { language: 'C' }),
      ]),
    ).toEqual(['C', 'Go', 'TypeScript']);
  });
});

describe('pageOf', () => {
  const many = Array.from({ length: 60 }, (_, i) => repository(`r${i}`));

  it(`shows ${PAGE_SIZE} repositories a page (FR-ORG-03)`, () => {
    expect(PAGE_SIZE).toBe(25);
    const first = pageOf(many, 0);
    expect(first.repositories).toEqual(many.slice(0, 25));
    expect([first.index, first.first, first.last, first.count]).toEqual([0, 1, 25, 3]);
    const last = pageOf(many, 2);
    expect(last.repositories).toEqual(many.slice(50));
    expect([last.index, last.first, last.last, last.count]).toEqual([2, 51, 60, 3]);
  });

  it('shows the nearest page there is', () => {
    expect(pageOf(many, 7).index).toBe(2);
    expect(pageOf(many, -1).index).toBe(0);
    expect(pageOf(many.slice(0, 25), 1).count).toBe(1);
  });

  it('has one page, an empty one, when there are no repositories', () => {
    const page = pageOf([], 0);
    expect([page.repositories, page.index, page.count]).toEqual([[], 0, 1]);
  });
});
