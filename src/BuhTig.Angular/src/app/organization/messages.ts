// What an organization's widgets say in sentences, kept apart from their logic so that it can
// be translated (NFR-UX-07).

import { LanguageCount, LastPush, YearCount } from '../dashboard/resources';
import { exactNumber } from '../format/format';

/** FR-ORG-02: an organization none of whose repositories has a primary language. */
export const NO_LANGUAGE = 'None';

/** "repository" or "repositories", as a count of them, such as 12, takes. */
export function repositoriesLabel(count: number): string {
  return count === 1 ? 'repository' : 'repositories';
}

/** A count of repositories in full, such as "312 repositories", as the table and charts say it. */
export function repositoryCount(count: number): string {
  return `${exactNumber(count)} ${repositoriesLabel(count)}`;
}

/** FR-ORG-04: the languages past the 8 of the most repositories, together. */
export const OTHER = 'Other';

/** NFR-UX-04: the headers of the languages chart's table. */
export const LANGUAGES_HEADERS = ['Language', 'Repositories'] as const;

/**
 * NFR-UX-04: the languages chart in a sentence, from the language of the most repositories and
 * the `total` that have a primary language. Such as "TypeScript is the most common primary
 * language, in 42 of the 120 repositories that have one."
 */
export function languagesDescription(top: LanguageCount, total: number): string {
  return (
    `${top.name} is the most common primary language, in ${exactNumber(top.repositories)} ` +
    `of the ${repositoryCount(total)} that have one.`
  );
}

/** NFR-UX-04: the headers of the top-repositories chart's table. */
export const TOP_REPOSITORIES_HEADERS = ['Repository', 'Stars'] as const;

/**
 * NFR-UX-04: the top-repositories chart in a sentence, from the repository with the most stars,
 * such as "widgets has the most stars, 12,345."
 */
export function topRepositoriesDescription(name: string, stars: number): string {
  return `${name} has the most stars, ${exactNumber(stars)}.`;
}

/**
 * FR-ORG-06: the periods of the last-push chart, each of the repositories pushed to within it
 * but not within the one before.
 */
export const LAST_PUSH: Record<keyof LastPush, string> = {
  last7Days: 'Last 7 days',
  last30Days: 'Last 30 days',
  last12Months: 'Last 12 months',
  older: 'Older',
};

/** NFR-UX-04: the headers of the last-push chart's table. */
export const LAST_PUSH_HEADERS = ['Last push', 'Repositories'] as const;

/** NFR-UX-04: the headers of the created-per-year chart's table. */
export const CREATED_HEADERS = ['Year', 'Repositories'] as const;

/**
 * FR-ORG-06: what the created-per-year chart shows in all, until a year is pointed at, such as
 * "312 repositories created since 2010".
 */
export function createdTotal(years: YearCount[]): string {
  const total = years.reduce((total, year) => total + year.repositories, 0);
  return `${repositoryCount(total)} created since ${years[0].year}`;
}

/** FR-ORG-06: one year of the created-per-year chart, as its tooltip says, such as "Created in 2019". */
export function createdIn(year: number): string {
  return `Created in ${year}`;
}

/** NFR-UX-04: the created-per-year chart in a sentence. */
export function createdDescription(years: YearCount[]): string {
  const busiest = years.reduce((busiest, year) =>
    year.repositories > busiest.repositories ? year : busiest,
  );
  return (
    `${createdTotal(years)}. The busiest year was ${busiest.year}, ` +
    `with ${repositoryCount(busiest.repositories)}.`
  );
}

/** FR-ORG-07: "member" or "members", as a count of them, such as 12, takes. */
export function membersLabel(count: number): string {
  return count === 1 ? 'member' : 'members';
}

/** FR-ORG-01: how many members the viewer may see, after the figure. */
export function membersLabelOf(count: number): string {
  return ` ${membersLabel(count)}`;
}

/** FR-ORG-01 */
export const ON_GITHUB_SINCE = 'On GitHub since';
export const VERIFIED = 'Verified';

/** FR-ORG-02: the private and internal repositories, which only a token user sees (FR-ORG-09). */
export function hiddenCount(count: number): string {
  return `${exactNumber(count)} private or internal`;
}
export const PUBLIC_ONLY = 'Public only';
export const VISIBLE_TO_YOU = 'Visible to you';

/** FR-ORG-08: whether the figures are of all the repositories, or of those pushed to last. */
export const ALL_REPOSITORIES = 'All repositories';
export function pushedLast(count: number): string {
  return `Most recently pushed ${exactNumber(count)}`;
}

/** FR-ORG-08: an organization with more repositories than BuhTig reads. */
export function truncated(name: string, count: number): string {
  return (
    `${name} has more than ${exactNumber(count)} repositories. Figures cover the ` +
    `${exactNumber(count)} most recently pushed.`
  );
}

export const POPULAR = 'Popular repositories';
export const RECENTLY_PUSHED = 'Recently pushed';
export const VIEW_ALL_REPOSITORIES = 'View all repositories';
export const NO_DESCRIPTION = 'No description provided.';
export const NO_REPOSITORIES = 'No repositories yet.';
export const NO_STARRED = 'No starred repositories yet.';
export const NO_LANGUAGES = 'No languages detected';
export const NO_MEMBERS = 'No members to show.';
export const VIEW_ALL = 'View all';
export const OPEN_ISSUES_AND_PULL_REQUESTS = 'Open issues and pull requests';

/** FR-ORG-06: what the last-push chart shows. */
export const LAST_PUSH_SUMMARY = 'When each repository last received a push.';

/** FR-ORG-07: the members past the 24 shown, which the viewer may see too. */
export function moreMembers(count: number): string {
  return `and ${exactNumber(count)} more ${membersLabel(count)} visible to you.`;
}

/** FR-ORG-03: the filters of the repository list. */
export const FIND_REPOSITORY = 'Find a repository…';
export const TYPES = {
  all: 'All',
  public: 'Public',
  private: 'Private and internal',
  sources: 'Sources',
  forks: 'Forks',
  archived: 'Archived',
} as const;
export const ALL_LANGUAGES = 'All languages';
export const SORTS = { pushed: 'Last updated', name: 'Name', stars: 'Stars' } as const;

/**
 * FR-ORG-03: how many repositories the list holds, and which page of them it shows, such as
 * "312 repositories matching “api”, page 2 of 13".
 */
export function listed(count: number, query: string, page: number, pages: number): string {
  const matching = query ? ` matching “${query}”` : '';
  return `${repositoryCount(count)}${matching}, page ${exactNumber(page)} of ${exactNumber(pages)}`;
}

/** FR-ORG-03: filters that no repository passes. */
export function noMatch(name: string): string {
  return `${name} doesn't have any repositories that match.`;
}

/** NFR-UX-04: a repository's sparkline, for assistive technology. */
export function sparklineLabel(commits: number): string {
  return `${exactNumber(commits)} ${commits === 1 ? 'commit' : 'commits'} in the last 26 weeks`;
}
