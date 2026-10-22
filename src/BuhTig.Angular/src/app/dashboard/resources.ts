import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { Resource, dashboardPath, parse } from '../search/parse';

/** What a dashboard learns of its repository or organization before its widgets load. */
export interface Summary {
  /**
   * The dashboard's path with the names as GitHub spells them (FR-NAV-04), and with the new
   * names of a repository that was renamed or transferred (FR-NAV-05). `undefined` when the
   * server's answer names no such resource.
   */
  path: string | undefined;
  /** When BuhTig fetched the resource from GitHub (FR-DATA-06), unless the server says not. */
  fetchedAt: Date | undefined;
  /** What a repository's header shows, unless the resource is none, or the answer names none. */
  repository: Repository | undefined;
}

/** What a repository's header shows of it (FR-REPO-01). What GitHub does not say is left out. */
export interface Repository {
  /** `owner/repo`, as GitHub spells it. */
  name: string;
  /** An `https` URL. */
  ownerAvatarUrl: string | undefined;
  description: string | undefined;
  visibility: 'public' | 'private' | 'internal';
  archived: boolean;
  template: boolean;
  fork: boolean;
  /** The `owner/repo` of the repository that a fork was forked from. */
  parent: string | undefined;
  topics: string[];
  license: string | undefined;
  defaultBranch: string | undefined;
  /** An `http` or `https` URL, the only kinds BuhTig links to (NFR-SEC-03). */
  homepage: string | undefined;
  createdAt: Date | undefined;
  pushedAt: Date | undefined;
}

/** What a repository's stat cards show (FR-REPO-02). */
export interface Stats {
  stars: number;
  forks: number;
  /** Those who get the repository's notifications, not its stargazers. */
  watchers: number;
  /** Issues alone, though GitHub counts pull requests as issues too. */
  openIssues: number;
  openPullRequests: number;
  /** The release GitHub marks as the latest, if there is one. */
  latestRelease: Release | undefined;
}

export interface Release {
  tag: string;
  publishedAt: Date | undefined;
  /** Its page on GitHub (FR-REPO-12). */
  url: string | undefined;
}

/** The server's answer about a repository or an organization. */
interface Answer {
  name: string;
  fetched_at?: string;
  repository?: RepositoryAnswer;
}

/** The server's answer about a repository, for its header. */
interface RepositoryAnswer {
  name: string;
  fetched_at?: string;
  owner_avatar_url?: string | null;
  description?: string | null;
  visibility?: string;
  archived?: boolean;
  template?: boolean;
  fork?: boolean;
  parent?: string | null;
  topics?: string[];
  license?: string | null;
  default_branch?: string | null;
  homepage?: string | null;
  created_at?: string | null;
  pushed_at?: string | null;
}

/** The server's answer about a repository, for its stat cards. */
interface StatsAnswer {
  stars: number;
  forks: number;
  watchers: number;
  open_issues: number;
  open_pull_requests: number;
  latest_release: { tag: string; published_at: string | null; url: string | null } | null;
}

/** What BuhTig knows of repositories and organizations as a whole. */
@Injectable({ providedIn: 'root' })
export class Resources {
  private readonly http = inject(HttpClient);

  /**
   * What BuhTig knows of `resource`, or `undefined` when it cannot tell, as for a resource that
   * does not exist or is private: the dashboard then says why it has no data.
   */
  summary(resource: Resource): Observable<Summary | undefined> {
    const answer: Observable<Answer> =
      resource.kind === 'repository'
        ? this.http
            .get<RepositoryAnswer>(repositoryUrl(resource.owner, resource.repo))
            .pipe(map((repository) => ({ ...repository, repository })))
        : this.http
            .get<{ login: string; fetched_at?: string }>(
              `/-/api/accounts/${encodeURIComponent(resource.org)}`,
            )
            .pipe(map(({ login, fetched_at }) => ({ name: login, fetched_at })));
    return answer.pipe(
      map(({ name, fetched_at, repository }) => {
        const path = canonicalPath(name, resource.kind);
        return {
          path,
          fetchedAt: date(fetched_at),
          repository:
            repository !== undefined && path !== undefined ? header(repository) : undefined,
        };
      }),
      catchError(() => of(undefined)),
    );
  }

  /** The figures of the stat cards of the repository `owner/repo`, which fail as it does. */
  stats(owner: string, repo: string): Observable<Stats> {
    return this.http.get<StatsAnswer>(`${repositoryUrl(owner, repo)}/stats`).pipe(
      map((stats) => {
        const release = stats.latest_release;
        return {
          stars: stats.stars,
          forks: stats.forks,
          watchers: stats.watchers,
          openIssues: stats.open_issues,
          openPullRequests: stats.open_pull_requests,
          latestRelease: release
            ? {
                tag: release.tag,
                publishedAt: date(release.published_at),
                url: link(release.url, ['https:']),
              }
            : undefined,
        };
      }),
    );
  }
}

function repositoryUrl(owner: string, repo: string): string {
  return `/-/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/**
 * The path of the dashboard of `name`, an `owner/repo` or an `org` as the server gives it, if
 * it is one of a resource of `kind`, and nothing that `parse` would make one of, such as a URL.
 */
function canonicalPath(name: string, kind: Resource['kind']): string | undefined {
  const parsed = parse(name);
  const path = `/${name}`;
  return parsed.ok && parsed.resource.kind === kind && dashboardPath(parsed.resource) === path
    ? path
    : undefined;
}

function header(answer: RepositoryAnswer): Repository {
  const visibility = answer.visibility;
  const parent = answer.parent ?? undefined;
  return {
    name: answer.name,
    ownerAvatarUrl: link(answer.owner_avatar_url, ['https:']),
    description: answer.description || undefined,
    visibility: visibility === 'private' || visibility === 'internal' ? visibility : 'public',
    archived: answer.archived === true,
    template: answer.template === true,
    fork: answer.fork === true,
    parent:
      parent !== undefined && canonicalPath(parent, 'repository') !== undefined
        ? parent
        : undefined,
    topics: (answer.topics ?? []).filter((topic) => typeof topic === 'string'),
    license: answer.license || undefined,
    defaultBranch: answer.default_branch || undefined,
    homepage: link(answer.homepage, ['http:', 'https:']),
    createdAt: date(answer.created_at),
    pushedAt: date(answer.pushed_at),
  };
}

/** The time `text` tells, if it tells one. */
function date(text: string | null | undefined): Date | undefined {
  const time = new Date(text ?? NaN);
  return isNaN(time.getTime()) ? undefined : time;
}

/** `text` if it is an absolute URL with one of `protocols`, such as `https:`. */
function link(text: string | null | undefined, protocols: string[]): string | undefined {
  try {
    return text && protocols.includes(new URL(text).protocol) ? text : undefined;
  } catch {
    return undefined;
  }
}
