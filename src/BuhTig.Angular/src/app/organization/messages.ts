// What an organization's widgets say in sentences, kept apart from their logic so that it can
// be translated (NFR-UX-07).

import { LanguageCount, LastPush, YearCount } from '../dashboard/resources';
import { exactNumber } from '../format/format';

/** FR-ORG-09: how many of the repositories are private, such as "3 private". */
export function privateCount(count: number): string {
  return `${exactNumber(count)} private`;
}

/** FR-ORG-09: how many of the repositories are internal, such as "2 internal". */
export function internalCount(count: number): string {
  return `${exactNumber(count)} internal`;
}

/** FR-ORG-02: an organization none of whose repositories has a primary language. */
export const NO_LANGUAGE = 'None';

/**
 * FR-ORG-08: an organization with more repositories than BuhTig reads, whose figures are of the
 * `count` pushed to most recently.
 */
export function limited(count: number): string {
  const repositories = exactNumber(count);
  return (
    `This organization has more than ${repositories} repositories. ` +
    `These figures cover the ${repositories} pushed to most recently.`
  );
}

/** "repository" or "repositories", as a count of them, such as 12, takes. */
export function repositoriesLabel(count: number): string {
  return count === 1 ? 'repository' : 'repositories';
}

/** A count of repositories in full, such as "312 repositories", as the table and charts say it. */
export function repositoryCount(count: number): string {
  return `${exactNumber(count)} ${repositoriesLabel(count)}`;
}

/**
 * FR-ORG-03: which of the `count` repositories that the repository table lists a page shows,
 * such as "26–50 of 312 repositories".
 */
export function pageRange(first: number, last: number, count: number): string {
  return `${exactNumber(first)}–${exactNumber(last)} of ${repositoryCount(count)}`;
}

/** FR-ORG-03: filters that no repository passes. */
export const NO_MATCH = 'No repositories match. Try another name, type or language.';

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

/** FR-ORG-05: "star" or "stars", as a count of them, such as 12, takes. */
export function starsLabel(count: number): string {
  return count === 1 ? 'star' : 'stars';
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

/**
 * NFR-UX-04: the last-push chart in a sentence, such as "38 of 120 repositories were pushed to in
 * the last 30 days."
 */
export function lastPushDescription(pushes: LastPush): string {
  const recent = pushes.last7Days + pushes.last30Days;
  const total = recent + pushes.last12Months + pushes.older;
  return (
    `${exactNumber(recent)} of ${repositoryCount(total)} ${recent === 1 ? 'was' : 'were'} ` +
    `pushed to in the last 30 days.`
  );
}

/** NFR-UX-04: what the created-per-year chart is, as assistive technology names it. */
export const CREATED_CHART = 'Repositories created per year';

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

/** FR-ORG-06: one year of the created-per-year chart, such as "2019: 45 repositories". */
export function yearSummary({ year, repositories }: YearCount): string {
  return `${year}: ${repositoryCount(repositories)}`;
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
