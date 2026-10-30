import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { Icon } from '../icon/icon';
import { Resource } from '../search/parse';
import { Session } from '../session/session';
import { Toasts } from '../toast/toasts';
import { REFRESH, REFRESH_FAILED, refreshIn } from './messages';
import { Resources } from './resources';

/** How long a dashboard waits after a refresh before it may be refreshed again (FR-DATA-07). */
const WAIT_MS = 60_000;

/**
 * The button that fetches a dashboard's data from GitHub anew, rather than from BuhTig's cache,
 * for signed-in users alone (FR-DATA-07, FR-ACC-02). The server lets each dashboard be refreshed
 * once a minute, so the button then counts down to when it may be again.
 *
 * While the server is asked, the button does nothing, but keeps focus (NFR-UX-03). Once it has
 * refreshed, the dashboard asks for its data again, and says what came of it.
 */
@Component({
  selector: 'app-refresh',
  imports: [Icon],
  template: `
    @if (user()) {
      <button
        type="button"
        class="btn ghost sm"
        [attr.aria-disabled]="busy() || seconds() > 0 ? 'true' : null"
        (click)="refresh()"
      >
        <app-icon name="refresh" /><span>{{ label() }}</span>
      </button>
    }
  `,
  styles: ':host { display: contents; }',
})
export class Refresh {
  private readonly resources = inject(Resources);
  private readonly toasts = inject(Toasts);

  /** The dashboard's resource, as the URL names it. */
  readonly resource = input.required<Resource>();
  /** Says that the server has refreshed the dashboard, which now asks for its data again. */
  readonly refreshed = output();

  protected readonly user = inject(Session).user;

  /** Whether the server is being asked. */
  protected readonly busy = signal(false);
  /** When the dashboard may be refreshed again, if not yet. */
  private readonly until = signal<number | undefined>(undefined);
  private readonly now = signal(Date.now());

  protected readonly seconds = computed(() => {
    const until = this.until();
    return until === undefined ? 0 : Math.max(0, Math.ceil((until - this.now()) / 1000));
  });
  protected readonly label = computed(() =>
    this.seconds() > 0 ? refreshIn(this.seconds()) : REFRESH,
  );

  constructor() {
    // The clock of relative times ticks too seldom for seconds.
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected refresh(): void {
    if (this.busy() || this.seconds() > 0) {
      return;
    }
    this.busy.set(true);
    this.resources.refresh(this.resource()).subscribe((refreshed) => {
      this.busy.set(false);
      this.now.set(Date.now());
      switch (refreshed.status) {
        case 'refreshed':
          this.until.set(Date.now() + WAIT_MS);
          this.refreshed.emit();
          break;
        case 'too-soon':
          this.until.set(refreshed.until?.getTime() ?? Date.now() + WAIT_MS);
          break;
        case 'failed':
          this.toasts.show(REFRESH_FAILED, 'alert');
          break;
      }
    });
  }
}
