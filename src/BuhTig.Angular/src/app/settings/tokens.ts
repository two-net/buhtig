import { HttpClient, HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { Token, TokenAnswer, token } from '../session/session';

/** Why the server did not save a token. */
export type SaveProblem =
  /** What was pasted is no personal access token (FR-PAT-03). */
  | 'not_a_token'
  /** GitHub does not take the token, as one mistyped, revoked or expired (FR-PAT-02). */
  | 'rejected'
  /** The token is another GitHub account's (FR-PAT-02, AC-04). */
  | 'other_account'
  /** Too many tokens were checked from here in the past minute (NFR-SEC-08). */
  | 'too_many'
  /** BuhTig could not ask GitHub about the token. */
  | 'github'
  /** The user is no longer signed in. */
  | 'signed_out'
  | 'failed';

/** Saves and removes the signed-in user's personal access token (SRS §4.6). */
@Injectable({ providedIn: 'root' })
export class Tokens {
  private readonly http = inject(HttpClient);

  /**
   * Saves `value` as the user's token, in place of the one they had, once GitHub has said
   * that it is valid and theirs. It answers what BuhTig shows of the token, or fails with a
   * `SaveProblem`.
   */
  save(value: string): Observable<Token> {
    return this.http.put<TokenAnswer>('/-/api/token', { token: value }).pipe(
      map((answer) => token(answer)!),
      catchError((error: unknown) => throwError(() => problem(error))),
    );
  }

  /** Removes the user's token, and the data BuhTig cached with it (FR-PAT-05). */
  remove(): Observable<void> {
    return this.http.delete<void>('/-/api/token');
  }
}

function problem(error: unknown): SaveProblem {
  if (!(error instanceof HttpErrorResponse)) {
    return 'failed';
  }
  switch (error.status) {
    case HttpStatusCode.UnprocessableEntity: {
      const reason: unknown = error.error?.error;
      return reason === 'not_a_token' || reason === 'rejected' || reason === 'other_account'
        ? reason
        : 'failed';
    }
    case HttpStatusCode.TooManyRequests:
      return 'too_many';
    case HttpStatusCode.BadGateway:
      return 'github';
    case HttpStatusCode.Unauthorized:
      return 'signed_out';
    default:
      return 'failed';
  }
}
