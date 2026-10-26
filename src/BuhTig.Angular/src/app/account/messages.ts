// What the account corner says, kept apart from its logic so that it can be translated
// (NFR-UX-07). Each message says what happened and what to do next (NFR-UX-06).

/** FR-AUTH-09: shown beside "Sign in" once the server has signed the user out. */
export const ENDED = 'GitHub ended your sign-in. Please sign in again.';

/**
 * FR-PAT-07, DR-03: shown once the user's personal access token no longer works, because GitHub
 * no longer accepts it, or BuhTig can no longer decrypt it.
 */
export const TOKEN_INVALID = 'Your personal access token no longer works.';

/** FR-PAT-10: shown from 7 days before the user's token expires, `when` such as "in 3 days". */
export function tokenExpires(when: string): string {
  return `Your personal access token expires ${when}.`;
}

/** After either note: where to replace the token. */
export const REPLACE_TOKEN = 'Replace it in Settings';
