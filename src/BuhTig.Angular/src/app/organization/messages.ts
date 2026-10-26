// What an organization's widgets say in sentences, kept apart from their logic so that it can
// be translated (NFR-UX-07).

import { LastPush, YearCount } from '../dashboard/resources';
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

/** FR-ORG-05: "star" or "stars", as a count of them, such as 12, takes. */
export function starsLabel(count: number): string {
  return count === 1 ? 'star' : 'stars';
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

/** NFR-UX-04: the created-per-year chart in a sentence, for assistive technology. */
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
