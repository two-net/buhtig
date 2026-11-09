// How a repository's maintenance figures are made from what the server tells (FR-REPO-13,
// FR-REPO-14, FR-REPO-16), and when there is nothing to make them of: one definition, for its
// dashboard and for a comparison of it with another (FR-CMP-06).

import { IssueAge, MergeVelocity, ReleaseCadence, WorkflowRuns } from '../dashboard/resources';

/**
 * FR-REPO-13: the merge ratio, the share of the pull requests that ended that were merged, unless
 * none ended.
 */
export function mergeRatio({ merged, closed }: MergeVelocity): number | undefined {
  return merged + closed > 0 ? merged / (merged + closed) : undefined;
}

/** FR-REPO-13: whether no pull request was merged or closed, which leaves nothing to measure. */
export function nothingMerged(velocity: MergeVelocity): boolean {
  return velocity.merged + velocity.closed === 0;
}

/** FR-REPO-13: whether there are no open issues to age. */
export function nothingOpen(age: IssueAge): boolean {
  return age.medianAge === undefined;
}

/**
 * FR-REPO-14: the pass rate, the share of the workflow runs that passed or failed that passed,
 * unless none did either, as when all were cancelled or skipped.
 */
export function passRate({ passed, failed }: WorkflowRuns): number | undefined {
  return passed + failed > 0 ? passed / (passed + failed) : undefined;
}

/**
 * FR-REPO-14: whether there are no workflow runs to tell of: none for pushes to the default
 * branch, or none that GitHub would list to the viewer's credential.
 */
export function nothingRun(runs: WorkflowRuns): boolean {
  return runs.hidden || runs.sampled === 0;
}

/** FR-REPO-16: whether the repository has published no release. */
export function nothingReleased(cadence: ReleaseCadence): boolean {
  return cadence.sampled === 0;
}
