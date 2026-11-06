// What the command palette says, kept apart from its logic so that it can be translated
// (NFR-UX-07), and from the app's, so that it comes with the palette's own code.

import { PINNED, RECENTLY_VIEWED } from '../home/signed-in-messages';
import { KINDS } from '../search/messages';
import { Resource } from '../search/parse';
import { Source } from './suggest';

/** What names the palette for assistive technology. */
export const HEADING = 'Command palette';

/** The input's label, for assistive technology. */
export const LABEL = 'Dashboard to open';

export const PLACEHOLDER = 'Find a dashboard, or paste a GitHub URL';

/** FR-SRCH-13: how to open a tab. */
export const HINT = 'Add a tab after a name, as in owner/repo pulls or org people.';

/** The list's label, for assistive technology. */
export const SUGGESTIONS = 'Suggestions';

/** What the palette says when it has nothing to suggest yet. */
export const START = 'Type a repository, organization or user, or paste its GitHub URL.';

/** What the palette says when it suggests nothing, and nothing is wrong (NFR-UX-06). */
export const NO_MATCHES = `No dashboards match. ${START}`;

/** Where each suggestion comes from, or what kind of resource the user typed. */
export function sourceLabel(source: Source, kind: Resource['kind']): string {
  switch (source) {
    case 'pinned':
      return PINNED;
    case 'recent':
      return RECENTLY_VIEWED;
    case 'opened':
      return 'Viewed on this BuhTig';
    case 'typed':
      return KINDS[kind];
  }
}

/** How many suggestions there are, for assistive technology (WCAG 4.1.3). */
export function resultCount(count: number): string {
  return count === 0 ? 'No suggestions' : count === 1 ? '1 suggestion' : `${count} suggestions`;
}

/** What the keys below the list do. */
export const KEYS = { move: 'to move', open: 'to open', close: 'to close' } as const;
