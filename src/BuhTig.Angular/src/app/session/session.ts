import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, Injector, computed, inject, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, map, of, tap } from 'rxjs';

/** A signed-in user, as the server describes them (FR-AUTH-04). */
export interface User {
  login: string;
  /** The display name, which GitHub users may leave empty. */
  name: string | null;
  avatar_url: string;
  /** When the user signed in on this browser, as the server tells it. */
  signed_in_at?: string | null;
}

/**
 * What BuhTig shows of a signed-in user's personal access token (FR-PAT-04). The token itself
 * never leaves the server.
 */
export interface Token {
  type: 'classic' | 'fine_grained';
  /** The token's last four characters, to tell it apart by. */
  lastFour: string;
  /**
   * A classic token's scopes, as GitHub reported them, or `undefined` for a fine-grained token,
   * whose permissions GitHub does not report.
   */
  scopes: string[] | undefined;
  /** When the token expires, unless it never does. */
  expiresAt: Date | undefined;
  /**
   * `invalid` once GitHub rejects the token, as when it was revoked or has expired, or BuhTig
   * can no longer use it. The user's sign-in is used in its place until they replace it
   * (FR-PAT-07).
   */
  status: 'valid' | 'invalid';
  /** When GitHub last said that the token is valid and the user's. */
  lastValidatedAt: Date | undefined;
}

/** A token as the server describes it. */
export interface TokenAnswer {
  type: string | null;
  last_four: string | null;
  scopes: unknown;
  expires_at: string | null;
  status: string | null;
  last_validated_at: string | null;
}

/** Who is viewing BuhTig. */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly http = inject(HttpClient);

  /** Who the server said was viewing when the page loaded, and their token. */
  private readonly loaded = toSignal(
    this.http.get<{ user: User | null; token?: TokenAnswer | null }>('/-/api/session').pipe(
      map((session) => ({ user: session.user, token: token(session.token) })),
      catchError(() => of({ user: null, token: null })),
    ),
  );

  private readonly endedNow = signal(false);
  private readonly deletedNow = signal(false);

  /**
   * Whether the user was signed in when the page loaded, and has been signed out since, as when
   * GitHub no longer takes the credential they signed in with (FR-AUTH-09). Not when they deleted
   * their data, which signed them out as they asked.
   */
  readonly ended = computed(() => this.endedNow() && !this.deletedNow() && !!this.loaded()?.user);

  /** Whether the user deleted all their data since the page loaded, which signed them out. */
  readonly deleted = this.deletedNow.asReadonly();

  /** Whether the user who was signed in when the page loaded no longer is. */
  private readonly gone = computed(() => this.ended() || this.deleted());

  /**
   * The signed-in user, `null` for a visitor, or `undefined` until BuhTig knows. A visitor
   * also when the server cannot tell, so that it never stands in the way (NFR-UX-01).
   */
  readonly user = computed(() => (this.gone() ? null : this.loaded()?.user));

  private readonly currentToken = linkedSignal(() => (this.gone() ? null : this.loaded()?.token));

  /**
   * The signed-in user's personal access token, `null` if they have none or are a visitor, or
   * `undefined` until BuhTig knows.
   */
  readonly token = this.currentToken.asReadonly();

  /** Takes note that the server no longer takes the user's session. */
  end(): void {
    this.endedNow.set(true);
  }

  /** Takes note that the user saved `token`, or removed theirs. */
  setToken(token: Token | null): void {
    this.currentToken.set(token);
  }

  /**
   * Deletes the signed-in user and all that BuhTig keeps of theirs: their account, sessions,
   * credentials, private cache, history and pins (FR-PERS-04). That signs them out on every
   * browser, this one too.
   */
  deleteUser(): Observable<void> {
    return this.http.delete<void>('/-/api/user').pipe(tap(() => this.deletedNow.set(true)));
  }
}

/** The token that the server describes as `answer`, if any. */
export function token(answer: TokenAnswer | null | undefined): Token | null {
  if (!answer) {
    return null;
  }
  return {
    type: answer.type === 'fine_grained' ? 'fine_grained' : 'classic',
    lastFour: answer.last_four ?? '',
    scopes: Array.isArray(answer.scopes)
      ? answer.scopes.filter((scope): scope is string => typeof scope === 'string')
      : undefined,
    expiresAt: date(answer.expires_at),
    status: answer.status === 'valid' ? 'valid' : 'invalid',
    lastValidatedAt: date(answer.last_validated_at),
  };
}

function date(text: string | null | undefined): Date | undefined {
  const time = new Date(text ?? NaN);
  return isNaN(time.getTime()) ? undefined : time;
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
