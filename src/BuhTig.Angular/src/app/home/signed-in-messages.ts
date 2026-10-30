// What the signed-in home page says, kept apart from its logic so that it can be translated
// (NFR-UX-07), and from the visitor's home page, so that it comes with its own code.

export const TOP_DASHBOARDS = 'Top dashboards';
export const FIND_DASHBOARD = 'Find a dashboard…';
export const NO_DASHBOARDS = 'Dashboards you pin or open appear here.';
export const NO_MATCHES = 'No matches.';
export const PINNED = 'Pinned';
export const RECENTLY_VIEWED = 'Recently viewed';
export const SHORTCUTS_UNAVAILABLE =
  "BuhTig couldn't load your dashboards. Reload the page to try again.";

export const RECENT_HEADING = 'Recently viewed on this BuhTig';
export const NOTHING_RECENT =
  'Nothing yet. Open a dashboard and it shows up here for everyone on this instance.';

/** FR-PAT-01: what the signed-in home page says of private repositories, by the token's state. */
export const PRIVATE_REPOSITORIES = 'Private repositories';
export const TOKEN_TEXTS = {
  valid:
    'Your personal access token is active. Private repositories it can read appear on dashboards.',
  invalid: 'GitHub rejected your token, so private repositories are hidden.',
  none: 'Add a personal access token to include private repositories you can read.',
} as const;

export const KEYBOARD = 'Keyboard shortcuts';
