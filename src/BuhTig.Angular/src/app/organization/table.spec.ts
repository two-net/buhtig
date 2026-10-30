import { ListedRepository } from '../dashboard/resources';
import {
  NO_FILTER,
  PAGE_SIZE,
  RepositoryType,
  languagesOf,
  matches,
  pageOf,
  pagesAround,
  sorted,
} from './table';

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
    topics: [],
    ...details,
  };
}

const names = (repositories: ListedRepository[]) => repositories.map(({ name }) => name);

describe('matches', () => {
  const widget = repository('Widget', { language: 'Rust' });
  const fork = repository('gadget', { fork: true });
  const archived = repository('sprocket', { archived: true, visibility: 'private' });
  const archivedFork = repository('cog', { fork: true, archived: true, visibility: 'internal' });
  const all = [widget, fork, archived, archivedFork];

  it('lets every repository through to begin with', () => {
    expect(all.filter((repository) => matches(repository, NO_FILTER))).toEqual(all);
  });

  it('finds names that hold the text, whatever its letter case', () => {
    const named = (name: string) => names(all.filter((r) => matches(r, { ...NO_FILTER, name })));
    expect(named('dge')).toEqual(['Widget', 'gadget']);
    expect(named('WIDG')).toEqual(['Widget']);
    expect(named('  get ')).toEqual(['Widget', 'gadget']);
    // Not the language, nor anything else.
    expect(named('rust')).toEqual([]);
  });

  it('keeps the repositories of a language', () => {
    expect(all.filter((r) => matches(r, { ...NO_FILTER, language: 'Rust' }))).toEqual([widget]);
    expect(all.filter((r) => matches(r, { ...NO_FILTER, language: 'Go' }))).toEqual([]);
  });

  it('tells sources, forks and archived repositories apart, as GitHub does', () => {
    const of = (type: RepositoryType) =>
      names(all.filter((r) => matches(r, { ...NO_FILTER, type })));
    expect(of('sources')).toEqual(['Widget', 'sprocket']);
    expect(of('forks')).toEqual(['gadget', 'cog']);
    expect(of('archived')).toEqual(['sprocket', 'cog']);
  });

  it('tells public repositories from private and internal ones (FR-ORG-09)', () => {
    const of = (type: RepositoryType) =>
      names(all.filter((r) => matches(r, { ...NO_FILTER, type })));
    expect(of('public')).toEqual(['Widget', 'gadget']);
    expect(of('private')).toEqual(['sprocket', 'cog']);
    expect(of('all')).toEqual(['Widget', 'gadget', 'sprocket', 'cog']);
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
  const a = repository('a', { stars: 10, pushedAt: new Date('2026-10-01T00:00:00Z') });
  const b = repository('b', { stars: 30, pushedAt: new Date('2026-10-20T00:00:00Z') });
  const c = repository('c', { stars: 20 });

  it('puts the repositories pushed to most recently first, and those never pushed to last', () => {
    expect(names(sorted([c, a, b], 'pushed'))).toEqual(['b', 'a', 'c']);
  });

  it('sorts by name', () => {
    expect(names(sorted([c, a, b], 'name'))).toEqual(['a', 'b', 'c']);
  });

  it('puts the repositories with the most stars first', () => {
    expect(names(sorted([a, b, c], 'stars'))).toEqual(['b', 'c', 'a']);
  });

  it('sorts those with the same figure by name', () => {
    const d = repository('d', { stars: 20 });
    const e = repository('e', { pushedAt: new Date('2026-10-20T00:00:00Z') });
    expect(names(sorted([d, a, c, b], 'stars'))).toEqual(['b', 'c', 'd', 'a']);
    expect(names(sorted([e, b, a], 'pushed'))).toEqual(['b', 'e', 'a']);
    // Two never pushed to, too.
    expect(names(sorted([d, c], 'pushed'))).toEqual(['c', 'd']);
  });

  it('leaves the list it was given as it was', () => {
    const list = [a, b, c];
    sorted(list, 'stars');
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

  it('names none when no repository has a language', () => {
    expect(languagesOf([repository('a'), repository('b')])).toEqual([]);
    expect(languagesOf([])).toEqual([]);
  });
});

describe('pageOf', () => {
  const many = Array.from({ length: 60 }, (_, i) => repository(`r${i}`));

  it(`shows ${PAGE_SIZE} repositories a page (FR-ORG-03)`, () => {
    expect(PAGE_SIZE).toBe(25);
    const first = pageOf(many, 0);
    expect(first.repositories).toEqual(many.slice(0, 25));
    expect([first.index, first.count]).toEqual([0, 3]);
    const middle = pageOf(many, 1);
    expect(middle.repositories).toEqual(many.slice(25, 50));
    const last = pageOf(many, 2);
    expect(last.repositories).toEqual(many.slice(50));
    expect([last.index, last.count]).toEqual([2, 3]);
  });

  it('shows the nearest page there is', () => {
    expect(pageOf(many, 7).index).toBe(2);
    expect(pageOf(many, 7).repositories).toEqual(many.slice(50));
    expect(pageOf(many, -1).index).toBe(0);
    expect(pageOf(many.slice(0, 25), 1).count).toBe(1);
    expect(pageOf(many.slice(0, 26), 1).repositories).toEqual([many[25]]);
  });

  it('has one page, an empty one, when there are no repositories', () => {
    const page = pageOf([], 0);
    expect([page.repositories, page.index, page.count]).toEqual([[], 0, 1]);
  });
});

describe('pagesAround', () => {
  it('offers every page when there are few', () => {
    expect(pagesAround(0, 1)).toEqual([0]);
    expect(pagesAround(0, 3)).toEqual([0, 1, 2]);
    expect(pagesAround(1, 4)).toEqual([0, 1, 2, 3]);
  });

  it('offers the first and the last, and those next to the page shown, with gaps between', () => {
    expect(pagesAround(0, 10)).toEqual([0, 1, 'gap', 9]);
    expect(pagesAround(5, 10)).toEqual([0, 'gap', 4, 5, 6, 'gap', 9]);
    expect(pagesAround(9, 10)).toEqual([0, 'gap', 8, 9]);
  });

  it('puts a gap where a single page is left out too', () => {
    expect(pagesAround(3, 7)).toEqual([0, 'gap', 2, 3, 4, 'gap', 6]);
    expect(pagesAround(2, 7)).toEqual([0, 1, 2, 3, 'gap', 6]);
  });
});
