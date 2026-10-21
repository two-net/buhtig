import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';

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

  /**
   * The signed-in user, `null` for a visitor, or `undefined` until BuhTig knows. A visitor
   * also when the server cannot tell, so that it never stands in the way (NFR-UX-01).
   */
  readonly user = toSignal(
    this.http.get<{ user: User | null }>('/-/api/session').pipe(
      map((session) => session.user),
      catchError(() => of(null)),
    ),
  );
}
