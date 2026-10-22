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
}

/** The server's answer about a repository or an organization. */
interface Answer {
  name: string;
  fetched_at?: string;
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
        ? this.http.get<Answer>(
            `/-/api/repositories/${encodeURIComponent(resource.owner)}/${encodeURIComponent(resource.repo)}`,
          )
        : this.http
            .get<{ login: string; fetched_at?: string }>(
              `/-/api/accounts/${encodeURIComponent(resource.org)}`,
            )
            .pipe(map(({ login, fetched_at }) => ({ name: login, fetched_at })));
    return answer.pipe(
      map(({ name, fetched_at }) => {
        // `owner/repo` or `org`, and nothing that `parse` would make one of, such as a URL.
        const parsed = parse(name);
        const path = `/${name}`;
        const fetchedAt = new Date(fetched_at ?? NaN);
        return {
          path:
            parsed.ok &&
            parsed.resource.kind === resource.kind &&
            dashboardPath(parsed.resource) === path
              ? path
              : undefined,
          fetchedAt: isNaN(fetchedAt.getTime()) ? undefined : fetchedAt,
        };
      }),
      catchError(() => of(undefined)),
    );
  }
}
