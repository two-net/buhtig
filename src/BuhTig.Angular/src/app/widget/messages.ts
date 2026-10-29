// What widgets say of their states, kept apart from their logic so that it can be translated
// (NFR-UX-07). Each message says what is wrong and what to do instead (NFR-UX-06).

export const LOADING = 'Loading…';

/** FR-REPO-10: a widget whose data GitHub is still computing, which it asks for again. */
export const COMPUTING = 'Calculating on GitHub…';

/** FR-REPO-09: a widget whose data failed to load from GitHub, shown beside "Try again". */
export const FAILED = "BuhTig couldn't load this from GitHub. Try again in a moment.";

/** A widget whose data the server could not read from its database, shown beside "Try again". */
export const UNAVAILABLE = "BuhTig can't reach its database right now. Try again in a few minutes.";

/**
 * FR-DATA-10, FR-DATA-11: a widget whose data the server would not ask GitHub for, since it asks
 * for no more for visitors for now. Shown beside "Sign in".
 */
export const HELD =
  "BuhTig can't load more from GitHub for visitors right now. Sign in to keep exploring, or try again later.";

/** NFR-UX-02: what a widget announces once it has loaded after "Try again". */
export const LOADED = 'Loaded.';
