import { Glance, Stale } from '../dashboard/resources';

/**
 * When the oldest of the data that a watchlist's row shows of `glance` was fetched (FR-DATA-06,
 * FR-EXP-04): the repository's, its latest release's or its workflow runs', which may each have
 * been fetched at another time.
 */
export function oldestFetch(glance: Glance): Date | undefined {
  const times = [
    glance.fetchedAt,
    glance.latestRelease.ok ? glance.latestRelease.fetchedAt : undefined,
    glance.workflowRuns.ok ? glance.workflowRuns.fetchedAt : undefined,
  ].flatMap((time) => (time ? [time.getTime()] : []));
  return times.length > 0 ? new Date(Math.min(...times)) : undefined;
}

/**
 * Why some of what a watchlist's row shows of `glance` is saved data, if any is (FR-DATA-05,
 * FR-EXP-04): `held` if any part is held back, else `github` if GitHub failed for any part.
 */
export function staleOf(glance: Glance): Stale | undefined {
  const stales = [
    glance.stale,
    glance.latestRelease.ok ? glance.latestRelease.stale : undefined,
    glance.workflowRuns.ok ? glance.workflowRuns.stale : undefined,
  ];
  return stales.includes('held') ? 'held' : stales.find((stale) => stale !== undefined);
}
