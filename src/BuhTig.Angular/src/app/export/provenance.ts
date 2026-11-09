import { Coverage, Covered, Freshness } from '../dashboard/resources';
import { Cell, CsvExport, isoDay } from './csv';

// What each CSV file says of where its data came from, in columns of every row, so that the
// file stays one table that any spreadsheet reads, and each row says it even once rows of
// several files are put together (FR-EXP-04).

/**
 * When the data was fetched from GitHub, in UTC, and, if it is saved data older than
 * `cache.ttl`, why: `github` when GitHub failed, `held` when BuhTig asks GitHub for no more for
 * visitors for now (FR-DATA-05). Empty when it is fresh.
 */
export const FRESHNESS_COLUMNS = ['fetched_at', 'stale'] as const;

/** The cells of `FRESHNESS_COLUMNS`, of data fetched as `freshness` says. */
export function freshnessCells(freshness: Partial<Freshness>): Cell[] {
  return [freshness.fetchedAt, freshness.stale];
}

/**
 * Of a figure of an organization's or a user's repositories: `all` of them, or the
 * `most_recently_pushed`, past `limits.org_repositories`, and how many BuhTig read (FR-ORG-08).
 */
export const COVERAGE_COLUMNS = ['coverage', 'repositories_read'] as const;

/** The cells of `COVERAGE_COLUMNS`, of a figure that covers what `coverage` says. */
export function coverageCells(coverage: Partial<Coverage>): Cell[] {
  const covers =
    coverage.truncated === undefined
      ? undefined
      : coverage.truncated
        ? 'most_recently_pushed'
        : 'all';
  return [covers, coverage.repositoriesRead];
}

/**
 * Of a figure of a repository: the repository, as `owner/repo` as GitHub spells it, and when its
 * data was fetched.
 */
export const REPOSITORY_COLUMNS = ['repository', ...FRESHNESS_COLUMNS] as const;

/** The cells of `REPOSITORY_COLUMNS`, of the repository `name` and data fetched as `dated` says. */
export function repositoryCells(name: string, dated: Partial<Freshness>): Cell[] {
  return [name, ...freshnessCells(dated)];
}

/**
 * Of a figure of a repository's default branch, such as its commits each week: the repository,
 * the branch, as far as the dashboard knows it, and when its data was fetched.
 */
export const BRANCH_COLUMNS = ['repository', 'default_branch', ...FRESHNESS_COLUMNS] as const;

/** The cells of `BRANCH_COLUMNS`, of the repository `name`, its `branch`, and `dated` data. */
export function branchCells(
  name: string,
  branch: string | undefined,
  dated: Partial<Freshness>,
): Cell[] {
  return [name, branch, ...freshnessCells(dated)];
}

/**
 * Of a figure of an organization's or a user's repositories: the account, as GitHub spells its
 * login, what the figure covers, and when its data was fetched.
 */
export const ACCOUNT_COLUMNS = ['account', ...COVERAGE_COLUMNS, ...FRESHNESS_COLUMNS] as const;

/** The cells of `ACCOUNT_COLUMNS`, of the account `login` and a figure `covered` so. */
export function accountCells(login: string, covered: Partial<Covered<object>>): Cell[] {
  return [login, ...coverageCells(covered), ...freshnessCells(covered)];
}

/** The page that a file was downloaded from, last in each row, for its data to be seen again. */
export const SOURCE_COLUMN = 'source_url';

/**
 * The start of a file's name, of `parts` such as `acme/widget` and `commit-activity`: each with
 * `/` as `-`, and anything but letters, digits, `.`, `_` and `-` as `-`, so that it is a name on
 * every system, and none hidden, as one starting with a dot is.
 */
export function exportName(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/[^A-Za-z0-9._-]/g, '-'))
    .join('-')
    .replace(/^[.-]+/, '');
}

/** The name of the file of `csv` downloaded at `now`, such as `acme-repositories-2026-11-09.csv`. */
export function csvFilename(csv: Pick<CsvExport, 'name'>, now: Date): string {
  return `${csv.name || 'buhtig'}-${isoDay(now)}.csv`;
}

/** `csv`, with the page it is downloaded from, `source`, last in each row. */
export function withSource(csv: CsvExport, source: string): CsvExport {
  return {
    ...csv,
    columns: [...csv.columns, SOURCE_COLUMN],
    rows: csv.rows.map((row) => [...row, source]),
  };
}
