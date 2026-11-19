// What the Browse page says, kept apart from its logic so that it can be translated (NFR-UX-07).

import { exactNumber } from '../format/format';

/** FR-SRCH-14: the page's heading, and the links to it from the home pages. */
export const BROWSE = 'Browse';
export const BROWSE_ALL = 'Browse all';

/** FR-SRCH-14: what the page lists, and how many it may, at most. */
export function browsePurpose(cap: number): string {
  return (
    `Public repositories whose dashboards were opened on this BuhTig lately, up to the ` +
    `${exactNumber(cap)} opened last, from what BuhTig already has. Listing them asks GitHub nothing.`
  );
}

/** FR-SRCH-14: the filters, for assistive technology, and their choices of every one. */
export const LANGUAGE = 'Language';
export const TOPIC = 'Topic';
export const ANY_LANGUAGE = 'Any language';
export const ANY_TOPIC = 'Any topic';

/** FR-SRCH-14: how many match, of how many are listed, and which page is shown. */
export function browseStatus(
  matching: number,
  listed: number,
  page: number,
  pages: number,
): string {
  const of = matching === listed ? '' : ` of ${exactNumber(listed)}`;
  const counted = `${exactNumber(matching)}${of} ${listed === 1 ? 'repository' : 'repositories'}`;
  return pages > 1 ? `${counted}, page ${exactNumber(page)} of ${exactNumber(pages)}` : counted;
}

/** FR-SRCH-14: an empty shared cache. */
export const NOTHING_TO_BROWSE = 'Nothing to browse yet';
export const NOTHING_TO_BROWSE_TEXT =
  'Public repositories show up here once someone opens their dashboards on this BuhTig.';

/** FR-SRCH-14: filters that match none of them. */
export const NO_MATCH = 'No repository listed here matches these filters.';
export const CLEAR_FILTERS = 'Clear filters';

/** FR-SRCH-14, NFR-UX-06: what failed, and what to do. */
export const BROWSE_FAILED = "Couldn't load the repositories";
export const BROWSE_FAILED_TEXT = "BuhTig couldn't read them. Try again in a moment.";
export const TRY_AGAIN = 'Try again';

/** FR-ACC-03: a visitor in private mode, asked to sign in. */
export const SIGN_IN_TO_BROWSE = 'Sign in to browse';
export const SIGN_IN_TEXT =
  'This BuhTig is private. Sign in with GitHub to browse its repositories.';
export const SIGN_IN_WITH_GITHUB = 'Sign in with GitHub';

/** A repository's last push, as its row says it. */
export const UPDATED = 'Updated';
