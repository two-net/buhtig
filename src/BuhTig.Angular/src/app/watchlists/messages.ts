// What watchlists say, kept apart from their logic so that it can be translated (NFR-UX-07).
// Each message says what happened and what to do next (NFR-UX-06).

import { Failure } from '../widget/load';
import { MAX_NAME_LENGTH, MAX_REPOSITORIES, MAX_WATCHLISTS, WatchlistProblem } from './watchlists';

/** UI-02: the avatar menu's item, and the page's heading where it lists no watchlist. */
export const WATCHLISTS = 'Watchlists';

/** FR-PERS-06: a visitor, asked to sign in. */
export const SIGN_IN_FOR_WATCHLISTS = 'Sign in to keep watchlists';
export const SIGN_IN_FIRST =
  'Watchlists show the latest release, recent activity and workflow runs of repositories you ' +
  'choose, from any owners, in one place. Sign in with GitHub to make one.';
export const SIGN_IN_WITH_GITHUB = 'Sign in with GitHub';

/** FR-PERS-06: what watchlists are for, where there are none yet. */
export const NO_WATCHLISTS = 'No watchlists yet';
export const WATCHLISTS_PURPOSE =
  'A watchlist shows the latest release, recent activity and workflow runs of repositories you ' +
  `choose, from any owners, in one place. You can have up to ${MAX_WATCHLISTS}, of up to ` +
  `${MAX_REPOSITORIES} repositories each.`;

/** FR-PERS-06: the button that makes a watchlist. */
export const NEW_WATCHLIST = 'New watchlist';

/** FR-PERS-06: how many of the watchlists a user may have they have. */
export function watchlistCount(count: number): string {
  return `${count} of ${MAX_WATCHLISTS}`;
}

/** FR-PERS-07: how many repositories a watchlist holds, of as many as it may. */
export function repositoryCount(count: number): string {
  return `${count} of ${MAX_REPOSITORIES} repositories`;
}

/** The server could not tell the user's watchlists. */
export const WATCHLISTS_UNAVAILABLE = "BuhTig couldn't load your watchlists";
export const TRY_AGAIN_SOON = 'Try again in a moment.';
export const TRY_AGAIN = 'Try again';

/** The page of a watchlist that the user does not have, which tells nothing more of it. */
export const NO_SUCH_WATCHLIST = 'Watchlist not found';
export const NO_SUCH_WATCHLIST_TEXT =
  "You don't have a watchlist here. It may have been deleted. Your watchlists are listed on the " +
  'Watchlists page.';
export const ALL_WATCHLISTS = 'Your watchlists';

/** FR-PERS-08: what a watchlist shows, and that each repository is read as its dashboard is. */
export const WATCHLIST_PURPOSE =
  'Each repository shows what GitHub shows you of it, as its dashboard does: open one for more.';

/** FR-PERS-07: a watchlist without repositories. */
export const NO_REPOSITORIES = 'No repositories yet. Add one below, or from your pins.';

/** FR-PERS-06: the dialogs that make, rename and delete a watchlist. */
export const CREATE = 'Create watchlist';
export const NAME_LABEL = 'Name';
export const NAME_PLACEHOLDER = 'Dependencies';
export const RENAME = 'Rename';
export const RENAME_HEADING = 'Rename watchlist';
export const DELETE = 'Delete';
export const DELETE_WATCHLIST = 'Delete watchlist';
export const CANCEL = 'Cancel';
export const SAVE = 'Save';

/** FR-PERS-07: the choice to fill a new watchlist with the user's pinned repositories. */
export function startWithPins(count: number): string {
  return `Start with my ${count} pinned ${count === 1 ? 'repository' : 'repositories'}`;
}

/** FR-PERS-06: what deleting a watchlist does, and does not. */
export function deleteWarning(name: string, count: number): string {
  return (
    `Delete ${name} and the ${count} ${count === 1 ? 'repository' : 'repositories'} in it from ` +
    'BuhTig? Your pins stay, and nothing changes on GitHub.'
  );
}

/** FR-PERS-06, FR-PERS-07: what was just done, as a toast says it. */
export function created(name: string): string {
  return `Created ${name}`;
}
export function renamedTo(name: string): string {
  return `Renamed to ${name}`;
}
export function deleted(name: string): string {
  return `Deleted ${name}`;
}
export function addedTo(repository: string, watchlist: string): string {
  return `Added ${repository} to ${watchlist}`;
}
export function addedPins(count: number, watchlist: string): string {
  return `Added ${count} pinned ${count === 1 ? 'repository' : 'repositories'} to ${watchlist}`;
}
export function removedFrom(repository: string, watchlist: string): string {
  return `Removed ${repository} from ${watchlist}`;
}
export function movedUp(repository: string): string {
  return `Moved ${repository} up.`;
}
export function movedDown(repository: string): string {
  return `Moved ${repository} down.`;
}

/** FR-PERS-07: the controls of each repository in a watchlist, for assistive technology. */
export function moveUpLabel(repository: string): string {
  return `Move ${repository} up`;
}
export function moveDownLabel(repository: string): string {
  return `Move ${repository} down`;
}
export function removeLabel(repository: string): string {
  return `Remove ${repository} from the watchlist`;
}

/** FR-PERS-07: the form that adds a repository, in any form of SRS Table 4-1. */
export const ADD_REPOSITORY = 'Add a repository';
export const ADD = 'Add';
export function addPlaceholder(host: string): string {
  return `owner/repo or ${host}/owner/repo`;
}

/** FR-PERS-07: an account, which a watchlist cannot hold. */
export const NOT_A_REPOSITORY =
  'A watchlist holds repositories. Enter one as owner/repo, or paste its URL.';

/** FR-PERS-07: a repository in the watchlist already, whatever the case of its name. */
export function alreadyIn(repository: string): string {
  return `${repository} is in this watchlist already.`;
}

/** FR-PERS-07: the user's pinned repositories that are not in the watchlist yet. */
export const FROM_YOUR_PINS = 'From your pins';
export const ADD_ALL = 'Add all';
export function addPinLabel(repository: string, watchlist: string): string {
  return `Add ${repository} to ${watchlist}`;
}

/** What a watchlist's change failed with, said where the change was made. */
export function problemMessage(problem: WatchlistProblem): string {
  switch (problem) {
    case 'too_many_watchlists':
      return `You can have up to ${MAX_WATCHLISTS} watchlists. Delete one first.`;
    case 'name_taken':
      return 'You have a watchlist of that name already. Choose another name.';
    case 'too_many_repositories':
      return `A watchlist can hold up to ${MAX_REPOSITORIES} repositories. Remove one first, or use another watchlist.`;
    case 'invalid_name':
      return `Give the watchlist a name of 1 to ${MAX_NAME_LENGTH} characters.`;
    case 'invalid_repositories':
      return "That can't be the name of a GitHub repository. Check it, and try again.";
    case 'not_found':
      return "This watchlist isn't there anymore. Reload the page to see your watchlists.";
    case 'failed':
      return "BuhTig couldn't change your watchlists. Try again in a moment.";
  }
}

/** FR-PERS-08: the parts of a repository's row in a watchlist. */
export const LATEST_RELEASE = 'Latest release';
export const NO_RELEASES = 'No releases';
export const PUSHED = 'Pushed';
export const LATEST_RUN = 'Latest run';
export const UPDATED = 'Updated';

/** FR-PERS-08: a part of a repository's row that failed alone, which the rest still shows. */
export const RELEASE_FAILED = "Couldn't load the latest release";
export const RUNS_FAILED = "Couldn't load the workflow runs";

/** FR-PERS-08: a repository's row that failed to load as a whole, beside "Try again". */
export function rowFailure(failure: Failure): string {
  switch (failure) {
    case 'held':
      return "BuhTig can't load more from GitHub right now. Try again later.";
    case 'unavailable':
      return "BuhTig can't reach its database right now. Try again in a few minutes.";
    case 'github':
      return "BuhTig couldn't load this repository from GitHub. Try again in a moment.";
  }
}

/** FR-PERS-08: a repository's row, said to assistive technology while it loads. */
export function loadingRow(repository: string): string {
  return `Loading ${repository}…`;
}

/** FR-PERS-07: the button in a dashboard's head that adds its repository to watchlists. */
export const ADD_TO_WATCHLIST = 'Add to watchlist…';

/** FR-PERS-07: the dialog that adds a repository to watchlists, or takes it out. */
export function addToHeading(repository: string): string {
  return `Add ${repository} to watchlists`;
}
export const CHOOSE_WATCHLISTS =
  'Choose the watchlists to show it in. Each change is saved as you make it.';
export const NO_WATCHLISTS_YET = 'You have no watchlists yet. Name one to make it.';
export const NEW_WATCHLIST_NAME = 'New watchlist';
export const MANAGE_WATCHLISTS = 'Manage watchlists';
export const DONE = 'Done';
export const LOADING_WATCHLISTS = 'Loading your watchlists…';
export const WATCHLISTS_FAILED = "BuhTig couldn't load your watchlists. Try again in a moment.";
