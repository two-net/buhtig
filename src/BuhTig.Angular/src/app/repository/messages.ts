// What a repository's widgets say in sentences, kept apart from their logic so that it can be
// translated (NFR-UX-07).

import { CommitActivity, Week } from '../dashboard/resources';
import { exactNumber, weekDate } from '../format/format';

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

/** NFR-UX-04: the commit-activity chart in a sentence, for assistive technology. */
export function activityDescription(activity: CommitActivity): string {
  const busiest = activity.weeks.reduce((busiest, week) =>
    week.commits > busiest.commits ? week : busiest,
  );
  return (
    `${commits(activity.total)} in the last year. The busiest week was that of ` +
    `${weekDate(busiest.start)}, with ${commits(busiest.commits)}.`
  );
}

/** FR-REPO-05: GitHub does not list the contributors of its largest repositories. */
export const TOO_MANY_CONTRIBUTORS =
  "GitHub doesn't list the contributors of repositories this large.";
