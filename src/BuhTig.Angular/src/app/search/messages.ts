// What the search box says, kept apart from its logic so that it can be translated
// (NFR-UX-07). Each message says what is wrong and what to do instead (NFR-UX-06).

import { Problem, Resource } from './parse';

/** FR-SRCH-09: what kind of resource the input names, shown as the user types. */
export const KINDS = { repository: 'Repository', organization: 'Organization' } as const;

/** FR-SRCH-09: the name of the resource that the input names, such as "owner/repo". */
export function resourceName(resource: Resource): string {
  return resource.kind === 'repository' ? `${resource.owner}/${resource.repo}` : resource.org;
}

/** The input's label, for assistive technology. */
export const LABEL = 'GitHub repository or organization URL';

/** What the input says while it is empty, by where it is. */
export const PLACEHOLDERS = {
  hero: 'github.com/owner/repo or github.com/org',
  narrow: 'Repository or organization URL',
  header: 'Type / to open a dashboard',
} as const;

export const SHOW_DASHBOARD = 'Show dashboard';

export function problemMessage(problem: Problem): string {
  switch (problem.kind) {
    case 'empty':
      return 'Paste a GitHub repository or organization URL.';
    case 'not-github':
      return 'BuhTig supports github.com URLs only.';
    case 'unrecognized':
      return 'Enter a repository or organization URL, such as github.com/owner/repo or github.com/org.';
    case 'bad-account':
      return `“${problem.name}” is not a GitHub account name. Account names are up to 39 letters, digits and hyphens, and do not start with a hyphen.`;
    case 'bad-repository':
      return `“${problem.name}” is not a GitHub repository name. Repository names are up to 100 letters, digits, hyphens, underscores and periods.`;
  }
}
