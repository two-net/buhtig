// What the search box says, kept apart from its logic so that it can be translated
// (NFR-UX-07). Each message says what is wrong and what to do instead (NFR-UX-06).

import { BadTab, CommandProblem, tabWord, tabsOf } from './command';
import { Resource, dashboardPath } from './parse';

/**
 * FR-SRCH-09: what kind of resource the input names, shown as the user types. An account named
 * alone may be an organization or a user, which GitHub tells once its dashboard opens.
 */
export const KINDS = {
  repository: 'Repository',
  organization: 'Organization',
  user: 'User',
  account: 'Account',
} as const;

/** FR-SRCH-09: the name of the resource that the input names, such as "owner/repo". */
export function resourceName(resource: Resource): string {
  return dashboardPath(resource).slice(1);
}

/** The input's label, for assistive technology. */
export const LABEL = 'GitHub repository, organization or user URL';

/** What the input says while it is empty, by where it is. */
export const PLACEHOLDERS = {
  hero: 'github.com/owner/repo or github.com/owner',
  narrow: 'Repository, organization or user URL',
  header: 'Type / to open a dashboard',
} as const;

export const SHOW_DASHBOARD = 'Show dashboard';

export function problemMessage(problem: CommandProblem): string {
  switch (problem.kind) {
    case 'empty':
      return 'Paste a GitHub repository, organization or user URL.';
    case 'not-github':
      return 'BuhTig supports github.com URLs only.';
    case 'unrecognized':
      return 'Enter a repository, organization or user URL, such as github.com/owner/repo or github.com/owner.';
    case 'bad-account':
      return `“${problem.name}” is not a GitHub account name. Account names are up to 39 letters, digits and hyphens, and do not start with a hyphen.`;
    case 'bad-repository':
      return `“${problem.name}” is not a GitHub repository name. Repository names are up to 100 letters, digits, hyphens, underscores and periods.`;
    case 'bad-tab':
      return tabProblemMessage(problem);
  }
}

/** The dashboards whose tabs a problem with a tab speaks of, by the kind of their resource. */
const DASHBOARDS: Record<Resource['kind'], string> = {
  repository: "a repository's dashboard",
  organization: "an organization's dashboard",
  user: "a user's dashboard",
  account: "an organization's or a user's dashboard",
};

/**
 * FR-SRCH-13: why the words after a resource name none of its dashboard's tabs, and which they
 * may name.
 */
export function tabProblemMessage({ word, resource, could }: BadTab): string {
  const kind = resource.kind;
  if (could.length > 1) {
    return `“${word}” could be ${list(
      could.map((tab) => tabWord(kind, tab)),
      'or',
    )}. Type more of the tab's name.`;
  }
  const tabs = tabsOf(kind).map((tab) => tabWord(kind, tab));
  return `“${word}” is not a tab of ${DASHBOARDS[kind]}. Its tabs are ${list(tabs, 'and')}.`;
}

/** `items` in a sentence, such as "a, b and c". */
function list(items: string[], last: 'and' | 'or'): string {
  return items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`;
}
