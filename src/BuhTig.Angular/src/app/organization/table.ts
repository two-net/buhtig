import { ListedRepository } from '../dashboard/resources';

/** How many repositories the repository list shows at once (FR-ORG-03). */
export const PAGE_SIZE = 25;

/**
 * The kinds of repository that the list can be filtered to, as GitHub tells them apart: sources
 * are those that are not forks, and archived ones are among either. Private and internal ones
 * are only a token user's (FR-ORG-09).
 */
export type RepositoryType = 'all' | 'public' | 'private' | 'sources' | 'forks' | 'archived';

/** What the list can be filtered by (FR-ORG-03). */
export interface Filter {
  /** Text that the names must hold, whatever its letter case. */
  name: string;
  /** The primary language that the repositories must have, unless any will do. */
  language: string | undefined;
  type: RepositoryType;
}

/** The list as it starts, with every repository. */
export const NO_FILTER: Filter = { name: '', language: undefined, type: 'all' };

/** The orders of the list: pushed to last first, by name, or most stars first (FR-ORG-03). */
export type Sort = 'pushed' | 'name' | 'stars';

/** One page of the list. */
export interface Page {
  repositories: ListedRepository[];
  /** Which page it is, from 0. */
  index: number;
  /** How many pages there are, at least one. */
  count: number;
}

/** Whether `repository` is one that `filter` lets through. */
export function matches(repository: ListedRepository, filter: Filter): boolean {
  return (
    repository.name.toLowerCase().includes(filter.name.trim().toLowerCase()) &&
    (filter.language === undefined || repository.language === filter.language) &&
    isOfType(repository, filter.type)
  );
}

/** `repositories` in the order of `sort`, those with the same figure by name. */
export function sorted(repositories: ListedRepository[], sort: Sort): ListedRepository[] {
  return [...repositories].sort((a, b) => {
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'stars':
        return b.stars - a.stars || a.name.localeCompare(b.name);
      case 'pushed':
        return (
          (b.pushedAt?.getTime() ?? -Infinity) - (a.pushedAt?.getTime() ?? -Infinity) ||
          a.name.localeCompare(b.name)
        );
    }
  });
}

/** The primary languages of `repositories`, each once, by name. */
export function languagesOf(repositories: ListedRepository[]): string[] {
  const languages = new Set(repositories.flatMap(({ language }) => language ?? []));
  return [...languages].sort((a, b) => a.localeCompare(b));
}

/** The page at `index` of `repositories`, or the nearest there is. */
export function pageOf(repositories: ListedRepository[], index: number): Page {
  const count = Math.max(1, Math.ceil(repositories.length / PAGE_SIZE));
  const shown = Math.min(Math.max(index, 0), count - 1);
  const start = shown * PAGE_SIZE;
  return { repositories: repositories.slice(start, start + PAGE_SIZE), index: shown, count };
}

/**
 * The pages that the pager offers, from 0, around the page at `index` of `count`: the first and
 * the last, and those next to it, with `gap` where pages are left out between.
 */
export function pagesAround(index: number, count: number): (number | 'gap')[] {
  const pages: (number | 'gap')[] = [];
  for (let page = 0; page < count; page++) {
    if (page === 0 || page === count - 1 || Math.abs(page - index) <= 1) {
      pages.push(page);
    } else if (pages[pages.length - 1] !== 'gap') {
      pages.push('gap');
    }
  }
  return pages;
}

function isOfType(repository: ListedRepository, type: RepositoryType): boolean {
  switch (type) {
    case 'all':
      return true;
    case 'public':
      return repository.visibility === 'public';
    case 'private':
      return repository.visibility !== 'public';
    case 'sources':
      return !repository.fork;
    case 'forks':
      return repository.fork;
    case 'archived':
      return repository.archived;
  }
}
