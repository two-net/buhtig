import { Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';
import { Icon } from '../icon/icon';
import { Resource } from '../search/parse';
import { Session } from '../session/session';
import { Personal, PinProblem } from '../shortcuts/personal';
import { Shortcut, sameDashboard, shortcutOf } from '../shortcuts/pick';
import { Toasts } from '../toast/toasts';
import { PIN, PINNED_LABEL, PIN_FAILED, PIN_LIMIT, pinned, unpinned } from './messages';

/**
 * The button that pins a dashboard, so that it comes first among the shortcuts on the home page,
 * or unpins it, for signed-in users alone (FR-PERS-02, FR-ACC-02). It is pressed while the
 * dashboard is pinned. A user may pin 12, and it says so when they have.
 *
 * While the server is asked, the button does nothing, but keeps focus (NFR-UX-03).
 */
@Component({
  selector: 'app-pin',
  imports: [Icon],
  template: `
    @if (user() && isPinned() !== undefined) {
      <button
        type="button"
        class="btn ghost sm"
        [attr.aria-pressed]="isPinned()"
        [attr.aria-disabled]="busy() ? 'true' : null"
        (click)="toggle()"
      >
        <app-icon [name]="isPinned() ? 'pin-fill' : 'pin'" />{{ isPinned() ? PINNED : PIN }}
      </button>
    }
  `,
  styles: ':host { display: contents; }',
})
export class Pin {
  private readonly personal = inject(Personal);
  private readonly toasts = inject(Toasts);

  /** The dashboard's resource, with the names as GitHub spells them. */
  readonly resource = input.required<Resource>();

  protected readonly user = inject(Session).user;

  private readonly shortcut = computed(() => shortcutOf(this.resource()));

  /** Whether the user pinned the dashboard, once the server says. */
  protected readonly isPinned = signal<boolean | undefined>(undefined);

  /** Whether the server is being asked. */
  protected readonly busy = signal(false);

  constructor() {
    // Nothing to ask for a visitor, and nothing to offer when the server cannot say.
    const asked = computed(() => ({ shortcut: this.shortcut(), user: this.user() }));
    toObservable(asked)
      .pipe(
        switchMap(({ shortcut, user }) =>
          user
            ? this.personal.list().pipe(
                map(({ pins }) => pins.some((pin) => sameDashboard(pin, shortcut))),
                catchError(() => of(undefined)),
              )
            : of(undefined),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((isPinned) => this.isPinned.set(isPinned));
  }

  protected toggle(): void {
    if (this.busy()) {
      return;
    }
    const shortcut = this.shortcut();
    this.busy.set(true);
    (this.isPinned() ? this.personal.unpin(shortcut) : this.personal.pin(shortcut)).subscribe({
      next: (pins: Shortcut[]) => {
        const isPinned = pins.some((pin) => sameDashboard(pin, shortcut));
        this.busy.set(false);
        this.isPinned.set(isPinned);
        this.toasts.show(
          isPinned ? pinned(shortcut.name) : unpinned(shortcut.name),
          isPinned ? 'pin-fill' : 'pin',
        );
      },
      error: (problem: PinProblem) => {
        this.busy.set(false);
        this.toasts.show(problem === 'too_many' ? PIN_LIMIT : PIN_FAILED, 'alert');
      },
    });
  }

  protected readonly PIN = PIN;
  protected readonly PINNED = PINNED_LABEL;
}
