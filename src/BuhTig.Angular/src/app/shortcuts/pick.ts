import { Resource } from '../search/parse';

/** A dashboard that a signed-in user pinned or viewed recently (§4.8). */
export interface Shortcut {
  kind: 'repository' | 'organization';
  /** `owner/repo` or `org`, as GitHub spells it. */
  name: string;
}

/** A shortcut as the home page lists it, which says whether it is pinned. */
export interface Picked extends Shortcut {
  pinned: boolean;
}

/** How many shortcuts the home page shows (FR-SRCH-08). */
export const MAX_SHORTCUTS = 12;

/**
 * The home page's shortcuts (FR-SRCH-08): the pins first, in the user's order, then the
 * dashboards viewed recently that are not pinned, newest first, up to `MAX_SHORTCUTS`.
 */
export function pick(pins: Shortcut[], recent: Shortcut[]): Picked[] {
  const pinned = new Set(pins.map(key));
  return [
    ...pins.map(({ kind, name }) => ({ kind, name, pinned: true })),
    ...recent
      .filter((shortcut) => !pinned.has(key(shortcut)))
      .map(({ kind, name }) => ({ kind, name, pinned: false })),
  ].slice(0, MAX_SHORTCUTS);
}

/** Whether `a` and `b` are the same dashboard, whatever the case of their names. */
export function sameDashboard(a: Shortcut, b: Shortcut): boolean {
  return key(a) === key(b);
}

/** The shortcut to `resource`'s dashboard. */
export function shortcutOf(resource: Resource): Shortcut {
  return resource.kind === 'repository'
    ? { kind: 'repository', name: `${resource.owner}/${resource.repo}` }
    : { kind: 'organization', name: resource.org };
}

/** The resource whose dashboard `shortcut` leads to. */
export function resourceOf({ kind, name }: Shortcut): Resource {
  if (kind === 'organization') {
    return { kind, org: name };
  }
  const [owner, repo] = name.split('/');
  return { kind, owner, repo };
}

/** What tells dashboards apart. GitHub's names ignore letter case. */
function key({ kind, name }: Shortcut): string {
  return `${kind}:${name.toLowerCase()}`;
}
