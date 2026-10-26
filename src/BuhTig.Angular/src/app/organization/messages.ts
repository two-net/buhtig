// What an organization's widgets say in sentences, kept apart from their logic so that it can
// be translated (NFR-UX-07).

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

/** FR-ORG-03: how many repositories the repository table lists, such as "312 repositories". */
export function repositoryCount(count: number): string {
  return `${exactNumber(count)} ${count === 1 ? 'repository' : 'repositories'}`;
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
