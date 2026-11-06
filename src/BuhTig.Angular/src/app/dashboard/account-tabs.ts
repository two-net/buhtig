import { Params } from '@angular/router';
import { AccountTab, TabInfo, UserTab, organizationTabPath } from './tabs';

// Where an account's tabs are, apart from `tabs.ts`, which the routes need, and so the home page
// too: only dashboards need these, which load them with their own code (NFR-PERF-02).

export const USER_TABS: TabInfo<UserTab>[] = [
  { tab: 'overview', label: 'Overview', icon: 'home' },
  { tab: 'repositories', label: 'Repositories', icon: 'repo' },
];

/** Where a tab is: its path, and its query, as of a user's tab at `?tab=repositories`. */
export interface TabUrl {
  link: string;
  query?: Params;
}

/**
 * Where the `tab` of the account `login` is, as on GitHub: an organization's at its path, such as
 * `/orgs/org/repositories`, and a user's below `/{user}`, such as `/{user}?tab=repositories`. An
 * account of a kind not known yet has a user's tabs, which lead to an organization's. A user has
 * no People, which is their overview.
 */
export function accountTabUrl(
  login: string,
  kind: 'organization' | 'user' | undefined,
  tab: AccountTab,
): TabUrl {
  if (kind === 'organization') {
    return { link: organizationTabPath(login, tab) };
  }
  return tab === 'repositories'
    ? { link: `/${login}`, query: { tab: 'repositories' } }
    : { link: `/${login}` };
}

/** `url` as one string, such as `/mona?tab=repositories`. */
export function urlOf({ link, query }: TabUrl): string {
  const search = new URLSearchParams(query ?? {}).toString();
  return search ? `${link}?${search}` : link;
}
