// What widgets say of their states, kept apart from their logic so that it can be translated
// (NFR-UX-07). Each message says what is wrong and what to do instead (NFR-UX-06).

export const LOADING = 'Loading…';

/** FR-REPO-09: a widget whose data failed to load, shown beside "Try again". */
export const FAILED = 'BuhTig could not load this from GitHub. Try again in a moment.';
