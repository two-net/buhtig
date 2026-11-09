import { ParamMap, Params } from '@angular/router';

// The place of the Issues and Pull requests tabs' lists in their URL, so that a view of either
// can be bookmarked and shared (FR-REPO-06). Their query is that of GitHub's own lists, at
// `/{owner}/{repo}/issues` and `/pulls`: `q`, in the syntax of GitHub's search, such as
// `is:issue is:open label:bug sort:created-asc`, and `page`, from 1. So replacing `github.host`
// with BuhTig's host in a link to one opens the same view, and back (FR-NAV-02).

/** What a tab lists: issues, or pull requests. */
export type IssueKind = 'issue' | 'pull_request';

/**
 * Which issues or pull requests a list shows, by state: open, closed, or both. Of pull requests,
 * `closed` are those closed without being merged, and `merged` those merged.
 */
export type IssueState = 'open' | 'closed' | 'merged' | 'all';

/** The order of a list: updated last first, or opened first first. */
export type IssueSort = 'updated' | 'oldest';

/** What a list shows: which, by state and label, in which order, and its page, from 0. */
export interface IssueView {
  state: IssueState;
  label: string | undefined;
  sort: IssueSort;
  page: number;
}

/** The list as it starts, as GitHub's does: the open ones, updated last first, its first page. */
export const DEFAULT_ISSUE_VIEW: IssueView = {
  state: 'open',
  label: undefined,
  sort: 'updated',
  page: 0,
};

/** The query parameters that hold a list's view, as GitHub's lists name them. */
export const ISSUE_LIST_PARAMS = ['q', 'page'] as const;

/** The longest name that GitHub gives a label. */
const MAX_LABEL = 50;

/** The states that the list of `kind` offers, in the order it offers them. */
export function statesOf(kind: IssueKind): IssueState[] {
  return kind === 'issue' ? ['open', 'closed', 'all'] : ['open', 'merged', 'closed', 'all'];
}

/**
 * The view of the list of `kind` that `params` give, whatever else they hold. Of `q`, only what
 * BuhTig can show is read: the state, of `is:` or `state:`, one label, of `label:`, and the order,
 * of `sort:`, `updated-desc` or `created-asc`. What it cannot show as GitHub would, it shows as
 * the list starts, each part on its own, so that no URL fails to open: of issues, a state that
 * only pull requests have; of pull requests, those closed whether merged or not (`is:closed`
 * alone), or those unmerged whether open or not (`is:unmerged` alone); more than one label, or one
 * whose name no label can have; or an order other than those two. Anything else in `q`, such as
 * `author:alice` or words to find, it leaves out. A `q` of the other kind, such as `is:pr` on the
 * Issues tab, is no view of this list's, which then starts as it does.
 *
 * Without `q`, the list starts as GitHub's does, with the open ones. With a `q` that says no
 * state, it shows them all, as GitHub does.
 */
export function issueViewOf(params: ParamMap, kind: IssueKind): IssueView {
  const page = pageIndexOf(params.get('page'));
  const q = params.get('q')?.trim();
  if (!q) {
    return { ...DEFAULT_ISSUE_VIEW, page };
  }
  const read = readQuery(q);
  if (read.kinds.size > 0 && !(read.kinds.size === 1 && read.kinds.has(kind))) {
    return { ...DEFAULT_ISSUE_VIEW, page };
  }
  const [label] = read.labels;
  return {
    state: stateOf(read.states, kind) ?? DEFAULT_ISSUE_VIEW.state,
    label: read.labels.length === 1 && isLabel(label) ? label : undefined,
    sort: sortOf(read.sort) ?? DEFAULT_ISSUE_VIEW.sort,
    page,
  };
}

/**
 * The query parameters of `view` of the list of `kind`, in GitHub's syntax, and `null` where it
 * is as the list starts, so that merging them into a URL leaves those out, and every other
 * parameter as it is. `q` names its order whenever it is there, so that GitHub, whose own lists
 * start with those opened last, shows the same.
 */
export function issueQueryOf(
  view: IssueView,
  kind: IssueKind,
): Record<(typeof ISSUE_LIST_PARAMS)[number], string | null> {
  const asStarts =
    view.state === DEFAULT_ISSUE_VIEW.state &&
    view.label === undefined &&
    view.sort === DEFAULT_ISSUE_VIEW.sort;
  const parts = [
    kind === 'issue' ? 'is:issue' : 'is:pr',
    ...stateQualifiers(view.state, kind),
    ...(view.label !== undefined ? [`label:${quoted(view.label)}`] : []),
    view.sort === 'oldest' ? 'sort:created-asc' : 'sort:updated-desc',
  ];
  return {
    q: asStarts ? null : parts.join(' '),
    page: view.page > 0 ? String(view.page + 1) : null,
  };
}

/** The list's query parameters in `url`, and none other, as they are. */
export function issueListParamsOf(url: string): Params {
  const query = new URLSearchParams(url.split('#')[0].split('?')[1] ?? '');
  return Object.fromEntries(
    ISSUE_LIST_PARAMS.flatMap((name) => {
      const value = query.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
}

/**
 * Whether `name` can be a label's that the server searches for: one of up to 50 characters,
 * without quotes or control characters, as GitHub's search takes it quoted, as the server checks.
 */
export function isLabel(name: string | undefined): name is string {
  const chars = [...(name ?? '')];
  return (
    name !== undefined &&
    chars.length > 0 &&
    chars.length <= MAX_LABEL &&
    !chars.some((char) => char === '"' || /\p{Cc}/u.test(char))
  );
}

/** What a `q` says, of what BuhTig reads: kinds, states, labels and order. */
interface ReadQuery {
  kinds: Set<IssueKind>;
  /** `open`, `closed`, `merged` and `unmerged`, as `is:` and `state:` name them. */
  states: Set<string>;
  labels: string[];
  sort: string | undefined;
}

/** What `q` says, in GitHub's syntax, of what BuhTig reads, each qualifier in any letter case. */
function readQuery(q: string): ReadQuery {
  const read: ReadQuery = { kinds: new Set(), states: new Set(), labels: [], sort: undefined };
  for (const term of terms(q)) {
    const colon = term.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const qualifier = term.slice(0, colon).toLowerCase();
    const value = unquoted(term.slice(colon + 1));
    const lower = value.toLowerCase();
    switch (qualifier) {
      case 'is':
      case 'type':
        if (lower === 'issue') {
          read.kinds.add('issue');
        } else if (lower === 'pr' || lower === 'pull-request') {
          read.kinds.add('pull_request');
        } else if (qualifier === 'is' && ['open', 'closed', 'merged', 'unmerged'].includes(lower)) {
          read.states.add(lower);
        }
        break;
      case 'state':
        if (lower === 'open' || lower === 'closed') {
          read.states.add(lower);
        }
        break;
      case 'label':
        read.labels.push(value);
        break;
      case 'sort':
        read.sort = lower;
        break;
    }
  }
  return read;
}

/**
 * The terms of `q`, apart where it has spaces, but not within quotes, as GitHub's search takes
 * them: `label:"good first issue"` is one.
 */
function terms(q: string): string[] {
  const found: string[] = [];
  let term = '';
  let quoting = false;
  for (const char of q) {
    if (char === '"') {
      quoting = !quoting;
    }
    if (/\s/.test(char) && !quoting) {
      if (term) {
        found.push(term);
      }
      term = '';
    } else {
      term += char;
    }
  }
  if (term) {
    found.push(term);
  }
  return found;
}

/** `value` without the quotes around it, if it has them. */
function unquoted(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

/** `label` as `q` names it: quoted, unless it is one word of letters, digits and dashes. */
function quoted(label: string): string {
  return /^[\p{L}\p{N}_.\/-]+$/u.test(label) ? label : `"${label}"`;
}

/**
 * The state of the list of `kind` that the states `is:` and `state:` name together are, or
 * `undefined` if they are none it shows as GitHub would.
 */
function stateOf(states: Set<string>, kind: IssueKind): IssueState | undefined {
  const named = [...states].sort().join(' ');
  if (kind === 'issue') {
    switch (named) {
      case '':
        return 'all';
      case 'open':
        return 'open';
      case 'closed':
        return 'closed';
      default:
        return undefined;
    }
  }
  switch (named) {
    case '':
      return 'all';
    // Open pull requests are unmerged all the same.
    case 'open':
    case 'open unmerged':
      return 'open';
    // Merged pull requests are closed all the same.
    case 'merged':
    case 'closed merged':
      return 'merged';
    case 'closed unmerged':
      return 'closed';
    default:
      return undefined;
  }
}

/** The order that `sort:` names, or `undefined` if it is none that BuhTig shows. */
function sortOf(sort: string | undefined): IssueSort | undefined {
  switch (sort) {
    case undefined:
    case 'updated':
    case 'updated-desc':
      return 'updated';
    case 'created-asc':
      return 'oldest';
    default:
      return undefined;
  }
}

/** What `q` says of `state`, of the list of `kind`, as GitHub's search reads it. */
function stateQualifiers(state: IssueState, kind: IssueKind): string[] {
  switch (state) {
    case 'open':
      return ['is:open'];
    case 'closed':
      return kind === 'issue' ? ['is:closed'] : ['is:closed', 'is:unmerged'];
    case 'merged':
      return ['is:merged'];
    case 'all':
      return [];
  }
}

/** The page, from 0, that `page` names, from 1: the first unless it is a whole number. */
function pageIndexOf(page: string | null): number {
  if (page === null || !/^\d+$/.test(page)) {
    return 0;
  }
  return Math.max(Number(page) - 1, 0);
}
