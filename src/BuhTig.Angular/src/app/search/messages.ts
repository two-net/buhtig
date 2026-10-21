// What the search box says, kept apart from its logic so that it can be translated
// (NFR-UX-07). Each message says what is wrong and what to do instead (NFR-UX-06).

import { Problem, Resource } from './parse';

/** FR-SRCH-09: what the input names, shown as the user types. */
export function resourceMessage(resource: Resource): string {
  return resource.kind === 'repository'
    ? `Repository · ${resource.owner}/${resource.repo}`
    : `Organization · ${resource.org}`;
}

export function problemMessage(problem: Problem): string {
  switch (problem.kind) {
    case 'empty':
      return 'Enter a GitHub repository or organization URL.';
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

/** FR-SRCH-06: BuhTig has dashboards for organizations, but not for users. */
export function userMessage(login: string): string {
  return `${login} is a GitHub user, not an organization. BuhTig shows repositories and organizations, so enter one of ${login}'s repositories, such as ${login}/repository-name.`;
}
