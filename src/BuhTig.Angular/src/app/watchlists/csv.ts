import { Glance } from '../dashboard/resources';
import { CsvExport } from '../export/csv';
import { FRESHNESS_COLUMNS, exportName } from '../export/provenance';
import { oldestFetch, staleOf } from './freshness';

/**
 * The columns of a watchlist's CSV file (FR-EXP-07): each repository as GitHub spells it, what its
 * row shows of it, exactly, then when the oldest part of the row was fetched, and why any part of
 * it is saved data, if one is (FR-EXP-04). The weekly commits stay on the sparkline: they are a
 * series, which the repository's own commit-activity file has.
 */
export const WATCHLIST_COLUMNS = [
  'repository',
  'description',
  'visibility',
  'fork',
  'archived',
  'stars',
  'latest_release',
  'latest_release_published_at',
  'pushed_at',
  'latest_run_conclusion',
  ...FRESHNESS_COLUMNS,
] as const;

/**
 * The CSV file of the watchlist `name`, of the rows it has loaded, `glances`, in the order they
 * are shown. A part of a row that failed to load leaves its cells empty.
 */
export function watchlistCsv(name: string, glances: readonly Glance[]): CsvExport {
  return {
    name: exportName(name, 'watchlist'),
    columns: WATCHLIST_COLUMNS,
    rows: glances.map((glance) => {
      const release = glance.latestRelease.ok ? glance.latestRelease.release : undefined;
      const runs = glance.workflowRuns;
      const run = runs.ok && !runs.hidden ? runs.latest : undefined;
      return [
        glance.repository.name,
        glance.repository.description,
        glance.repository.visibility,
        glance.repository.fork,
        glance.repository.archived,
        glance.stars,
        release?.tag,
        release?.publishedAt,
        glance.repository.pushedAt,
        run?.conclusion,
        oldestFetch(glance),
        staleOf(glance),
      ];
    }),
  };
}
