// What a repository's dashboard says in sentences, kept apart from its logic so that it can be
// translated (NFR-UX-07).

import { CommitActivity, IssueOrPullRequest } from '../dashboard/resources';
import { exactNumber, percent, weekDate } from '../format/format';

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
