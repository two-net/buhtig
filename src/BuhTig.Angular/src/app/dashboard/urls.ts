import { Known } from '../search/parse';

// Apart from the dashboard's code, which the home page loads only ahead of need, since the home
// page's shortcuts use them too.

/** Where the server answers about `resource`, and under which it refreshes, records and pins it. */
export function resourceUrl(resource: Known): string {
  switch (resource.kind) {
    case 'repository':
      return repositoryUrl(resource.owner, resource.repo);
    case 'organization':
      return organizationUrl(resource.org);
    case 'user':
      return userUrl(resource.login);
  }
}

/** Where the server answers about the repository `owner/repo`. */
export function repositoryUrl(owner: string, repo: string): string {
  return `/-/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** Where the server answers about the organization `org`. */
export function organizationUrl(org: string): string {
  return `/-/api/organizations/${encodeURIComponent(org)}`;
}

/** Where the server answers about the user `login`. */
export function userUrl(login: string): string {
  return `/-/api/users/${encodeURIComponent(login)}`;
}
