import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** How often the time moves on: often enough for times told in minutes. */
const TICK_MS = 15_000;

/** The time now, for times told relative to it, such as "Updated 4 minutes ago". */
@Injectable({ providedIn: 'root' })
export class Clock {
  private readonly time = signal(Date.now());

  /** Milliseconds since the epoch, as of the last tick. */
  readonly now = this.time.asReadonly();

  constructor() {
    const timer = setInterval(() => this.time.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
