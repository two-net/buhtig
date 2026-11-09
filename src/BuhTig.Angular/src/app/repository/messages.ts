// What a repository's dashboard says in sentences, kept apart from its logic so that it can be
// translated (NFR-UX-07).

import {
  CodeFrequency,
  CommitActivity,
  IssueAge,
  IssueOrPullRequest,
  MergeVelocity,
  ReleaseCadence,
  WorkflowRuns,
} from '../dashboard/resources';
import { duration, exactNumber, percent, weekDate } from '../format/format';

/** "commit" or "commits", as a count of them, such as 12, takes. */
export function commitsLabel(count: number): string {
  return count === 1 ? 'commit' : 'commits';
}

/** A count of commits in full, such as "1,234 commits". */
function commits(count: number): string {
  return `${exactNumber(count)} ${commitsLabel(count)}`;
}

/** FR-REPO-03: one week of the commit-activity chart, such as "Week of Oct 26, 2025". */
export function weekOf(start: Date): string {
  return `Week of ${weekDate(start)}`;
}

/** NFR-UX-04: the headers of the commit-activity chart's table, of its weeks and their commits. */
export const ACTIVITY_HEADERS = ['Week of', 'Commits'] as const;

/**
 * NFR-UX-04: the commit-activity chart in a sentence, such as "312 commits to main in the last
 * 52 weeks. The busiest week was that of Oct 26, 2025, with 24 commits."
 */
export function activityDescription(activity: CommitActivity, branch: string | undefined): string {
  const busiest = activity.weeks.reduce((busiest, week) =>
    week.commits > busiest.commits ? week : busiest,
  );
  const to = branch ? ` to ${branch}` : '';
  return (
    `${commits(activity.total)}${to} in the last 52 weeks. The busiest week was that of ` +
    `${weekDate(busiest.start)}, with ${commits(busiest.commits)}.`
  );
}

/** FR-REPO-03, FR-REPO-11: no commits in the last year. */
export const NO_RECENT_COMMITS = 'No commits to the default branch in the last year.';
export const NO_RECENT_COMMITS_ARCHIVED =
  'No commits in the last year. This repository is archived.';

/** FR-REPO-07, FR-REPO-11 */
export const NO_COMMITS = 'No commits yet.';

/** FR-REPO-07: a commit whose message is empty. */
export const NO_MESSAGE = 'No message';

export const SEE_ACTIVITY = 'See recent activity';

/** FR-REPO-04: the languages past the 8 with the most code, together. */
export const OTHER = 'Other';

/** NFR-UX-04: the headers of the languages chart's table, of its languages and their shares. */
export const LANGUAGES_HEADERS = ['Language', 'Share'] as const;

/**
 * NFR-UX-04: the languages chart in a sentence, from its `languages` with the most code, most
 * first, each with its share of all the code, of 1. Such as "TypeScript has the largest share of
 * the code, 62.4%, then JavaScript, 20.1%."
 */
export function languagesDescription(languages: { name: string; share: number }[]): string {
  const [first, second] = languages;
  if (second !== undefined) {
    return (
      `${first.name} has the largest share of the code, ${percent(first.share)}, ` +
      `then ${second.name}, ${percent(second.share)}.`
    );
  }
  return first.share === 1
    ? `All of the code is in ${first.name}.`
    : `${percent(first.share)} of the code is in ${first.name}.`;
}

export const NO_CODE = 'No code yet';

/** FR-REPO-05: GitHub does not list the contributors of its largest repositories. */
export const TOO_MANY_CONTRIBUTORS =
  "GitHub doesn't list the contributors of repositories this large.";

export const NO_CONTRIBUTORS = 'No contributors yet.';

/** NFR-UX-04: the headers of the contributors chart's table. */
export const CONTRIBUTORS_HEADERS = ['Contributor', 'Commits'] as const;

/** NFR-UX-04: the contributors chart in a sentence. */
export function contributorsDescription(shown: number, branch: string | undefined): string {
  const to = branch ? ` to ${branch}` : '';
  return `The ${exactNumber(shown)} most active contributors${to}, by commits.`;
}

/** FR-REPO-06: what an issue or pull request is, and its state, such as "Pull request, merged". */
export function issueLabel({ kind, state }: IssueOrPullRequest): string {
  return `${kind === 'issue' ? 'Issue' : 'Pull request'}, ${state}`;
}

/** FR-REPO-06: the states of issues and pull requests, as their counts name them. */
export const STATES = { open: 'Open', closed: 'Closed', merged: 'Merged' } as const;

/** NFR-UX-04: the issues bar in a sentence. */
export function issuesDescription(open: number, closed: number): string {
  return `Issues: ${exactNumber(open)} open, ${exactNumber(closed)} closed.`;
}

/** NFR-UX-04: the pull requests bar in a sentence. */
export function pullRequestsDescription(open: number, merged: number, closed: number): string {
  return (
    `Pull requests: ${exactNumber(open)} open, ${exactNumber(merged)} merged, ` +
    `${exactNumber(closed)} closed without merging.`
  );
}

/** NFR-UX-04: the headers of the issues and pull requests charts' tables. */
export const STATE_HEADERS = ['State', 'Count'] as const;

/** FR-REPO-06, FR-REPO-11 */
export const NO_ISSUES_OR_PULL_REQUESTS = 'No issues or pull requests yet.';
export const NO_ISSUES = 'No issues yet.';
export const NO_PULL_REQUESTS = 'No pull requests yet.';
export const NOTHING_RECENT = 'Nothing recent to show.';

/** FR-REPO-06: issues or pull requests that a repository has turned off on GitHub. */
export const ISSUES_OFF = 'This repository has turned off issues.';
export const PULL_REQUESTS_OFF = 'This repository has turned off pull requests.';

export const ALL_ISSUES = 'All issues';
export const ALL_PULL_REQUESTS = 'All pull requests';

/** FR-REPO-08, FR-REPO-11 */
export const NO_RELEASES = 'No releases published yet.';

/** FR-REPO-08: the release that GitHub marks as the latest, and one that is a pre-release. */
export const LATEST = 'Latest';
export const PRERELEASE = 'Pre-release';

/** FR-REPO-08: how many releases there are besides the latest, such as "+ 12 releases". */
export function moreReleases(count: number): string {
  return `+ ${exactNumber(count)} ${count === 1 ? 'release' : 'releases'}`;
}

export const NO_DESCRIPTION = 'No description provided.';

/** "was" or "were", as a count, such as 12, takes. */
function was(count: number): string {
  return count === 1 ? 'was' : 'were';
}

/** A count of times, such as "once" or "1,234 times". */
function times(count: number): string {
  return count === 1 ? 'once' : `${exactNumber(count)} times`;
}

/** FR-REPO-13 to FR-REPO-16: a figure that cannot be told, as a median of nothing. */
export const NO_FIGURE = '—';

/** FR-REPO-13: the widget of how a repository's pull requests come to an end, and its figures. */
export const MERGE_VELOCITY = 'Merge velocity';
export const MEDIAN_TIME_TO_MERGE = 'Median time to merge';
export const MERGE_RATIO = 'Merge ratio';
export const NO_MERGES = 'No merged or closed pull requests to measure yet.';

/** FR-REPO-13: how many merged pull requests the median is of, such as "of 61 merged". */
export function ofMerged(count: number): string {
  return `of ${exactNumber(count)} merged`;
}

/** FR-REPO-13: how many of the pull requests were merged, and closed, such as "61 merged, 9 closed". */
export function mergedAndClosed(merged: number, closed: number): string {
  return `${exactNumber(merged)} merged, ${exactNumber(closed)} closed`;
}

/**
 * FR-REPO-13: the merge velocity in a sentence, such as "Of the 100 pull requests updated last,
 * 61 were merged, in a median of 2 days, and 9 were closed without merging."
 */
export function mergeVelocityDescription(velocity: MergeVelocity): string {
  const { sampled, merged, closed, medianTimeToMerge, truncated } = velocity;
  const of = truncated
    ? `Of the ${exactNumber(sampled)} pull requests updated last`
    : `Of its ${exactNumber(sampled)} ${sampled === 1 ? 'pull request' : 'pull requests'}`;
  const median =
    medianTimeToMerge === undefined
      ? ''
      : merged === 1
        ? `, in ${duration(medianTimeToMerge)}`
        : `, in a median of ${duration(medianTimeToMerge)}`;
  return (
    `${of}, ${exactNumber(merged)} ${was(merged)} merged${median}, and ` +
    `${exactNumber(closed)} ${was(closed)} closed without merging.`
  );
}

/** FR-REPO-13: the widget of how long a repository's open issues have been open, and its figure. */
export const ISSUE_AGE = 'Open issue age';
export const MEDIAN_AGE = 'Median age';
export const NO_OPEN_ISSUES = 'No open issues to measure.';

/** FR-REPO-13: how many open issues the age is of, such as "of 37 open issues". */
export function ofOpenIssues(count: number): string {
  return `of ${exactNumber(count)} open ${count === 1 ? 'issue' : 'issues'}`;
}

/**
 * FR-REPO-13: the open issues' age in a sentence, such as "The 37 open issues updated last have
 * been open for a median of 2.2 months."
 */
export function issueAgeDescription({ sampled, medianAge, truncated }: IssueAge): string {
  const issues = `${exactNumber(sampled)} open ${sampled === 1 ? 'issue' : 'issues'}`;
  const which = truncated ? `The ${issues} updated last` : `Its ${issues}`;
  const have = sampled === 1 ? 'has' : 'have';
  const age = medianAge === undefined ? '' : duration(medianAge);
  return sampled === 1
    ? `${which} ${have} been open for ${age}.`
    : `${which} ${have} been open for a median of ${age}.`;
}

/** FR-REPO-14: the widget of how a repository's workflow runs fare, and its figures. */
export const WORKFLOW_RUNS = 'Workflow runs';
export const PASS_RATE = 'Pass rate';
export const LATEST_RUN = 'Latest run';
export const AVERAGE_DURATION = 'Average duration';

/** FR-REPO-14: without runs for pushes to the default branch, `branch` if it is known. */
export function noRuns(branch: string | undefined): string {
  return `No GitHub Actions workflow runs for pushes to ${branch ?? 'the default branch'} yet.`;
}

/** FR-REPO-14, FR-PAT-08: GitHub would not list the runs to the viewer's token. */
export const RUNS_HIDDEN =
  "GitHub won't show this repository's workflow runs to your personal access token. Give it read access to Actions to see them here.";

/** FR-REPO-14: how many runs passed of those that passed or failed, such as "45 of 48 runs". */
export function passedOf(passed: number, failed: number): string {
  const ended = passed + failed;
  return `${exactNumber(passed)} of ${exactNumber(ended)} ${ended === 1 ? 'run' : 'runs'}`;
}

/** FR-REPO-14: no run passed or failed, as when all were cancelled or skipped. */
export const NO_PASS_RATE = 'None passed or failed';

/** FR-REPO-14: what the average duration is of. */
export const PER_COMPLETED_RUN = 'per completed run';

/**
 * FR-REPO-14: what a workflow run's state is called, with a word as well as a color
 * (NFR-UX-05).
 */
export const RUN_STATES = {
  passing: 'Passing',
  failing: 'Failing',
  queued: 'Queued',
  running: 'In progress',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  neutral: 'Neutral',
  waiting: 'Action required',
  stale: 'Stale',
  unknown: 'Unknown',
} as const;

/**
 * FR-REPO-14: how the workflow runs fared in a sentence, such as "Of the 50 latest workflow runs
 * for pushes to main, 45 passed and 3 failed: a pass rate of 93.8%. Those completed took 4.2
 * minutes on average."
 */
export function workflowRunsDescription(runs: WorkflowRuns): string {
  const { branch, sampled, passed, failed, averageDuration } = runs;
  const on = ` for pushes to ${branch ?? 'the default branch'}`;
  const which =
    sampled === 1
      ? `Of the latest workflow run${on}`
      : `Of the ${exactNumber(sampled)} latest workflow runs${on}`;
  const rate = passed + failed > 0 ? `: a pass rate of ${percent(passed / (passed + failed))}` : '';
  const took =
    averageDuration === undefined
      ? ''
      : ` Those completed took ${duration(averageDuration)} on average.`;
  return `${which}, ${exactNumber(passed)} passed and ${exactNumber(failed)} failed${rate}.` + took;
}

/** FR-REPO-15: the code frequency chart, and its lines up and down. */
export const CODE_FREQUENCY = 'Code frequency';
export const ADDITIONS = 'Additions';
export const DELETIONS = 'Deletions';
export const LINES_ADDED = 'lines added';
export const LINES_DELETED = 'lines deleted';

/** NFR-UX-04: the headers of the code frequency chart's table. */
export const CODE_FREQUENCY_HEADERS = ['Week of', 'Additions', 'Deletions'] as const;

/** FR-REPO-15, FR-REPO-11: no lines changed in the last year. */
export const NO_CHANGES = 'No changes to the default branch in the last year.';

/** FR-REPO-15: GitHub does not compute the code frequency of its largest repositories. */
export const TOO_MANY_COMMITS =
  "GitHub doesn't compute the code frequency of repositories with 10,000 commits or more.";

/**
 * NFR-UX-04: the code frequency chart in a sentence, such as "12,345 lines added and 6,789
 * deleted on main in the last 52 weeks. The week with the most changes was that of Oct 26, 2025,
 * with 1,234 added and 567 deleted."
 */
export function codeFrequencyDescription(
  frequency: CodeFrequency,
  branch: string | undefined,
): string {
  const busiest = frequency.weeks.reduce((busiest, week) =>
    week.additions + week.deletions > busiest.additions + busiest.deletions ? week : busiest,
  );
  const on = branch ? ` on ${branch}` : '';
  return (
    `${exactNumber(frequency.additions)} lines added and ${exactNumber(frequency.deletions)} ` +
    `deleted${on} in the last 52 weeks. The week with the most changes was that of ` +
    `${weekDate(busiest.start)}, with ${exactNumber(busiest.additions)} added and ` +
    `${exactNumber(busiest.deletions)} deleted.`
  );
}

/** FR-REPO-16: the widget of how often a repository is released, and its figures. */
export const RELEASE_CADENCE = 'Release cadence';
export const RELEASED_EVERY = 'Released every';
export const ON_AVERAGE = 'on average';
export const STABLE = 'Stable releases';
export const DOWNLOADS = 'Downloads';
export const OF_ALL_FILES = 'of all their files';
export const NO_FILES = 'No files attached';

/** FR-REPO-16: a single release has no cadence. */
export const ONE_RELEASE = 'Only one release';

/** FR-REPO-16: the pre-releases besides the stable releases, such as "and 20 pre-releases". */
export function andPrereleases(count: number): string {
  return `and ${exactNumber(count)} ${count === 1 ? 'pre-release' : 'pre-releases'}`;
}

/** FR-REPO-16: what the figures are of, such as "of the 100 latest". */
export function ofReleases({ sampled, truncated }: ReleaseCadence): string {
  return truncated ? `of the ${exactNumber(sampled)} latest` : 'of all releases';
}

/** FR-REPO-16: what the time between releases is, such as "on average, of the 100 latest". */
export function onAverageOf(cadence: ReleaseCadence): string {
  return `${ON_AVERAGE}, ${ofReleases(cadence)}`;
}

/**
 * FR-REPO-16: the release cadence in a sentence, such as "Of the 100 latest releases, 80 are
 * stable and 20 are pre-releases, one every 12 days on average. Their files were downloaded
 * 123,456 times." Releases without files say so, rather than that none was downloaded.
 */
export function releaseCadenceDescription(cadence: ReleaseCadence): string {
  const { sampled, stable, prereleases, averageInterval, assets, downloads, truncated } = cadence;
  const of = truncated
    ? `Of the ${exactNumber(sampled)} latest releases`
    : sampled === 1
      ? 'Of its one release'
      : `Of its ${exactNumber(sampled)} releases`;
  const are = (count: number) => (count === 1 ? 'is' : 'are');
  const kinds =
    `${exactNumber(stable)} ${are(stable)} stable and ${exactNumber(prereleases)} ` +
    `${prereleases === 1 ? 'is a pre-release' : 'are pre-releases'}`;
  const every =
    averageInterval === undefined ? '' : `, one every ${duration(averageInterval)} on average`;
  const files =
    assets === 0
      ? sampled === 1
        ? 'It has no files attached.'
        : 'None of them has files attached.'
      : `${sampled === 1 ? 'Its' : 'Their'} files were downloaded ${times(downloads)}.`;
  return `${of}, ${kinds}${every}. ${files}`;
}
