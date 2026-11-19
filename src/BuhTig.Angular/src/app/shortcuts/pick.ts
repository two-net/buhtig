import { Known, dashboardPath } from '../search/parse';

/**
 * What a shortcut leads to (§4.8): the dashboard of a repository, an organization or a user, or a
 * comparison of two repositories, or of two accounts (FR-CMP-05).
 */
export type ShortcutKind = Known['kind'] | ComparisonKind;

/** A comparison's kind of shortcut, of two repositories or two accounts. */
export type ComparisonKind = 'repository_comparison' | 'account_comparison';

/** A dashboard, or a comparison, that a signed-in user pinned or viewed recently (§4.8). */
export type Shortcut = DashboardShortcut | ComparisonShortcut;

/** A shortcut to a dashboard. */
export interface DashboardShortcut {
  kind: Known['kind'];
  /** `owner/repo`, `org` or `login`, as GitHub spells it. */
  name: string;
}

/** A shortcut to a comparison (FR-CMP-05). */
export interface ComparisonShortcut {
  kind: ComparisonKind;
  /** The names of its two sides, as GitHub spells them, as `{first}...{second}` (FR-CMP-01). */
  name: string;
}

/** A shortcut as the home page lists it, which says whether it is pinned. */
export type Picked = Shortcut & { pinned: boolean };

/** How many shortcuts the home page shows (FR-SRCH-08). */
export const MAX_SHORTCUTS = 12;

/** What is between the names of the two sides of a comparison (FR-CMP-01). */
const BETWEEN = '...';

/**
 * The home page's shortcuts (FR-SRCH-08): the pins first, in the user's order, then the
 * dashboards and comparisons viewed recently that are not pinned, newest first, up to `limit`.
 * The command palette has all of them (FR-SRCH-12).
 */
export function pick(pins: Shortcut[], recent: Shortcut[], limit = MAX_SHORTCUTS): Picked[] {
  const pinned = new Set(pins.map(key));
  return [
    ...pins.map(({ kind, name }) => ({ kind, name, pinned: true }) as Picked),
    ...recent
      .filter((shortcut) => !pinned.has(key(shortcut)))
      .map(({ kind, name }) => ({ kind, name, pinned: false }) as Picked),
  ].slice(0, limit);
}

/** Whether `a` and `b` are the same dashboard or comparison, whatever the case of their names. */
export function sameDashboard(a: Shortcut, b: Shortcut): boolean {
  return key(a) === key(b);
}

/** Whether `shortcut` leads to a comparison, rather than to a dashboard. */
export function isComparison(shortcut: Shortcut): shortcut is ComparisonShortcut {
  return shortcut.kind === 'repository_comparison' || shortcut.kind === 'account_comparison';
}

/** The shortcut to `resource`'s dashboard. */
export function shortcutOf(resource: Known): DashboardShortcut {
  switch (resource.kind) {
    case 'repository':
      return { kind: 'repository', name: `${resource.owner}/${resource.repo}` };
    case 'organization':
      return { kind: 'organization', name: resource.org };
    case 'user':
      return { kind: 'user', name: resource.login };
  }
}

/**
 * The shortcut to the comparison of `first` with `second`, two repositories or two accounts, or
 * `undefined` when they are one resource, which is no comparison (FR-CMP-02).
 */
export function comparisonOf(first: Known, second: Known): ComparisonShortcut | undefined {
  const [a, b] = [first, second].map((resource) => dashboardPath(resource).slice(1));
  if (a.toLowerCase() === b.toLowerCase()) {
    return undefined;
  }
  const repositories = first.kind === 'repository';
  if (repositories !== (second.kind === 'repository')) {
    return undefined;
  }
  return {
    kind: repositories ? 'repository_comparison' : 'account_comparison',
    name: `${a}${BETWEEN}${b}`,
  };
}

/**
 * The names of the two sides of a comparison, as `{first}...{second}` has them. Of repositories,
 * it is split at the last `...` before the second's `/`, since a repository's name may have dots,
 * but no owner's does, as its URL is (FR-CMP-01).
 */
export function sidesOf({ name }: ComparisonShortcut): [string, string] | undefined {
  const slash = name.lastIndexOf('/');
  const before = slash < 0 ? name.length : slash;
  const at = before < BETWEEN.length ? -1 : name.lastIndexOf(BETWEEN, before - BETWEEN.length);
  return at < 0 ? undefined : [name.slice(0, at), name.slice(at + BETWEEN.length)];
}

/** The resource whose dashboard `shortcut` leads to. */
export function resourceOf({ kind, name }: DashboardShortcut): Known {
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

/** Where `shortcut` leads: its dashboard, or its comparison (FR-CMP-01). */
export function shortcutPath(shortcut: Shortcut): string {
  return isComparison(shortcut) ? `/-/compare/${shortcut.name}` : `/${shortcut.name}`;
}

/** What `shortcut` is called, its name, or of a comparison, such as "acme/widget vs octo/thing". */
export function shortcutLabel(shortcut: Shortcut): string {
  const sides = isComparison(shortcut) ? sidesOf(shortcut) : undefined;
  return sides ? `${sides[0]} vs ${sides[1]}` : shortcut.name;
}

/** The login whose avatar a dashboard's shortcut shows, as the owner's of a repository. */
export function avatarLogin(shortcut: DashboardShortcut): string {
  return shortcut.name.split('/')[0];
}

/** What tells dashboards and comparisons apart. GitHub's names ignore letter case. */
function key({ kind, name }: Shortcut): string {
  return `${kind}:${name.toLowerCase()}`;
}
