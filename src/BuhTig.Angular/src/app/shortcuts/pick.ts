import { Known } from '../search/parse';

/** A dashboard that a signed-in user pinned or viewed recently (§4.8). */
export interface Shortcut {
  kind: Known['kind'];
  /** `owner/repo`, `org` or `login`, as GitHub spells it. */
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
 * dashboards viewed recently that are not pinned, newest first, up to `limit`. The command
 * palette has all of them (FR-SRCH-12).
 */
export function pick(pins: Shortcut[], recent: Shortcut[], limit = MAX_SHORTCUTS): Picked[] {
  const pinned = new Set(pins.map(key));
  return [
    ...pins.map(({ kind, name }) => ({ kind, name, pinned: true })),
    ...recent
      .filter((shortcut) => !pinned.has(key(shortcut)))
      .map(({ kind, name }) => ({ kind, name, pinned: false })),
  ].slice(0, limit);
}

/** Whether `a` and `b` are the same dashboard, whatever the case of their names. */
export function sameDashboard(a: Shortcut, b: Shortcut): boolean {
  return key(a) === key(b);
}

/** The shortcut to `resource`'s dashboard. */
export function shortcutOf(resource: Known): Shortcut {
  switch (resource.kind) {
    case 'repository':
      return { kind: 'repository', name: `${resource.owner}/${resource.repo}` };
    case 'organization':
      return { kind: 'organization', name: resource.org };
    case 'user':
      return { kind: 'user', name: resource.login };
  }
}

/** The resource whose dashboard `shortcut` leads to. */
export function resourceOf({ kind, name }: Shortcut): Known {
  switch (kind) {
    case 'organization':
      return { kind, org: name };
    case 'user':
      return { kind, login: name };
    case 'repository': {
      const [owner, repo] = name.split('/');
      return { kind, owner, repo };
    }
  }
}

/** What tells dashboards apart. GitHub's names ignore letter case. */
function key({ kind, name }: Shortcut): string {
  return `${kind}:${name.toLowerCase()}`;
}
