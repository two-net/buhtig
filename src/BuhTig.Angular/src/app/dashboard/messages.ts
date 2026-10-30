// What a dashboard says of itself, of access that GitHub keeps from the viewer, and of
// refreshing and pinning it, kept apart from its logic so that it can be translated (NFR-UX-07).
// Each message says what happened and what to do next (NFR-UX-06).

/** FR-PAT-08: an organization requires single sign-on, before the link to authorize. */
export const SSO_REQUIRED =
  "An organization requires single sign-on for this, and hasn't authorized your GitHub " +
  "access for it yet. Once you've authorized it, reload this page.";

/** FR-PAT-08: the link to where to authorize, when GitHub says where. */
export const AUTHORIZE_SSO = 'Authorize it on GitHub';

/** FR-PAT-08: the link to where to authorize a token, when GitHub does not say where. */
export const AUTHORIZE_TOKEN = 'Authorize your token for the organization on GitHub';

/** FR-PAT-08: an organization does not let the user's token in. */
export const TOKEN_REFUSED =
  "The organization doesn't accept your personal access token. It may require owners to " +
  'approve fine-grained tokens, or forbid tokens that last too long. Ask an owner, or ' +
  'replace the token.';

export const REPLACE_TOKEN = 'Replace token';

/** FR-PAT-07: the user's personal access token no longer works. */
export const TOKEN_REJECTED =
  'GitHub rejected your personal access token, so private repositories are hidden. BuhTig is ' +
  'using your sign-in for public data.';

/** FR-PAT-10: shown from 7 days before the user's token expires, `when` such as "in 3 days". */
export function tokenExpires(when: string): string {
  return `Your personal access token expires ${when}.`;
}

export const REPLACE_BEFORE = 'Replace it before then';

/** FR-DATA-05, FR-DATA-10: saved data, shown while visitors may fetch no more. */
export function heldData(age: string): string {
  return `Showing saved data from ${age}. Visitors have used up this hour's fresh lookups.`;
}

export const SIGN_IN_FOR_FRESH = 'Sign in for fresh numbers';

/** FR-DATA-05: saved data, shown while GitHub fails. */
export function staleData(age: string): string {
  return `GitHub can't be reached right now. Showing saved data from ${age}.`;
}

/** FR-ACC-05: the heading of a dashboard whose resource GitHub says is not there. */
export const NOT_FOUND_OR_PRIVATE = 'Not found or private';

/** `kind`, such as "repository" or "organization", after its article. */
function aOr(kind: string): string {
  return `${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind}`;
}

/** FR-ACC-05: for a visitor, who may sign in and add a token. */
export function notFoundForVisitor(kind: string, name: string): string {
  return (
    `GitHub didn't return ${aOr(kind)} called ${name}. It may not exist, or it may be private. ` +
    'Sign in and add a personal access token to see private repositories you have access to.'
  );
}

/** FR-ACC-05: for a signed-in user without a personal access token. */
export function notFoundForSignedIn(kind: string, name: string): string {
  return (
    `GitHub didn't return ${aOr(kind)} called ${name} for your sign-in. If it's private, add a ` +
    'personal access token that can read it.'
  );
}

/** FR-ACC-05, FR-PAT-07: for a signed-in user whose personal access token no longer works. */
export function notFoundWithInvalidToken(kind: string, name: string): string {
  return (
    `GitHub didn't return ${aOr(kind)} called ${name} for your sign-in, and your personal access ` +
    "token no longer works. If it's private, replace the token with one that can read it."
  );
}

/** FR-ACC-05: for a token user, whose token GitHub answered for. */
export function notFoundWithToken(name: string): string {
  return (
    `${name} doesn't exist, or your personal access token can't read it. Check the name, or ` +
    'give your token access on GitHub.'
  );
}

export const SIGN_IN_WITH_GITHUB = 'Sign in with GitHub';
export const ADD_TOKEN = 'Add a token';
export const TOKEN_SETTINGS = 'Token settings';
export const SEARCH_AGAIN = 'Search again';

/** FR-SRCH-04: the heading of a dashboard whose name cannot be a repository's or organization's. */
export const NO_SUCH_NAME = 'No such repository or organization';

/** FR-SRCH-04: a name, as of a URL typed by hand, that GitHub would never give anything. */
export function invalidName(name: string): string {
  return (
    `${name} can't be the name of a GitHub repository or organization. Check the address, or ` +
    'search for one.'
  );
}

/** FR-SRCH-06: the heading of the page of an account that is a user's. */
export function userAccount(login: string): string {
  return `@${login} is a user account`;
}

/** FR-SRCH-06: BuhTig has dashboards for organizations, but not for users. */
export const OPEN_A_REPOSITORY =
  "BuhTig shows dashboards for repositories and organizations. Open one of this user's " +
  'repositories instead:';

export const NO_USER_REPOSITORIES =
  'BuhTig shows dashboards for repositories and organizations. This user has no public ' +
  'repositories, so enter a repository or organization instead.';

/** FR-DATA-10: a visitor who may fetch no more from GitHub, with nothing saved to show. */
export const KEEP_EXPLORING = 'Sign in to keep exploring';
export const VISITORS_HELD =
  "Visitors share a limited number of fresh GitHub lookups each hour, and they're used up for " +
  'now. Sign in to use your own allowance. Dashboards opened recently still load.';

/** FR-DATA-05: GitHub fails, with nothing saved to show. */
export const UNREACHABLE = "GitHub can't be reached";
export const NOTHING_SAVED =
  "BuhTig shows saved data when it has some, but this dashboard hasn't been saved yet. Try " +
  'again in a moment.';

/** The server cannot reach its database. */
export const UNAVAILABLE = 'BuhTig is unavailable';
export const TRY_LATER = "BuhTig can't reach its database right now. Try again in a few minutes.";

export const TRY_AGAIN = 'Try again';

/** FR-NAV-05: a repository that was renamed or transferred. */
export function renamed(from: string, to: string): string {
  return `${from} was renamed. Showing ${to}.`;
}

/** NFR-UX-02: a dashboard that has loaded. */
export function loaded(name: string): string {
  return `${name} loaded.`;
}

/** FR-DATA-06 */
export const UPDATED = 'Updated';

/** FR-DATA-07: the button that fetches a dashboard's data from GitHub anew. */
export const REFRESH = 'Refresh';

/** FR-DATA-07: a dashboard may be refreshed once a minute, `seconds` from now. */
export function refreshIn(seconds: number): string {
  return `Refresh in ${seconds}s`;
}

/** FR-DATA-07: a dashboard fetched from GitHub anew. */
export const REFRESHED = 'Dashboard refreshed';

/** FR-DATA-05, FR-DATA-07: a refresh that GitHub failed. */
export const STILL_SAVED = "GitHub couldn't be reached. Still showing saved data.";

export const REFRESH_FAILED = "BuhTig couldn't refresh this dashboard. Try again in a moment.";

/** FR-PERS-02: the button that pins a dashboard, so that it comes first on the home page. */
export const PIN = 'Pin';
export const PINNED_LABEL = 'Pinned';

/** FR-PERS-02: a dashboard just pinned, or unpinned. */
export function pinned(name: string): string {
  return `Pinned ${name}`;
}
export function unpinned(name: string): string {
  return `Unpinned ${name}`;
}

/** FR-PERS-02: a user may pin up to 12 dashboards. */
export const PIN_LIMIT = 'You can pin up to 12 dashboards. Unpin one in Settings first.';

export const PIN_FAILED = "BuhTig couldn't change your pins. Try again in a moment.";

export const OPEN_ON_GITHUB = 'Open on GitHub';
