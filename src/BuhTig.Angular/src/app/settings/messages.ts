// What Settings says, kept apart from its logic so that it can be translated (NFR-UX-07). Each
// problem says what happened and what to do next (NFR-UX-06).

import { SaveProblem } from './tokens';

/** FR-ACC-02: Settings are for signed-in users. */
export const SIGN_IN_FIRST = 'Sign in with GitHub to see your settings.';

/** FR-PAT-09: what a personal access token is for. */
export const TOKEN_PURPOSE =
  'A personal access token lets BuhTig show the private and internal repositories and ' +
  "organization data that the token can see. You don't need one to use BuhTig.";

/** FR-PAT-09, NFR-SEC-05: what BuhTig does with the token. */
export const TOKEN_HANDLING =
  'BuhTig keeps the token encrypted, uses it only to read from GitHub for you, and never ' +
  'shows it again, not even to you.';

/** FR-PAT-09: the token BuhTig recommends, before the link to create one. */
export const TOKEN_ADVICE =
  'We recommend a fine-grained token with read-only access, limited to the repositories you ' +
  'want to see here.';

export const CREATE_TOKEN = 'Create a fine-grained token on GitHub';
export const MANAGE_TOKENS = 'Manage your tokens on GitHub';

/**
 * FR-PAT-07, DR-03: a token that GitHub no longer accepts, or that BuhTig can no longer
 * decrypt.
 */
export const TOKEN_INVALID =
  "This token no longer works: GitHub stopped accepting it, as when it's revoked or expires, " +
  'or BuhTig can no longer read it. BuhTig uses your sign-in instead, which sees public data ' +
  'only. Replace the token to see private data again.';

export const TYPE_LABELS = { classic: 'Classic', fine_grained: 'Fine-grained' } as const;

/** FR-PAT-04: GitHub does not report what a fine-grained token may do. */
export const PERMISSIONS_UNKNOWN =
  "GitHub doesn't report a fine-grained token's permissions. You can see them on GitHub.";

/** FR-PAT-04: a classic token without scopes. */
export const NO_SCOPES = 'None: public data only';

/** FR-PAT-04: a token without an expiry date. */
export const NEVER_EXPIRES = 'Never';

export const SAVED = 'Token saved.';
export const REMOVED = 'Token removed. BuhTig no longer keeps any data it read with it.';

/** Why a token was not saved, and what to do about it. */
export function saveProblemMessage(problem: SaveProblem): string {
  switch (problem) {
    case 'not_a_token':
      return (
        "That doesn't look like a personal access token. Paste a fine-grained token, which " +
        'starts with github_pat_, or a classic one, which starts with ghp_.'
      );
    case 'rejected':
      return (
        "GitHub didn't accept this token. It may be mistyped, revoked or expired. Check it, " +
        'or create a new one.'
      );
    case 'other_account':
      return (
        "This token belongs to another GitHub account. Use a token of the account you're " +
        'signed in with.'
      );
    case 'too_many':
      return 'Too many tokens were checked in a short time. Wait a minute, then try again.';
    case 'github':
      return "BuhTig couldn't reach GitHub to check the token. Try again in a moment.";
    case 'signed_out':
      return "You've been signed out. Sign in again to save a token.";
    case 'failed':
      return "BuhTig couldn't save the token. Try again in a moment.";
  }
}

export const REMOVE_FAILED = "BuhTig couldn't remove the token. Try again in a moment.";

/** FR-PERS-02, FR-SRCH-08: what pins are for, and how to pin a dashboard. */
export const PINS_PURPOSE =
  'Pinned dashboards come first below the search box on the home page. Pin a dashboard with ' +
  'the Pin button at its top. You can pin up to 12.';

export const NO_PINS = "You haven't pinned any dashboards.";

/** FR-PERS-01, FR-SRCH-08: what history is for, and all it keeps. */
export const HISTORY_PURPOSE =
  'BuhTig remembers the last 20 dashboards you opened, and offers them below the search box on ' +
  'the home page. It keeps only which dashboards you opened, and when.';

export const NO_HISTORY = 'Your history is empty.';

/** FR-PERS-03 */
export const HISTORY_CLEARED = 'History cleared. Your pins stay.';

export const CLEAR_FAILED = "BuhTig couldn't clear your history. Try again in a moment.";

export const PINS_FAILED = "BuhTig couldn't change your pins. Try again in a moment.";

export const SHORTCUTS_UNAVAILABLE =
  "BuhTig couldn't load your pins and history. Reload the page to try again.";

/** FR-PERS-05 */
export function movedUp(name: string): string {
  return `Moved ${name} up.`;
}

/** FR-PERS-05 */
export function movedDown(name: string): string {
  return `Moved ${name} down.`;
}

/** FR-PERS-02 */
export function unpinned(name: string): string {
  return `Unpinned ${name}.`;
}

/** FR-PERS-04: what deleting one's data deletes, and what comes of it. */
export const DELETION_PURPOSE =
  'You can delete everything BuhTig keeps about you: your account here, your sign-ins on every ' +
  'browser, the access GitHub gave BuhTig when you signed in, your token and the data BuhTig ' +
  "read with it, your history and your pins. You'll be signed out everywhere. If you sign in " +
  'again later, you start afresh.';

/** FR-PERS-04: BuhTig's access to the user's GitHub account is removed on GitHub. */
export const GITHUB_ACCESS =
  "Deleting your data doesn't remove BuhTig from the apps you've authorized on GitHub. You can " +
  'revoke its access in your GitHub settings.';

export const REVIEW_GITHUB_ACCESS = 'Review your authorized apps on GitHub';

/** FR-PERS-04: what the user confirms before anything is deleted. */
export const CONFIRM_DELETION = "Delete all your BuhTig data? This can't be undone.";

/** FR-PERS-04 */
export const DATA_DELETED =
  "All your BuhTig data is deleted, and you're signed out on every browser.";

export const DELETE_FAILED = "BuhTig couldn't delete your data. Try again in a moment.";
