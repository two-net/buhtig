import { Injectable } from '@angular/core';
import { Observable, Subscription } from 'rxjs';

/** FR-PERS-09: how many requests a watchlist's repositories may have on their way at once. */
export const MAX_AT_ONCE = 4;

/**
 * Lets a watchlist's repositories ask the server for their data a few at a time (FR-PERS-09), so
 * that a long watchlist asks GitHub for no more at once than a dashboard does. A request waits
 * for a slot, in the order it was made, and frees it once it completes or fails, or once nothing
 * waits for it any longer. Each watchlist page has its own.
 */
@Injectable()
export class Slots {
  /** How many requests are on their way. */
  private busy = 0;
  /** What starts each request that waits for a slot, the first first. */
  private readonly waiting: (() => void)[] = [];

  /** `request`, once a slot is free. */
  run<T>(request: Observable<T>): Observable<T> {
    return new Observable<T>((subscriber) => {
      let holds = false;
      let made: Subscription | undefined;
      const free = () => {
        if (holds) {
          holds = false;
          this.busy--;
          this.waiting.shift()?.();
        }
      };
      const start = () => {
        holds = true;
        this.busy++;
        made = request.subscribe({
          next: (value) => subscriber.next(value),
          error: (error: unknown) => {
            free();
            subscriber.error(error);
          },
          complete: () => {
            free();
            subscriber.complete();
          },
        });
      };
      if (this.busy < MAX_AT_ONCE) {
        start();
      } else {
        this.waiting.push(start);
      }
      return () => {
        const at = this.waiting.indexOf(start);
        if (at >= 0) {
          this.waiting.splice(at, 1);
        }
        made?.unsubscribe();
        free();
      };
    });
  }
}
