import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, tap } from 'rxjs';

/** A signed-in user, as the server describes them (FR-AUTH-04). */
export interface User {
  login: string;
  /** The display name, which GitHub users may leave empty. */
  name: string | null;
  avatar_url: string;
}

/** Who is viewing BuhTig. */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly http = inject(HttpClient);

  /** Who the server said was viewing when the page loaded. */
  private readonly loaded = toSignal(
    this.http.get<{ user: User | null }>('/-/api/session').pipe(
      map((session) => session.user),
      catchError(() => of(null)),
    ),
  );

  private readonly endedNow = signal(false);

  /**
   * Whether the user was signed in when the page loaded, and has been signed out since, as when
   * GitHub no longer takes the credential they signed in with (FR-AUTH-09).
   */
  readonly ended = computed(() => this.endedNow() && !!this.loaded());

  /**
   * The signed-in user, `null` for a visitor, or `undefined` until BuhTig knows. A visitor
   * also when the server cannot tell, so that it never stands in the way (NFR-UX-01).
   */
  readonly user = computed(() => (this.ended() ? null : this.loaded()));

  /** Takes note that the server no longer takes the user's session. */
  end(): void {
    this.endedNow.set(true);
  }
}

/**
 * Where signing in starts, with the page to return to afterwards (FR-AUTH-05). The server
 * returns only to pages of BuhTig's own (NFR-SEC-04).
 */
export function signInUrl(returnTo: string): string {
  return `/-/auth/sign-in?return_to=${encodeURIComponent(returnTo)}`;
}

/**
 * Notices that the server no longer takes the user's session while the page is open: it answers
 * 401 to a request of BuhTig's own, as when GitHub has rejected the user's sign-in (FR-AUTH-09).
 */
export const noticeSignOut: HttpInterceptorFn = (request, next) => {
  // The session is asked for lazily: it makes a request itself as it is created.
  const injector = inject(Injector);
  return next(request).pipe(
    tap({
      error: (error: unknown) => {
        if (
          error instanceof HttpErrorResponse &&
          error.status === 401 &&
          request.url.startsWith('/-/api/')
        ) {
          injector.get(Session).end();
        }
      },
    }),
  );
};
