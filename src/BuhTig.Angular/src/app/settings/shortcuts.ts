import { Component, ElementRef, Injector, afterNextRender, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Avatar } from '../avatar/avatar';
import { RelativeTime } from '../format/relative-time';
import { Icon } from '../icon/icon';
import { Personal, Viewed } from '../shortcuts/personal';
import { Shortcut, sameDashboard } from '../shortcuts/pick';
import { Toasts } from '../toast/toasts';
import {
  CLEAR_FAILED,
  HISTORY_CLEARED,
  HISTORY_PURPOSE,
  NO_HISTORY,
  NO_PINS,
  PINS_FAILED,
  PINS_PURPOSE,
  SHORTCUTS_UNAVAILABLE,
  movedDown,
  movedUp,
  pinnedCount,
  unpinned,
} from './messages';

/**
 * The signed-in user's personal shortcuts, in Settings (§4.8): their pins, which they may put in
 * another order or unpin (FR-PERS-02, FR-PERS-05), and their history, with when they viewed each
 * dashboard, which they may clear (FR-PERS-03). Each change is a button, so that the keyboard
 * alone makes them all (NFR-UX-03), and focus stays where the change was.
 */
@Component({
  selector: 'app-shortcut-settings',
  imports: [Avatar, Icon, RelativeTime, RouterLink],
  templateUrl: './shortcuts.html',
})
export class ShortcutSettings {
  private readonly personal = inject(Personal);
  private readonly toasts = inject(Toasts);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The user's pins, in their order, once the server says. */
  protected readonly pins = signal<Shortcut[] | undefined>(undefined);
  /** The dashboards the user viewed, newest first, with when, once the server says. */
  protected readonly history = signal<{ shortcut: Viewed; at: Date | undefined }[] | undefined>(
    undefined,
  );
  /** Whether the server is changing the pins or the history. */
  protected readonly busy = signal(false);
  /** Why the last change did not happen, if it did not. */
  protected readonly problem = signal('');

  constructor() {
    this.personal
      .list()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: ({ pins, recent }) => {
          this.pins.set(pins);
          this.history.set(
            recent.map((shortcut) => {
              const at = new Date(shortcut.viewed_at ?? NaN);
              return { shortcut, at: isNaN(at.getTime()) ? undefined : at };
            }),
          );
        },
        error: () => this.problem.set(SHORTCUTS_UNAVAILABLE),
      });
  }

  /** Moves the pin at `index` one place up, or down for a `step` of 1 (FR-PERS-05). */
  protected move(index: number, step: -1 | 1): void {
    const pins = this.pins();
    if (this.busy() || pins === undefined) {
      return;
    }
    const order = [...pins];
    const [pin] = order.splice(index, 1);
    order.splice(index + step, 0, pin);
    this.start();
    this.personal.reorder(order).subscribe({
      next: (pins) => {
        this.pins.set(pins);
        this.finish(step < 0 ? movedUp(pin.name) : movedDown(pin.name), 'up');
        // On the button that moved it, unless the pin went as far as it goes that way.
        const at = pins.findIndex((other) => sameDashboard(other, pin));
        const onward = step < 0 ? at > 0 : at < pins.length - 1;
        const button = step < 0 === onward ? 'up' : 'down';
        this.focus(`.pins > li:nth-child(${at + 1}) .${button}`);
      },
      error: () =>
        this.fail(PINS_FAILED, `.pins > li:nth-child(${index + 1}) .${step < 0 ? 'up' : 'down'}`),
    });
  }

  /** Unpins the pin at `index` (FR-PERS-02). */
  protected unpin(index: number): void {
    const pin = this.pins()?.[index];
    if (this.busy() || pin === undefined) {
      return;
    }
    this.start();
    this.personal.unpin(pin).subscribe({
      next: (pins) => {
        this.pins.set(pins);
        this.finish(unpinned(pin.name), 'pin');
        // On the pin that took its place, or else the one before it, or else the heading.
        this.focus(
          pins.length > 0
            ? `.pins > li:nth-child(${Math.min(index, pins.length - 1) + 1}) .unpin`
            : '#shortcuts-heading',
        );
      },
      error: () => this.fail(PINS_FAILED, `.pins > li:nth-child(${index + 1}) .unpin`),
    });
  }

  /** Clears the user's history (FR-PERS-03). */
  protected clearHistory(): void {
    if (this.busy()) {
      return;
    }
    this.start();
    this.personal.clearHistory().subscribe({
      next: () => {
        this.history.set([]);
        this.finish(HISTORY_CLEARED, 'history');
        this.focus('#history-heading');
      },
      error: () => this.fail(CLEAR_FAILED, '.clear'),
    });
  }

  private start(): void {
    this.busy.set(true);
    this.problem.set('');
  }

  private finish(done: string, icon: 'up' | 'pin' | 'history'): void {
    this.busy.set(false);
    this.toasts.show(done, icon);
  }

  /** Says why a change did not happen, with focus back on the button, `selector`, to try again. */
  private fail(problem: string, selector: string): void {
    this.busy.set(false);
    this.problem.set(problem);
    this.focus(selector);
  }

  /**
   * Focuses what `selector` finds, once the page shows the change, in place of the button that
   * made it, which is gone or was disabled meanwhile.
   */
  private focus(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }

  protected readonly pinnedCount = pinnedCount;
  protected readonly PINS_PURPOSE = PINS_PURPOSE;
  protected readonly NO_PINS = NO_PINS;
  protected readonly HISTORY_PURPOSE = HISTORY_PURPOSE;
  protected readonly NO_HISTORY = NO_HISTORY;
}
