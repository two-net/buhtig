// What the account corner says, kept apart from its logic so that it can be translated
// (NFR-UX-07). Each message says what happened and what to do next (NFR-UX-06).

/**
 * FR-AUTH-06, FR-AUTH-09: said once the server has signed the user out, as when their session
 * timed out, or GitHub rejected their sign-in.
 */
export const ENDED =
  'Your sign-in has ended. Sign in again to keep your shortcuts and settings at hand.';

/** FR-PAT-04: what the account menu says of the user's personal access token. */
export const TOKEN_STATES = {
  valid: 'Personal access token active',
  invalid: 'Token rejected by GitHub',
  none: 'No personal access token',
} as const;
