// The titles of BuhTig's pages, kept apart from their logic so that they can be translated
// (NFR-UX-07).

/** UI-04: the titles of BuhTig's own pages, the home page's "BuhTig" alone. */
export const TITLES = {
  home: 'BuhTig',
  about: 'About · BuhTig',
  privacy: 'Privacy · BuhTig',
  settings: 'Settings · BuhTig',
  signIn: 'Sign in · BuhTig',
  notAllowed: 'Not allowed · BuhTig',
  signInFailed: 'Sign-in failed · BuhTig',
  notFound: 'Page not found · BuhTig',
};

/**
 * UI-04: a dashboard's title, after its resource's name, such as "owner/repo · BuhTig", or
 * "Issues · owner/repo · BuhTig" on a tab other than the overview.
 */
export function dashboardTitle(name: string, tab?: string): string {
  return tab && tab !== 'Overview' ? `${tab} · ${name} · BuhTig` : `${name} · BuhTig`;
}
