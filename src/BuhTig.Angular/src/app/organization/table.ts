import { ListedRepository } from '../dashboard/resources';

/** How many repositories the repository table shows at once (FR-ORG-03). */
export const PAGE_SIZE = 25;

/**
 * The kinds of repository that the table can be filtered to, as GitHub tells them apart:
 * sources are those that are not forks, and archived ones are among either.
 */
export type RepositoryType = 'all' | 'sources' | 'forks' | 'archived';

/** What the table can be filtered by (FR-ORG-03). */
export interface Filter {
  /** Text that the names must hold, whatever its letter case. */
  name: string;
  /** The primary language that the repositories must have, unless any will do. */
  language: string | undefined;
  type: RepositoryType;
}

/** The table as it starts, with every repository. */
export const NO_FILTER: Filter = { name: '', language: undefined, type: 'all' };

/** The columns that the table can be sorted by: each numeric and date column (FR-ORG-03). */
export type SortColumn = 'stars' | 'forks' | 'issues' | 'pushed';

/** An order of the table, its direction as `aria-sort` names it. */
export interface Sort {
  column: SortColumn;
  direction: 'ascending' | 'descending';
}

/** The order the table starts in, as GitHub gives the repositories: pushed to most recently first. */
export const DEFAULT_SORT: Sort = { column: 'pushed', direction: 'descending' };

/** One page of the table. */
export interface Page {
  repositories: ListedRepository[];
  /** Which page it is, from 0. */
  index: number;
  /** Where its first and last repositories are among all, from 1. */
  first: number;
  last: number;
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
  const sign = sort.direction === 'ascending' ? 1 : -1;
  return [...repositories].sort(
    (a, b) =>
      sign * compare(figure(a, sort.column), figure(b, sort.column)) ||
      a.name.localeCompare(b.name),
  );
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
  const page = repositories.slice(start, start + PAGE_SIZE);
  return {
    repositories: page,
    index: shown,
    first: start + 1,
    last: start + page.length,
    count,
  };
}

function isOfType(repository: ListedRepository, type: RepositoryType): boolean {
  switch (type) {
    case 'all':
      return true;
    case 'sources':
      return !repository.fork;
    case 'forks':
      return repository.fork;
    case 'archived':
      return repository.archived;
  }
}

/** The figure of `repository` in `column`. A repository never pushed to is the oldest. */
function figure(repository: ListedRepository, column: SortColumn): number {
  switch (column) {
    case 'stars':
      return repository.stars;
    case 'forks':
      return repository.forks;
    case 'issues':
      return repository.openIssuesAndPullRequests;
    case 'pushed':
      return repository.pushedAt?.getTime() ?? -Infinity;
  }
}

function compare(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
