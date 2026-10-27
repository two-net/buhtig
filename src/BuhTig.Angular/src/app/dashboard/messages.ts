// What a dashboard says of access that GitHub keeps from the viewer, and of refreshing it, kept
// apart from its logic so that it can be translated (NFR-UX-07). Each message says what happened
// and what to do next (NFR-UX-06).

/** FR-PAT-08: an organization requires single sign-on, before the link to authorize. */
export const SSO_REQUIRED =
  "An organization requires single sign-on for this, and hasn't authorized your GitHub " +
  'access for it yet.';

/** FR-PAT-08: the link to where to authorize, when GitHub says where. */
export const AUTHORIZE_SSO = 'Authorize it on GitHub';

/** FR-PAT-08: the link to where to authorize a token, when GitHub does not say where. */
export const AUTHORIZE_TOKEN = 'Authorize your token for the organization on GitHub';

/** FR-PAT-08: after either link. */
export const THEN_RELOAD = 'then reload this page.';

/** FR-PAT-08: an organization does not let the user's token in. */
export const TOKEN_REFUSED =
  "The organization doesn't accept your personal access token. It may require owners to " +
  'approve fine-grained tokens, or forbid tokens that last too long. Ask an owner, or ' +
  'replace the token.';

export const REPLACE_TOKEN = 'Replace it in Settings';

/** FR-ACC-05: the heading of a dashboard whose resource GitHub says is not there. */
export const NOT_FOUND_OR_PRIVATE = 'Not found or private';

/**
 * FR-ACC-05: what GitHub's "not found" may mean, for a viewer without a personal access token.
 * It tells nothing of which.
 */
export function notFound(name: string): string {
  return `BuhTig can't find ${name} on GitHub. Either it doesn't exist, or it's private.`;
}

/** FR-ACC-05: for a visitor, before the sign-in link. */
export const SIGN_IN_TO_SEE =
  'If you can see it on GitHub, sign in, then add a personal access token that can read it.';

export const SIGN_IN = 'Sign in';

/** FR-ACC-05: for a signed-in user without a personal access token, before the link to add one. */
export const ADD_TOKEN_TO_SEE =
  'If you can see it on GitHub, add a personal access token that can read it.';

export const ADD_TOKEN = 'Add a token in Settings';

/** FR-ACC-05, FR-PAT-07: for a signed-in user whose personal access token no longer works. */
export const TOKEN_INVALID_TO_SEE =
  'Your personal access token no longer works. If you can see it on GitHub, replace the token ' +
  'with one that can read it.';

/** FR-ACC-05: for a token user, whose token GitHub answered for. */
export function notFoundWithToken(name: string): string {
  return (
    `BuhTig can't find ${name} on GitHub. Either it doesn't exist, or your personal access ` +
    "token can't read it. Check the name, or give your token access to it on GitHub."
  );
}

export const GO_HOME = 'Go to the home page';

/** FR-DATA-07: the button that fetches a dashboard's data from GitHub anew. */
export const REFRESH = 'Refresh';

/** FR-DATA-07: a dashboard may be refreshed once a minute. */
export const REFRESHED_RECENTLY =
  'This dashboard was refreshed less than a minute ago. Try again in a moment.';

export const REFRESH_FAILED = "BuhTig couldn't refresh this dashboard. Try again in a moment.";

/** FR-PERS-02: the button that pins a dashboard, so that it comes first on the home page. */
export const PIN = 'Pin';

/** FR-PERS-02: the button that unpins a pinned dashboard. */
export const UNPIN = 'Unpin';

/** FR-PERS-02: a user may pin up to 12 dashboards. */
export const PIN_LIMIT =
  "You've pinned 12 dashboards, the most BuhTig keeps. Unpin one in Settings to pin this one.";

export const PIN_FAILED = "BuhTig couldn't change your pins. Try again in a moment.";
