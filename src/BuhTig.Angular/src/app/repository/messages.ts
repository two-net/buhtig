// What a repository's widgets say in sentences, kept apart from their logic so that it can be
// translated (NFR-UX-07).

import { CommitActivity, IssueOrPullRequest, Week } from '../dashboard/resources';
import { exactNumber, percent, weekDate } from '../format/format';

/** "commit" or "commits", as a count of them, such as 12, takes. */
export function commitsLabel(count: number): string {
  return count === 1 ? 'commit' : 'commits';
}

/** A count of commits in full, such as "1,234 commits". */
function commits(count: number): string {
  return `${exactNumber(count)} ${commitsLabel(count)}`;
}

/** FR-REPO-03: what the commit-activity chart shows in all, until a week is pointed at. */
export function activityTotal(activity: CommitActivity): string {
  return `${commits(activity.total)} in the last year`;
}

/** FR-REPO-03: one week of the commit-activity chart, such as "Week of Oct 26, 2025: 12 commits". */
export function weekSummary(week: Week): string {
  return `Week of ${weekDate(week.start)}: ${commits(week.commits)}`;
}

/** NFR-UX-04: what the commit-activity chart is, as assistive technology names it. */
export const ACTIVITY_CHART = 'Commits per week';

/** NFR-UX-04: the headers of the commit-activity chart's table, of its weeks and their commits. */
export const ACTIVITY_HEADERS = ['Week of', 'Commits'] as const;

/** NFR-UX-04: the commit-activity chart in a sentence. */
export function activityDescription(activity: CommitActivity): string {
  const busiest = activity.weeks.reduce((busiest, week) =>
    week.commits > busiest.commits ? week : busiest,
  );
  return (
    `${commits(activity.total)} in the last year. The busiest week was that of ` +
    `${weekDate(busiest.start)}, with ${commits(busiest.commits)}.`
  );
}

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

/** FR-REPO-05: GitHub does not list the contributors of its largest repositories. */
export const TOO_MANY_CONTRIBUTORS =
  "GitHub doesn't list the contributors of repositories this large.";

/** FR-REPO-06: what an issue or pull request is, and its state, such as "Merged pull request". */
export function issueLabel({ kind, state }: IssueOrPullRequest): string {
  if (kind === 'issue') {
    return state === 'open' ? 'Open issue' : 'Closed issue';
  }
  return {
    open: 'Open pull request',
    merged: 'Merged pull request',
    closed: 'Closed pull request',
  }[state];
}

/** FR-REPO-06: issues or pull requests that a repository has turned off on GitHub. */
export const TURNED_OFF = 'Turned off';

/** FR-REPO-07: a commit whose message is empty. */
export const NO_MESSAGE = 'No message';

/** FR-REPO-08: a release that GitHub marks as a pre-release. */
export const PRERELEASE = 'Pre-release';
