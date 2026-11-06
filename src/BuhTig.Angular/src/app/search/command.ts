import {
  ORGANIZATION_TABS,
  OrganizationTab,
  REPOSITORY_TABS,
  RepositoryTab,
  organizationTabPath,
  repositoryTabPath,
} from '../dashboard/tabs';
import { Problem, Resource, dashboardPath, parse } from './parse';

// What the search box and the command palette take: a resource in any form of SRS Table 4-1, and
// after it, the name of one of its dashboard's tabs, as in `owner/repo pulls` or `org people`
// (FR-SRCH-13). Apart from `parse`, which other inputs, such as "Compare with…", take alone.

/** A tab of a dashboard, of any kind. */
export type Tab = RepositoryTab | OrganizationTab;

/** Why what the user typed after a resource names none of its dashboard's tabs. */
export interface BadTab {
  kind: 'bad-tab';
  /** What the user typed, in lowercase. */
  word: string;
  resource: Resource;
  /** The tabs that `word` is the beginning of, when it is that of more than one. */
  could: Tab[];
}

export type CommandProblem = Problem | BadTab;

export type Command =
  { ok: true; resource: Resource; tab?: Tab } | { ok: false; problem: CommandProblem };

/** The words that name each of a repository's tabs, its name first. */
const REPOSITORY_WORDS: Record<RepositoryTab, string[]> = {
  overview: ['overview'],
  activity: ['activity', 'commits'],
  issues: ['issues'],
  pulls: ['pulls', 'prs', 'pull requests'],
  contributors: ['contributors'],
  releases: ['releases', 'tags'],
};

/** The words that name each of an organization's tabs, its name first. A user has no People. */
const ACCOUNT_WORDS: Record<OrganizationTab, string[]> = {
  overview: ['overview'],
  repositories: ['repositories', 'repos'],
  people: ['people', 'members'],
};

/**
 * The tabs of the dashboard of a resource of `kind`, in their order. An account named alone may
 * be an organization, whose tabs it has, as `org people` asks.
 */
export function tabsOf(kind: Resource['kind']): Tab[] {
  switch (kind) {
    case 'repository':
      return REPOSITORY_TABS.map(({ tab }) => tab);
    case 'user':
      return ['overview', 'repositories'];
    default:
      return ORGANIZATION_TABS.map(({ tab }) => tab);
  }
}

/** The name of `tab`, as the user types it, such as `pulls`. */
export function tabWord(kind: Resource['kind'], tab: Tab): string {
  return wordsOf(kind, tab)[0];
}

/** The label of `tab`, as the dashboard's tab bar shows it, such as "Pull requests". */
export function tabLabel(kind: Resource['kind'], tab: Tab): string {
  const tabs: { tab: Tab; label: string }[] =
    kind === 'repository' ? REPOSITORY_TABS : ORGANIZATION_TABS;
  return tabs.find((info) => info.tab === tab)?.label ?? tab;
}

/**
 * The tabs of a resource of `kind` that `typed` names: the one it is a word of, or else those
 * that it is the beginning of a word of, as `pu` of Pull requests, whatever its letter case.
 */
export function tabsNamed(kind: Resource['kind'], typed: string): Tab[] {
  const word = typed.trim().toLowerCase().replace(/\s+/g, ' ');
  const tabs = tabsOf(kind);
  const exact = tabs.filter((tab) => wordsOf(kind, tab).includes(word));
  return exact.length > 0
    ? exact
    : tabs.filter((tab) => wordsOf(kind, tab).some((name) => name.startsWith(word)));
}

/**
 * The resource that `input` names, in any form of Table 4-1 on GitHub at `host`, and the tab of
 * its dashboard that the words after it name, if any (FR-SRCH-13), or why it names none.
 */
export function parseCommand(input: string, host: string): Command {
  const [target, ...rest] = input.trim().split(/\s+/);
  const parsed = parse(target, host);
  if (!parsed.ok || rest.length === 0) {
    return parsed;
  }
  const resource = parsed.resource;
  const word = rest.join(' ').toLowerCase();
  const tabs = tabsNamed(resource.kind, word);
  return tabs.length === 1
    ? { ok: true, resource, tab: tabs[0] }
    : { ok: false, problem: { kind: 'bad-tab', word, resource, could: tabs } };
}

/**
 * The path of `resource`'s dashboard, at `tab` (FR-NAV-01), such as `/owner/repo/pulls`. An
 * account named alone has an organization's People, which shows a user's overview should it be
 * one, and a user's Repositories, which leads to an organization's should it be one.
 */
export function commandPath(resource: Resource, tab?: Tab): string {
  if (tab === undefined || tab === 'overview') {
    return dashboardPath(resource);
  }
  switch (resource.kind) {
    case 'repository':
      return repositoryTabPath(`${resource.owner}/${resource.repo}`, tab as RepositoryTab);
    case 'organization':
      return organizationTabPath(resource.org, tab as OrganizationTab);
    case 'user':
      return `/${resource.login}?tab=repositories`;
    case 'account':
      return tab === 'people'
        ? organizationTabPath(resource.name, 'people')
        : `/${resource.name}?tab=repositories`;
  }
}

function wordsOf(kind: Resource['kind'], tab: Tab): string[] {
  return kind === 'repository'
    ? REPOSITORY_WORDS[tab as RepositoryTab]
    : ACCOUNT_WORDS[tab as OrganizationTab];
}
