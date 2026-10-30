import { HttpClient, HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { resourceUrl } from '../dashboard/urls';
import { Shortcut, resourceOf } from './pick';

/** A signed-in user's pins, in their order, and what they viewed recently, newest first. */
export interface PinsAndHistory {
  pins: Shortcut[];
  recent: Viewed[];
}

/** A dashboard that the user viewed, and when they last did, as the server tells it. */
export interface Viewed extends Shortcut {
  viewed_at?: string;
}

/** Why the server did not pin or unpin a dashboard. */
export type PinProblem =
  /** The user has pinned 12 dashboards already, as many as they may (FR-PERS-02). */
  'too_many' | 'failed';

/**
 * A signed-in user's personal shortcuts (§4.8): the dashboards they viewed recently, and those
 * they pinned. The server keeps them, for signed-in users alone (FR-ACC-02).
 */
@Injectable({ providedIn: 'root' })
export class Personal {
  private readonly http = inject(HttpClient);

  /** The user's pins and recent dashboards. */
  list(): Observable<PinsAndHistory> {
    return this.http.get<PinsAndHistory>('/-/api/shortcuts');
  }

  /**
   * Records that the user viewed `shortcut`'s dashboard (FR-PERS-01). The dashboard is the same
   * whether or not the server could, so this never fails.
   */
  record(shortcut: Shortcut): Observable<void> {
    return this.http
      .post<void>(`${url(shortcut)}/view`, null)
      .pipe(catchError(() => of(undefined)));
  }

  /** Forgets every dashboard the user viewed (FR-PERS-03). Their pins stay. */
  clearHistory(): Observable<void> {
    return this.http.delete<void>('/-/api/history');
  }

  /**
   * Pins `shortcut`'s dashboard, after the user's other pins (FR-PERS-02). It answers the
   * user's pins, or fails with a `PinProblem`.
   */
  pin(shortcut: Shortcut): Observable<Shortcut[]> {
    return pins(this.http.put<{ pins: Shortcut[] }>(`${url(shortcut)}/pin`, null));
  }

  /** Unpins `shortcut`'s dashboard (FR-PERS-02), as `pin` does. */
  unpin(shortcut: Shortcut): Observable<Shortcut[]> {
    return pins(this.http.delete<{ pins: Shortcut[] }>(`${url(shortcut)}/pin`));
  }

  /** Puts the user's pins in the order of `order` (FR-PERS-05), as `pin` does. */
  reorder(order: Shortcut[]): Observable<Shortcut[]> {
    return pins(this.http.put<{ pins: Shortcut[] }>('/-/api/pins', { pins: order }));
  }
}

/** Where the server keeps what concerns `shortcut`'s dashboard. */
function url(shortcut: Shortcut): string {
  return resourceUrl(resourceOf(shortcut));
}

/** The pins that `answer` gives, or the `PinProblem` that says why it did not. */
function pins(answer: Observable<{ pins: Shortcut[] }>): Observable<Shortcut[]> {
  return answer.pipe(
    map(({ pins }) => pins),
    catchError((error: unknown) =>
      throwError((): PinProblem =>
        error instanceof HttpErrorResponse && error.status === HttpStatusCode.Conflict
          ? 'too_many'
          : 'failed',
      ),
    ),
  );
}
