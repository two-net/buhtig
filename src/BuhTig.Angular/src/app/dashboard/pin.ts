import { Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';
import { Session } from '../session/session';
import { Personal, PinProblem } from '../shortcuts/personal';
import { Shortcut, sameDashboard, shortcutOf } from '../shortcuts/pick';
import { PIN, PINNED, PIN_FAILED, PIN_LIMIT, UNPIN, UNPINNED } from './messages';
import { Resource } from '../search/parse';

/**
 * The button that pins a dashboard, so that it comes first among the shortcuts on the home page,
 * or unpins it, for signed-in users alone (FR-PERS-02, FR-ACC-02). A user may pin 12, and the
 * button says so when they have.
 *
 * While the server is asked, the button does nothing, but keeps focus (NFR-UX-03). It then says
 * what came of it.
 */
@Component({
  selector: 'app-pin',
  template: `
    @if (user() && pinned() !== undefined) {
      <button type="button" [attr.aria-disabled]="busy() ? 'true' : null" (click)="toggle()">
        {{ pinned() ? UNPIN : PIN }}
      </button>
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

    button:hover:not([aria-disabled='true']) {
      background: var(--raised);
    }

    /* Dimmed, not only recolored, while the server is asked (NFR-UX-05). */
    button[aria-disabled='true'] {
      opacity: 0.6;
      cursor: progress;
    }
  `,
})
export class Pin {
  private readonly personal = inject(Personal);

  /** The dashboard's resource, as the URL names it. */
  readonly resource = input.required<Resource>();

  protected readonly user = inject(Session).user;

  private readonly shortcut = computed(() => shortcutOf(this.resource()));

  /** Whether the user pinned the dashboard, once the server says. */
  protected readonly pinned = signal<boolean | undefined>(undefined);

  /** Whether the server is being asked. */
  protected readonly busy = signal(false);

  /** What came of the last change. */
  protected readonly note = signal('');

  constructor() {
    // Nothing to ask for a visitor, and nothing to offer when the server cannot say.
    const asked = computed(() => ({ shortcut: this.shortcut(), user: this.user() }));
    toObservable(asked)
      .pipe(
        switchMap(({ shortcut, user }) =>
          user
            ? this.personal.list().pipe(
                map(({ pins }) => isPinned(pins, shortcut)),
                catchError(() => of(undefined)),
              )
            : of(undefined),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((pinned) => this.pinned.set(pinned));
  }

  protected toggle(): void {
    if (this.busy()) {
      return;
    }
    const shortcut = this.shortcut();
    this.busy.set(true);
    this.note.set('');
    (this.pinned() ? this.personal.unpin(shortcut) : this.personal.pin(shortcut)).subscribe({
      next: (pins) => {
        const pinned = isPinned(pins, shortcut);
        this.busy.set(false);
        this.pinned.set(pinned);
        this.note.set(pinned ? PINNED : UNPINNED);
      },
      error: (problem: PinProblem) => {
        this.busy.set(false);
        this.note.set(problem === 'too_many' ? PIN_LIMIT : PIN_FAILED);
      },
    });
  }

  protected readonly PIN = PIN;
  protected readonly UNPIN = UNPIN;
}

function isPinned(pins: Shortcut[], shortcut: Shortcut): boolean {
  return pins.some((pin) => sameDashboard(pin, shortcut));
}
