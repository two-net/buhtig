import { Glance } from '../dashboard/resources';
import { runBadge } from '../repository/workflows';

/**
 * How the viewer may sort a watchlist's rows for this visit (FR-PERS-12): in its saved order, by
 * name, by last push, by the latest release's date, by the latest workflow run, failing ones
 * first, or by stars.
 */
export const ROW_SORTS = ['saved', 'name', 'pushed', 'release', 'run', 'stars'] as const;
export type RowSort = (typeof ROW_SORTS)[number];

/** Whether `value` is a way to sort a watchlist's rows. */
export function isRowSort(value: string): value is RowSort {
  return (ROW_SORTS as readonly string[]).includes(value);
}

/**
 * The repositories `names` of a watchlist, in its saved order, as its rows show them sorted by
 * `sort`, of what `loaded` says they show (FR-PERS-12). A row that has not loaded keeps its place
 * in the saved order, and the rows that have take the other places, sorted, so that a row joins
 * the sort as it loads. Rows that tie keep the order of their names, and the saved order is never
 * changed.
 */
export function sortRows(
  names: readonly string[],
  loaded: (name: string) => Glance | undefined,
  sort: RowSort,
): string[] {
  if (sort === 'saved') {
    return [...names];
  }
  const sorted = names
    .flatMap((name) => {
      const glance = loaded(name);
      return glance ? [{ name, glance }] : [];
    })
    .sort((a, b) => compare(a.glance, b.glance, sort) || byName(a.glance, b.glance));
  let next = 0;
  return names.map((name) => (loaded(name) ? sorted[next++].name : name));
}

/** The order of `a` and `b` by `sort`: what is unknown, as a date or a figure, last. */
function compare(a: Glance, b: Glance, sort: Exclude<RowSort, 'saved'>): number {
  switch (sort) {
    case 'name':
      return 0;
    case 'pushed':
      return newestFirst(a.repository.pushedAt, b.repository.pushedAt);
    case 'release':
      return newestFirst(releasedAt(a), releasedAt(b));
    case 'run':
      return runRank(a) - runRank(b) || newestFirst(runAt(a), runAt(b));
    case 'stars':
      return mostFirst(a.stars, b.stars);
  }
}

function byName(a: Glance, b: Glance): number {
  return a.repository.name.localeCompare(b.repository.name, 'en', { sensitivity: 'base' });
}

function newestFirst(a: Date | undefined, b: Date | undefined): number {
  return mostFirst(a?.getTime(), b?.getTime());
}

function mostFirst(a: number | undefined, b: number | undefined): number {
  return (b ?? -Infinity) - (a ?? -Infinity) || 0;
}

function releasedAt(glance: Glance): Date | undefined {
  return glance.latestRelease.ok ? glance.latestRelease.release?.publishedAt : undefined;
}

/** The latest workflow run on the default branch, if the row shows one. */
function latestRun(glance: Glance) {
  const runs = glance.workflowRuns;
  return runs.ok && !runs.hidden ? runs.latest : undefined;
}

function runAt(glance: Glance): Date | undefined {
  return latestRun(glance)?.startedAt;
}

/** Where a row goes by its latest run: failing first, then any other run, then none. */
function runRank(glance: Glance): number {
  const run = latestRun(glance);
  if (run === undefined) {
    return 2;
  }
  return runBadge(run).tone === 'danger' ? 0 : 1;
}
