import { HttpClient, HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

/** A signed-in user's watchlist: a name, and the repositories in it, in their order (§4.8). */
export interface Watchlist {
  id: number;
  name: string;
  /** Each `owner/repo`, as it was added: GitHub's spelling, or the user's. */
  repositories: string[];
}

/** FR-PERS-06: how many watchlists a user may have. */
export const MAX_WATCHLISTS = 10;

/** FR-PERS-07: how many repositories a watchlist may hold. */
export const MAX_REPOSITORIES = 25;

/** FR-PERS-06: how many characters a watchlist's name may have. */
export const MAX_NAME_LENGTH = 50;

/** Why the server did not change a user's watchlists, as it says, or that it could not. */
export type WatchlistProblem =
  /** The user has as many watchlists as they may (FR-PERS-06). */
  | 'too_many_watchlists'
  /** Another of the user's watchlists has the name, whatever its case (FR-PERS-06). */
  | 'name_taken'
  /** The watchlist would hold more repositories than it may (FR-PERS-07). */
  | 'too_many_repositories'
  /** The name is empty, too long, or has control characters (FR-PERS-06). */
  | 'invalid_name'
  /** A name cannot be a repository's (FR-SRCH-04). */
  | 'invalid_repositories'
  /** The user has no such watchlist, as when they deleted it elsewhere. */
  | 'not_found'
  | 'failed';

/** The watchlists that the server answers with, after a change. */
interface Answer {
  watchlists: Watchlist[];
}

/**
 * A signed-in user's watchlists (FR-PERS-06, FR-PERS-07): named lists of repositories of any
 * owners, kept by the server for them alone (FR-ACC-02). Each change answers all the user's
 * watchlists, in the order they were made, or fails with a `WatchlistProblem`.
 */
@Injectable({ providedIn: 'root' })
export class Watchlists {
  private readonly http = inject(HttpClient);

  /** The user's watchlists, in the order they were made. */
  list(): Observable<Watchlist[]> {
    return lists(this.http.get<Answer>('/-/api/watchlists'));
  }

  /**
   * Makes a watchlist named `name`, which holds `repositories` from the start, such as the user's
   * pinned repositories. It answers the new watchlist's `id` with all of them.
   */
  create(
    name: string,
    repositories: string[] = [],
  ): Observable<{ id: number; watchlists: Watchlist[] }> {
    const body = repositories.length > 0 ? { name, repositories } : { name };
    return this.http
      .post<{ id: number } & Answer>('/-/api/watchlists', body)
      .pipe(catchError(problem));
  }

  /** Renames the watchlist `id` to `name`. */
  rename(id: number, name: string): Observable<Watchlist[]> {
    return lists(this.http.put<Answer>(watchlistUrl(id), { name }));
  }

  /** Deletes the watchlist `id`, with the repositories in it. */
  remove(id: number): Observable<Watchlist[]> {
    return lists(this.http.delete<Answer>(watchlistUrl(id)));
  }

  /**
   * Adds `repositories` to the end of the watchlist `id`, in their order, or none of them if it
   * would hold too many (FR-PERS-07). One there already, whatever its case, keeps its place, with
   * its name spelled as now.
   */
  add(id: number, repositories: string[]): Observable<Watchlist[]> {
    return lists(this.http.post<Answer>(`${watchlistUrl(id)}/repositories`, { repositories }));
  }

  /** Takes `repository`, an `owner/repo`, out of the watchlist `id` (FR-PERS-07). */
  drop(id: number, repository: string): Observable<Watchlist[]> {
    const [owner, repo] = repository.split('/');
    const url = `${watchlistUrl(id)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    return lists(this.http.delete<Answer>(url));
  }

  /**
   * Puts the repositories of the watchlist `id` in the order of `repositories` (FR-PERS-07). Those
   * it leaves out follow, in the order they had.
   */
  reorder(id: number, repositories: string[]): Observable<Watchlist[]> {
    return lists(this.http.put<Answer>(`${watchlistUrl(id)}/repositories`, { repositories }));
  }
}

/** Where the server keeps the watchlist `id`. */
function watchlistUrl(id: number): string {
  return `/-/api/watchlists/${encodeURIComponent(id)}`;
}

/** The watchlists that `answer` gives, or the `WatchlistProblem` that says why it did not. */
function lists(answer: Observable<Answer>): Observable<Watchlist[]> {
  return answer.pipe(
    map(({ watchlists }) => watchlists),
    catchError(problem),
  );
}

/** The `WatchlistProblem` that `error` is the server's word for. */
function problem(error: unknown): Observable<never> {
  return throwError((): WatchlistProblem => {
    if (!(error instanceof HttpErrorResponse)) {
      return 'failed';
    }
    switch (error.status) {
      case HttpStatusCode.NotFound:
        return 'not_found';
      case HttpStatusCode.Conflict:
      case HttpStatusCode.UnprocessableEntity: {
        const said = (error.error as { error?: unknown } | null)?.error;
        return isProblem(said) ? said : 'failed';
      }
      default:
        return 'failed';
    }
  });
}

const PROBLEMS: readonly unknown[] = [
  'too_many_watchlists',
  'name_taken',
  'too_many_repositories',
  'invalid_name',
  'invalid_repositories',
] satisfies WatchlistProblem[];

function isProblem(value: unknown): value is WatchlistProblem {
  return PROBLEMS.includes(value);
}

/**
 * Why `name` cannot be a watchlist's, before the server is asked (FR-PERS-06): it is empty or too
 * long once trimmed, or has control characters, or another of `others` has it, whatever its case.
 * `undefined` if it can.
 */
export function nameProblem(
  name: string,
  others: readonly Watchlist[],
): 'invalid_name' | 'name_taken' | undefined {
  const trimmed = name.trim();
  const length = [...trimmed].length;
  if (length === 0 || length > MAX_NAME_LENGTH || /\p{Cc}/u.test(trimmed)) {
    return 'invalid_name';
  }
  const lower = trimmed.toLowerCase();
  return others.some((other) => other.name.toLowerCase() === lower) ? 'name_taken' : undefined;
}

/** Whether `a` and `b` name the same repository, whatever the case of their names. */
export function sameRepository(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
