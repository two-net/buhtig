import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { Resource, dashboardPath, parse } from '../search/parse';

/** How GitHub spells the names of repositories and organizations. */
@Injectable({ providedIn: 'root' })
export class Canonical {
  private readonly http = inject(HttpClient);

  /**
   * The dashboard's path with the names as GitHub spells them (FR-NAV-04), and with the new
   * names of a repository that was renamed or transferred (FR-NAV-05). `undefined` when BuhTig
   * cannot tell, as for a resource that does not exist or is private: the dashboard then says
   * why it has no data.
   */
  path(resource: Resource): Observable<string | undefined> {
    const name =
      resource.kind === 'repository'
        ? this.http
            .get<{ name: string }>(
              `/-/api/repositories/${encodeURIComponent(resource.owner)}/${encodeURIComponent(resource.repo)}`,
            )
            .pipe(map((repository) => repository.name))
        : this.http
            .get<{ login: string }>(`/-/api/accounts/${encodeURIComponent(resource.org)}`)
            .pipe(map((account) => account.login));
    return name.pipe(
      map((name) => {
        // `owner/repo` or `org`, and nothing that `parse` would make one of, such as a URL.
        const parsed = parse(name);
        const path = `/${name}`;
        return parsed.ok &&
          parsed.resource.kind === resource.kind &&
          dashboardPath(parsed.resource) === path
          ? path
          : undefined;
      }),
      catchError(() => of(undefined)),
    );
  }
}
