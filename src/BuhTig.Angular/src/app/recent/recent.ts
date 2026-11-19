import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { dashboardPath, parseName } from '../search/parse';

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

/** A repository as the server tells of one in the shared cache. */
export interface RecentRepositoryAnswer {
  name: string;
  owner_avatar_url: string | null;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  pushed_at: string | null;
  fetched_at: string | null;
}

interface RecentAnswer {
  repositories: RecentRepositoryAnswer[];
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
      map(({ repositories }) => repositories.flatMap((answer) => recentRepository(answer) ?? [])),
      catchError(() => of([])),
    );
  }
}

/**
 * The repository the server tells of as `answer`, unless its name is not a repository's `owner/repo`
 * itself, such as a URL, or a deeper path, that `parse` would make one of.
 */
export function recentRepository(answer: RecentRepositoryAnswer): RecentRepository | undefined {
  const parsed = parseName(answer.name);
  if (
    !parsed.ok ||
    parsed.resource.kind !== 'repository' ||
    dashboardPath(parsed.resource) !== `/${answer.name}`
  ) {
    return undefined;
  }
  return {
    name: answer.name,
    ownerAvatarUrl: https(answer.owner_avatar_url),
    description: answer.description || undefined,
    language: answer.language || undefined,
    stars: count(answer.stars),
    forks: count(answer.forks),
    pushedAt: date(answer.pushed_at),
    fetchedAt: date(answer.fetched_at),
  };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
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
