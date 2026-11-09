// What a comparison of two repositories or two accounts says, kept apart from its logic so that
// it can be translated (NFR-UX-07). Each message says what is wrong and what to do instead
// (NFR-UX-06).

import { CommitActivity, LastPush, YearCount } from '../dashboard/resources';
import { exactNumber, percent } from '../format/format';
import { repositoryCount } from '../organization/messages';
import { STABLE, commitsLabel } from '../repository/messages';
import { Compared } from './route';

/** UI-04: a comparison's title, after its two resources' names, such as "a/b vs c/d · BuhTig". */
export function comparisonTitle(first: string, second: string): string {
  return `${first} vs ${second} · BuhTig`;
}

/** The breadcrumb of a comparison, and the button that starts one. */
export const COMPARE = 'Compare';

/** What stands between the two resources' names, as in the page's heading. */
export const VS = 'vs';

/** FR-CMP-02: the action in a dashboard's head that compares its resource with another. */
export const COMPARE_WITH = 'Compare with…';

/** FR-CMP-02: the heading of the dialog that asks what to compare `name` with. */
export function compareHeading(name: string): string {
  return `Compare ${name} with…`;
}

/** FR-CMP-02: what the dialog's input takes, for each kind of resource compared. */
export const COMPARE_LABELS: Record<Compared, string> = {
  repository: 'Repository URL or owner/repo',
  account: 'Organization or user URL or name',
};

/** FR-CMP-02: what the dialog's input says while it is empty, with GitHub at `host`. */
export function comparePlaceholder(kind: Compared, host: string): string {
  return kind === 'repository' ? `${host}/owner/repo` : `${host}/owner`;
}

/** FR-CMP-02: a resource of another kind than the one compared, with GitHub at `host`. */
export function anotherKind(kind: Compared, host: string): string {
  return kind === 'repository'
    ? `Enter a repository, such as ${host}/owner/repo. A repository compares with another repository.`
    : `Enter an organization or a user, such as ${host}/owner. An account compares with another account.`;
}

/** FR-CMP-02: the resource itself, which there is no comparing with. */
export function sameResource(name: string): string {
  return `That's ${name} itself. Enter another to compare it with.`;
}

export const CANCEL = 'Cancel';

/** NFR-UX-02: a comparison that has loaded. */
export function comparisonLoaded(first: string, second: string): string {
  return `${first} and ${second} loaded.`;
}

/** What each side's value is of, for assistive technology, such as "acme/widget: ". */
export function sideOf(name: string): string {
  return `${name}: `;
}

/** FR-CMP-03: the heading of the stat cards. */
export const OVERVIEW = 'Overview';

/**
 * FR-CMP-03: what each stat card counts, as its label, and as a sentence says one and more of
 * it.
 */
export const FIGURES = {
  stars: { label: 'Stars', one: 'star', many: 'stars' },
  forks: { label: 'Forks', one: 'fork', many: 'forks' },
  watchers: { label: 'Watching', one: 'watcher', many: 'watchers' },
  openIssues: { label: 'Open issues', one: 'open issue', many: 'open issues' },
  openPullRequests: {
    label: 'Open pull requests',
    one: 'open pull request',
    many: 'open pull requests',
  },
  repositories: { label: 'Repositories', one: 'repository', many: 'repositories' },
  openIssuesAndPullRequests: {
    label: 'Open issues and pull requests',
    one: 'open issue or pull request',
    many: 'open issues and pull requests',
  },
  stableReleases: { label: STABLE, one: 'stable release', many: 'stable releases' },
} as const;

export type Figure = keyof typeof FIGURES;

/** FR-CMP-03: the stat cards that are no count. */
export const LATEST_RELEASE = 'Latest release';
export const TOP_LANGUAGE = 'Top language';

/** FR-CMP-03: a resource without a release, or a language. */
export const NONE = 'None';

/** FR-CMP-03: two figures that are the same. */
export const SAME = 'Same';

/**
 * FR-CMP-03: by how much `more` has more of `figure` than `fewer`, for assistive technology,
 * such as "acme/widget has 4,100 more stars than acme/gadget."
 */
export function moreThan(figure: Figure, more: string, by: number, fewer: string): string {
  const { one, many } = FIGURES[figure];
  return `${more} has ${exactNumber(by)} more ${by === 1 ? one : many} than ${fewer}.`;
}

/** FR-CMP-03: two figures that are the same, for assistive technology. */
export function asMany(figure: Figure, first: string, second: string): string {
  return `${first} and ${second} have as many ${FIGURES[figure].many}.`;
}

/** FR-CMP-03: how much newer one latest release is than the other's, such as "2 months newer". */
export function newer(span: string): string {
  return `${span} newer`;
}

/** FR-CMP-03: how much newer one latest release is, for assistive technology. */
export function newerThan(newer: string, span: string, older: string): string {
  return `${newer}'s latest release is ${span} newer than ${older}'s.`;
}

/** FR-CMP-03: two latest releases of the same day, for assistive technology. */
export function sameDay(first: string, second: string): string {
  return `${first} and ${second} published their latest releases the same day.`;
}

/** FR-CMP-03: two accounts whose repositories most often have the same primary language. */
export function sameLanguage(first: string, second: string, language: string): string {
  return `${language} is the top language of both ${first} and ${second}.`;
}

/** FR-CMP-04: the heading of the commit-activity charts. */
export const COMMIT_ACTIVITY = 'Commit activity';

/** FR-CMP-04: neither repository has commits in the last year. */
export const NO_COMMITS_EITHER =
  'Neither repository has commits to its default branch in the last year.';

/** A count of commits in full, such as "1,234 commits". */
function commits(count: number): string {
  return `${exactNumber(count)} ${commitsLabel(count)}`;
}

/** FR-CMP-04: a repository's commits in all, under its chart's name. */
export function commitTotal(total: number): string {
  return commits(total);
}

/** NFR-UX-04: one repository's commit-activity chart, for assistive technology. */
export function sideActivity(name: string, activity: CommitActivity): string {
  return `${name}: ${commits(activity.total)} in the last 52 weeks.`;
}

/**
 * NFR-UX-04: the two commit-activity charts in a sentence, such as "In the last 52 weeks,
 * acme/widget made 312 commits to its default branch, and acme/gadget 40."
 */
export function activityComparison(
  first: string,
  a: CommitActivity,
  second: string,
  b: CommitActivity,
): string {
  return (
    `In the last 52 weeks, ${first} made ${commits(a.total)} to its default branch, ` +
    `and ${second} ${exactNumber(b.total)}.`
  );
}

/** NFR-UX-04: the headers of a table of two resources' figures, after what each row is of. */
export function pairHeaders(row: string, first: string, second: string): [string, string, string] {
  return [row, first, second];
}

/** NFR-UX-04: what the rows of each chart's table are of. */
export const WEEK_OF = 'Week of';
export const LANGUAGE = 'Language';
export const YEAR = 'Year';

/** A week that one repository's chart has and the other's has not. */
export const NO_FIGURE = '—';

/** FR-CMP-04: the heading of the languages charts. */
export const LANGUAGES = 'Languages';

/** FR-CMP-04: the languages past those listed, together. */
export const OTHER = 'Other';

/** FR-CMP-04: a language one side lists and the other counts in "Other". */
export const IN_OTHER = 'In Other';

/** FR-CMP-04: neither side has a language GitHub detects. */
export const NO_LANGUAGES_EITHER: Record<Compared, string> = {
  repository: 'Neither repository has code in a language GitHub detects.',
  account: 'Neither account has a repository with a primary language.',
};

/** FR-CMP-04: one side without a language GitHub detects. */
export const NO_LANGUAGES: Record<Compared, string> = {
  repository: 'No code yet',
  account: 'No languages detected',
};

/**
 * NFR-UX-04: one side's languages in a few words, by its `top` language and its share, such as
 * "TypeScript is 62.4% of acme/widget's code", or what it has none of.
 */
export function sideLanguages(
  kind: Compared,
  name: string,
  top: { name: string; share: number } | undefined,
): string {
  if (top === undefined) {
    return kind === 'repository'
      ? `${name} has no code in a language GitHub detects`
      : `None of ${name}'s repositories has a primary language`;
  }
  return kind === 'repository'
    ? `${top.name} is ${percent(top.share)} of ${name}'s code`
    : `${top.name} is the primary language of ${percent(top.share)} of ${name}'s repositories`;
}

/**
 * NFR-UX-04: what a chart shows of both sides, in two sentences, from what is said of each, as
 * by `sideLanguages` or `sideCreated`.
 */
export function bothSides(first: string, second: string): string {
  return `${sentence(first)} ${sentence(second)}`;
}

/** NFR-UX-04: what a chart shows of one side, in a sentence, from what is said of it. */
export function sentence(clause: string): string {
  return `${clause}.`;
}

/** FR-CMP-04: the heading of the last-push charts, and of their table's rows. */
export const LAST_PUSH = 'Last push';

/** NFR-UX-04: one account's last-push chart, for assistive technology. */
export function sideLastPush(name: string): string {
  return `${name}: when each repository last received a push.`;
}

/**
 * NFR-UX-04: the two last-push charts in a sentence, such as "12 of acme's repositories and 3
 * of umbrella's were pushed to in the last 7 days."
 */
export function lastPushComparison(
  first: string,
  a: LastPush,
  second: string,
  b: LastPush,
): string {
  return (
    `${exactNumber(a.last7Days)} of ${first}'s repositories and ${exactNumber(b.last7Days)} ` +
    `of ${second}'s were pushed to in the last 7 days.`
  );
}

/** FR-CMP-04: the heading of the created-per-year charts. */
export const CREATED_PER_YEAR = 'Repositories created per year';

/** FR-CMP-04: neither account has a repository. */
export const NO_REPOSITORIES_EITHER = 'Neither account has repositories yet.';

/**
 * NFR-UX-04: one account's repositories created, in a few words, such as "acme created 312
 * repositories since 2010".
 */
export function sideCreated(name: string, years: YearCount[]): string {
  if (years.length === 0) {
    return `${name} has no repositories yet`;
  }
  const total = years.reduce((total, year) => total + year.repositories, 0);
  return `${name} created ${repositoryCount(total)} since ${years[0].year}`;
}

/**
 * FR-CMP-06: what each maintenance figure measures, as a sentence names it, such as "median time
 * to merge".
 */
export const MEASURES = {
  timeToMerge: 'median time to merge',
  mergeRatio: 'merge ratio',
  issueAge: 'median open issue age',
  passRate: 'pass rate',
  runDuration: 'average run duration',
  releaseInterval: 'average time between releases',
} as const;

export type Measure = keyof typeof MEASURES;

/** FR-CMP-06: by how much one span of time is longer than the other's, such as "2 days longer". */
export function longer(span: string): string {
  return `${span} longer`;
}

/**
 * FR-CMP-06: by how much one span of time is longer, for assistive technology, such as
 * "acme/widget's median time to merge is 2 days longer than acme/gadget's." Longer is neither
 * better nor worse.
 */
export function longerThan(
  measure: Measure,
  longer: string,
  span: string,
  shorter: string,
): string {
  return `${longer}'s ${MEASURES[measure]} is ${span} longer than ${shorter}'s.`;
}

/** FR-CMP-06: by how much one share is higher than the other, such as "12.5 points higher". */
export function pointsHigher(points: string): string {
  return `${points} points higher`;
}

/**
 * FR-CMP-06: by how much one share is higher, for assistive technology, such as "acme/widget's
 * merge ratio is 12.5 percentage points higher than acme/gadget's."
 */
export function higherThan(
  measure: Measure,
  higher: string,
  points: string,
  lower: string,
): string {
  return `${higher}'s ${MEASURES[measure]} is ${points} percentage points higher than ${lower}'s.`;
}

/** FR-CMP-06: two figures that show the same, for assistive technology. */
export function sameMeasure(measure: Measure, first: string, second: string): string {
  return `${first} and ${second} have the same ${MEASURES[measure]}.`;
}

/**
 * FR-CMP-06: what each section's figures are of, as samples of the latest items of each, rather
 * than of all that happened over a period of time.
 */
export const MERGES_SAMPLED =
  "Of each repository's 100 pull requests updated last: a sample of recent ones, not a count over a period of time.";
export const ISSUES_SAMPLED =
  "Of the open issues among each repository's 100 open issues and pull requests updated last: a sample of recent ones, not a count over a period of time.";
export const RUNS_SAMPLED =
  "Of each repository's 50 latest GitHub Actions workflow runs for pushes to its default branch: a sample of recent ones, not a count over a period of time.";
export const RELEASES_SAMPLED =
  "Of each repository's 100 latest releases, without drafts: a sample of recent ones, not a count over a period of time.";

/** FR-CMP-06: why one side has no figure, under where it would be, kept short. */
export const NONE_ENDED = 'None merged or closed';
export const NONE_MERGED = 'None merged';
export const NO_OPEN_ISSUES_SHORT = 'No open issues';
export const RUNS_HIDDEN_SHORT = 'Hidden from your token';
export const NO_RUNS_SHORT = 'No runs yet';
export const NONE_COMPLETED = 'None completed';
export const NO_RELEASES_SHORT = 'No releases yet';

/**
 * FR-CMP-06, FR-PAT-08: GitHub would not list one repository's workflow runs to the viewer's
 * token, and what to give the token.
 */
export function runsHidden(name: string): string {
  return `GitHub won't show ${name}'s workflow runs to your personal access token. Give it read access to Actions to see them here.`;
}

/** FR-CMP-06: neither repository has anything to measure in a section. */
export const NO_MERGES_EITHER =
  'Neither repository has merged or closed pull requests to measure yet.';
export const NO_OPEN_ISSUES_EITHER = 'Neither repository has open issues to measure.';
export const NO_RUNS_EITHER =
  'Neither repository has GitHub Actions workflow runs for pushes to its default branch yet.';
export const RUNS_HIDDEN_EITHER =
  "GitHub won't show either repository's workflow runs to your personal access token. Give it read access to Actions to see them here.";
export const NO_RELEASES_EITHER = 'Neither repository has published a release yet.';
