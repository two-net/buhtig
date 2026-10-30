// What the home pages say, kept apart from their logic so that it can be translated (NFR-UX-07).

export const HEADLINE = 'Every GitHub repository, at a glance';
export const LEDE =
  'Paste a repository or organization URL to see its activity, languages, contributors, issues ' +
  'and releases on one animated dashboard.';
export const TRY = 'Try';
/** What BuhTig shows, in three. */
export const FEATURES = [
  {
    icon: 'repo',
    title: 'Repository dashboards',
    text: 'Commit activity, languages, contributors, issues, pull requests and releases, read from GitHub and kept fresh.',
  },
  {
    icon: 'org',
    title: 'Organization insights',
    text: 'Every repository in an organization with its stars, languages and latest pushes, sortable and searchable.',
  },
  {
    icon: 'lock',
    title: 'Private when you need it',
    text: 'Sign in with GitHub, then add an optional personal access token to include private repositories you can read.',
  },
] as const;

/** UI-08 */
export const NOT_AFFILIATED = 'Not affiliated with GitHub.';
