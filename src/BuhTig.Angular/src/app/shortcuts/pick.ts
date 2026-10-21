/** A dashboard that a signed-in user pinned or viewed recently (§4.8). */
export interface Shortcut {
  kind: 'repository' | 'organization';
  /** `owner/repo` or `org`, as GitHub spells it. */
  name: string;
}

/** How many shortcuts the home page shows (FR-SRCH-08). */
export const MAX_SHORTCUTS = 8;

/**
 * The home page's shortcuts (FR-SRCH-08): the pins first, in the user's order, then the
 * dashboards viewed recently that are not pinned, newest first, up to `MAX_SHORTCUTS`.
 */
export function pick(pins: Shortcut[], recent: Shortcut[]): Shortcut[] {
  const pinned = new Set(pins.map(key));
  return [...pins, ...recent.filter((shortcut) => !pinned.has(key(shortcut)))].slice(
    0,
    MAX_SHORTCUTS,
  );
}

/** What tells dashboards apart. GitHub's names ignore letter case. */
function key({ kind, name }: Shortcut): string {
  return `${kind}:${name.toLowerCase()}`;
}
