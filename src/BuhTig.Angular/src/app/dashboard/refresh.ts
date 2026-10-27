import { Component, inject, input, signal } from '@angular/core';
import { Session } from '../session/session';
import { REFRESH, REFRESHED_RECENTLY, REFRESH_FAILED } from './messages';
import { Resources } from './resources';
import { Resource } from '../search/parse';

/**
 * The button that fetches a dashboard's data from GitHub anew, rather than from BuhTig's cache,
 * for signed-in users alone (FR-DATA-07, FR-ACC-02). The server lets each dashboard be refreshed
 * once a minute, and the button says so when it is too soon.
 */
@Component({
  selector: 'app-refresh',
  template: `
    @if (user()) {
      <button type="button" [disabled]="busy()" (click)="refresh()">{{ REFRESH }}</button>
      <!-- Present before it says anything, so that what it says is announced. -->
      <span role="status">{{ note() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.75rem;
      align-items: baseline;
    }

    button {
      padding: 0.125rem 0.75rem;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: none;
      color: var(--text);
      font: inherit;
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      background: var(--raised);
    }

    button:disabled {
      cursor: progress;
    }
  `,
})
export class Refresh {
  private readonly resources = inject(Resources);

  /** The dashboard's resource, as the URL names it. */
  readonly resource = input.required<Resource>();

  protected readonly user = inject(Session).user;

  /** Whether the server is being asked. */
  protected readonly busy = signal(false);

  /** What came of the last refresh, if it did not refresh the dashboard. */
  protected readonly note = signal('');

  protected refresh(): void {
    this.busy.set(true);
    this.note.set('');
    this.resources.refresh(this.resource()).subscribe((refreshed) => {
      this.busy.set(false);
      this.note.set(
        refreshed.status === 'too-soon'
          ? REFRESHED_RECENTLY
          : refreshed.status === 'failed'
            ? REFRESH_FAILED
            : '',
      );
    });
  }

  protected readonly REFRESH = REFRESH;
}
