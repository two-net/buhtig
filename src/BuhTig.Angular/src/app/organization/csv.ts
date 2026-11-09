import { Covered, LastPush, ListedRepository } from '../dashboard/resources';
import { CsvExport } from '../export/csv';
import { ACCOUNT_COLUMNS, accountCells, exportName } from '../export/provenance';

/**
 * The columns of a repository list's CSV file (FR-EXP-01): each repository's place in the list as
 * shown, its name as `owner/repo`, what the list shows of it, exactly, then the account, what the
 * list covers and when it was fetched (FR-EXP-04). Topics are one cell, apart by spaces, which no
 * topic has.
 */
export const LIST_COLUMNS = [
  'position',
  'repository',
  'description',
  'language',
  'topics',
  'visibility',
  'fork',
  'archived',
  'stars',
  'forks',
  'open_issues_and_pull_requests',
  'pushed_at',
  ...ACCOUNT_COLUMNS,
] as const;

/**
 * The CSV file of the repositories of the account `login` that a list shows, `repositories`, all
 * of them, from every page, in the order shown, of a list that covers what `list` says.
 */
export function listCsv(
  login: string,
  repositories: readonly ListedRepository[],
  list: Partial<Covered<object>>,
): CsvExport {
  const provenance = accountCells(login, list);
  return {
    name: exportName(login, 'repositories'),
    columns: LIST_COLUMNS,
    rows: repositories.map((repository, index) => [
      index + 1,
      `${login}/${repository.name}`,
      repository.description,
      repository.language,
      repository.topics.join(' '),
      repository.visibility,
      repository.fork,
      repository.archived,
      repository.stars,
      repository.forks,
      repository.openIssuesAndPullRequests,
      repository.pushedAt,
      ...provenance,
    ]),
  };
}

/** Each period of the last-push chart, as a CSV file names it, the same in every language. */
export const PERIOD_KEYS: Record<keyof LastPush, string> = {
  last7Days: 'last_7_days',
  last30Days: 'last_30_days',
  last12Months: 'last_12_months',
  older: 'older',
};
