import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { dashboardPath, parse } from '../search/parse';

/**
 * A public repository whose dashboard someone opened on this BuhTig lately, as the shared cache
 * holds it (FR-DATA-04).
 */
export interface RecentRepository {
  /** `owner/repo`, as GitHub spells it. */
  name: string;
  /** An `https` URL. */
  ownerAvatarUrl: string | undefined;
  description: string | undefined;
  language: string | undefined;
  stars: number;
  forks: number;
  pushedAt: Date | undefined;
  /** When BuhTig last fetched it from GitHub, for someone who opened it. */
  fetchedAt: Date | undefined;
}

interface RecentAnswer {
  repositories: {
    name: string;
    owner_avatar_url: string | null;
    description: string | null;
    language: string | null;
    stars: number;
    forks: number;
    pushed_at: string | null;
    fetched_at: string | null;
  }[];
}

/**
 * The public repositories opened on this BuhTig lately, latest first: what the signed-in home
 * page shows of the instance, and what the visitor's suggests trying. They come from the shared
 * cache alone, never from what a personal access token read (FR-DATA-04).
 */
@Injectable({ providedIn: 'root' })
export class Recent {
  private readonly http = inject(HttpClient);

  /** Up to 8 of them, or none when the server cannot say. */
  list(): Observable<RecentRepository[]> {
    return this.http.get<RecentAnswer>('/-/api/recent').pipe(
      map(({ repositories }) =>
        repositories.flatMap((repository): RecentRepository[] => {
          // Only `owner/repo` itself, not a URL or a deeper path that `parse` would make one of.
          const parsed = parse(repository.name);
          if (
            !parsed.ok ||
            parsed.resource.kind !== 'repository' ||
            dashboardPath(parsed.resource) !== `/${repository.name}`
          ) {
            return [];
          }
          return [
            {
              name: repository.name,
              ownerAvatarUrl: https(repository.owner_avatar_url),
              description: repository.description || undefined,
              language: repository.language || undefined,
              stars: repository.stars,
              forks: repository.forks,
              pushedAt: date(repository.pushed_at),
              fetchedAt: date(repository.fetched_at),
            },
          ];
        }),
      ),
      catchError(() => of([])),
    );
  }
}

function date(text: string | null): Date | undefined {
  const time = new Date(text ?? NaN);
  return isNaN(time.getTime()) ? undefined : time;
}

function https(text: string | null): string | undefined {
  try {
    return text && new URL(text).protocol === 'https:' ? text : undefined;
  } catch {
    return undefined;
  }
}
