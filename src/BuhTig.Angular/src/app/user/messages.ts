// What a user's dashboard says of them, kept apart from its logic so that it can be translated
// (NFR-UX-07).

/** FR-USER-01: "follower" or "followers", as a count of them, such as 12, takes, after it. */
export function followersLabelOf(count: number): string {
  return count === 1 ? ' follower' : ' followers';
}

/** FR-USER-01: how many the user follows, after the figure. */
export const FOLLOWING = ' following';

/** FR-USER-01: since when the user is on GitHub, before the date. */
export const JOINED = 'Joined';

/** FR-USER-01: their company, for assistive technology, which the icon stands for. */
export const COMPANY = 'Company';
