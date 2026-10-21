import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, firstValueFrom, map, of, timeout } from 'rxjs';

/**
 * How long the search box waits to learn whether an account is a user before it opens the
 * account's dashboard anyway. The server may wait much longer for GitHub.
 */
const PATIENCE_MS = 3000;

/** What BuhTig knows about GitHub accounts. */
@Injectable({ providedIn: 'root' })
export class Accounts {
  private readonly http = inject(HttpClient);

  /**
   * Whether `name` is a user's account rather than an organization's (FR-SRCH-06). False also
   * when BuhTig cannot tell, as when there is no such account or GitHub cannot be reached: the
   * dashboard then says why it has no data.
   */
  isUser(name: string): Promise<boolean> {
    return firstValueFrom(
      this.http.get<{ type: string }>(`/-/api/accounts/${encodeURIComponent(name)}`).pipe(
        timeout(PATIENCE_MS),
        map((account) => account.type === 'user'),
        catchError(() => of(false)),
      ),
    );
  }
}
