import { Tab, commandPath, parseCommand, tabLabel, tabsNamed } from '../search/command';
import { problemMessage, resourceName } from '../search/messages';
import { Resource, isUnfinished } from '../search/parse';
import { Shortcut, pick, resourceOf } from '../shortcuts/pick';
import { fuzzy } from './fuzzy';

/** Where a suggestion comes from. */
export type Source =
  /** The signed-in user's pins (FR-PERS-02). */
  | 'pinned'
  /** The dashboards the signed-in user viewed lately (FR-PERS-01). */
  | 'recent'
  /** The public repositories opened on this BuhTig lately, from the shared cache (FR-SRCH-11). */
  | 'opened'
  /** What the user typed, in a form of SRS Table 4-1. */
  | 'typed';

/** A dashboard, or one of its tabs, that the command palette suggests opening. */
export interface Suggestion {
  /** What tells it apart from the others. */
  key: string;
  resource: Resource;
  /** `owner/repo`, `org` or `login`, as it is shown. */
  name: string;
  source: Source;
  tab?: Tab;
  /** The tab's label, as the dashboard's tab bar shows it. */
  tabLabel?: string;
  /** Where it opens. */
  path: string;
  /** The indexes of the characters of `name` that the query matches. */
  matches: number[];
  /** The owner's avatar, if known. */
  avatar?: string;
}

/** What the command palette suggests from. */
export interface Sources {
  pins: Shortcut[];
  recent: Shortcut[];
  opened: { name: string; ownerAvatarUrl?: string }[];
}

/** What the command palette shows for a query. */
export interface Suggestions {
  items: Suggestion[];
  /** Why what the user typed opens nothing, when nothing else matches it either. */
  problem?: string;
}

type Candidate = Omit<Suggestion, 'key' | 'tab' | 'tabLabel' | 'path'>;

/**
 * What the command palette suggests for `query` (FR-SRCH-12): the user's pins, then the dashboards
 * they viewed lately, then the public repositories opened on this BuhTig lately, each once. As the
 * user types, those whose names match the query best come first (`fuzzy`), and the resource that
 * the query names, in any form of Table 4-1, if it is none of them: first if the query is a
 * repository or a URL, so that pasting one and pressing Enter opens it, and else last. A tab's
 * name after the query, as in `owner/repo pulls`, turns each into its tabs of that name
 * (FR-SRCH-13). Nothing here waits on the server, so it is shown with each keystroke
 * (NFR-PERF-06).
 */
export function suggest(query: string, sources: Sources, host: string): Suggestions {
  const [target, ...rest] = query.trim().split(/\s+/);
  const word = rest.join(' ');
  const candidates = candidatesOf(sources);

  let ranked: Candidate[] = candidates;
  if (target !== '') {
    const needle = searchable(target, host);
    ranked = candidates
      .flatMap((candidate, index) => {
        const match = fuzzy(needle, candidate.name);
        return match ? [{ candidate: { ...candidate, matches: match.matches }, index, match }] : [];
      })
      .sort(
        (a, b) =>
          b.match.score - a.match.score ||
          a.candidate.name.length - b.candidate.name.length ||
          a.index - b.index,
      )
      .map(({ candidate }) => candidate);
  }

  const command = parseCommand(query, host);
  const typed = command.ok
    ? command.resource
    : command.problem.kind === 'bad-tab'
      ? command.problem.resource
      : undefined;
  if (typed !== undefined) {
    const at = ranked.findIndex((candidate) => isSame(candidate.resource, typed));
    if (/[/:.]/.test(target)) {
      const [first] =
        at >= 0
          ? ranked.splice(at, 1)
          : [
              candidates.find((candidate) => isSame(candidate.resource, typed)) ??
                typedCandidate(typed),
            ];
      ranked = [first, ...ranked];
    } else if (at < 0) {
      ranked = [...ranked, typedCandidate(typed)];
    }
  }

  const items = ranked.flatMap((candidate): Suggestion[] => {
    const kind = candidate.resource.kind;
    const tabs: (Tab | undefined)[] = word === '' ? [undefined] : tabsNamed(kind, word);
    return tabs.map((tab) => ({
      ...candidate,
      key: `${kind}:${candidate.name.toLowerCase()}:${tab ?? ''}`,
      tab,
      tabLabel: tab === undefined ? undefined : tabLabel(kind, tab),
      path: commandPath(candidate.resource, tab),
    }));
  });

  if (items.length > 0 || command.ok) {
    return { items };
  }
  const problem = command.problem;
  const unfinished =
    problem.kind === 'empty' ||
    (word === '' && isUnfinished(target, host)) ||
    (problem.kind === 'bad-tab' && problem.could.length > 1);
  return { items, problem: unfinished ? undefined : problemMessage(problem, host) };
}

/** The pins, then the dashboards viewed lately, then the repositories opened here lately, once. */
function candidatesOf({ pins, recent, opened }: Sources): Candidate[] {
  const personal = pick(pins, recent, Infinity).map((shortcut): Candidate => ({
    resource: resourceOf(shortcut),
    name: shortcut.name,
    source: shortcut.pinned ? 'pinned' : 'recent',
    matches: [],
  }));
  const seen = new Set(
    personal.map(({ resource, name }) => `${resource.kind}:${name.toLowerCase()}`),
  );
  const others = opened
    .filter(({ name }) => !seen.has(`repository:${name.toLowerCase()}`))
    .map(({ name, ownerAvatarUrl }): Candidate => ({
      resource: resourceOf({ kind: 'repository', name }),
      name,
      source: 'opened',
      matches: [],
      avatar: ownerAvatarUrl,
    }));
  return [...personal, ...others];
}

function typedCandidate(resource: Resource): Candidate {
  return { resource, name: resourceName(resource), source: 'typed', matches: [] };
}

/**
 * Whether `a` and `b` are the same dashboard, whatever the case of their names. An account named
 * alone is the organization's or the user's of its name.
 */
function isSame(a: Resource, b: Resource): boolean {
  const kinds = [a.kind, b.kind];
  const kindsMatch =
    a.kind === b.kind || (kinds.includes('account') && !kinds.includes('repository'));
  return kindsMatch && resourceName(a).toLowerCase() === resourceName(b).toLowerCase();
}

/**
 * What of `target` to match names against: a URL of GitHub at `host` without its scheme and
 * host, and an organization's or a user's without `orgs/` or `users/`, as in
 * `github.com/tokio-rs/ax`.
 */
function searchable(target: string, host: string): string {
  const name = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return target
    .replace(new RegExp(`^(?:[a-z]+://)?(?:[^/@]+@)?(?:www\\.)?${name}[/:]?`, 'i'), '')
    .replace(/^(?:orgs|users)\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
}
