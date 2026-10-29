import { Resource } from '../search/parse';

// Apart from the dashboard's code, which the home page loads only ahead of need, since the home
// page's shortcuts use them too.

/** Where the server answers about `resource`, and under which it refreshes, records and pins it. */
export function resourceUrl(resource: Resource): string {
  return resource.kind === 'repository'
    ? repositoryUrl(resource.owner, resource.repo)
    : organizationUrl(resource.org);
}

/** Where the server answers about the repository `owner/repo`. */
export function repositoryUrl(owner: string, repo: string): string {
  return `/-/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** Where the server answers about the organization `org`. */
export function organizationUrl(org: string): string {
  return `/-/api/organizations/${encodeURIComponent(org)}`;
}
