import { Component, DOCUMENT, effect, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ENDED } from './account/messages';
import { AnnouncerHost } from './live/announcer';
import { opensPalette } from './palette/keys';
import { Palette } from './palette/palette';
import { Session } from './session/session';
import { ToastHost, Toasts } from './toast/toasts';

/**
 * The app: the page the router shows, and what every page shares, which goes over it: toasts,
 * what assistive technology is told, and the command palette, which Ctrl+K, or ⌘K, opens and
 * closes on any page (FR-SRCH-12). The palette's code comes once the page is idle, apart from the
 * home page's (NFR-PERF-02), so that it opens at once.
 */
@Component({
  imports: [AnnouncerHost, Palette, RouterOutlet, ToastHost],
  selector: 'app-root',
  template: `
    <a class="sr skip" href="#main">Skip to content</a>
    <router-outlet />
    <app-toasts />
    <app-announcer />
    @defer (when palette(); prefetch on idle) {
      @if (palette()) {
        <app-palette (closed)="palette.set(false)" />
      }
    }
  `,
  host: { '(document:keydown)': 'togglePalette($event)' },
})
export class App {
  private readonly document = inject(DOCUMENT);

  /** Whether the command palette is open. */
  protected readonly palette = signal(false);

  constructor() {
    // The server may sign the user out while the page is open, as when GitHub rejects their
    // sign-in (FR-AUTH-09): they are told so once, and the page shows them signed out.
    const session = inject(Session);
    const toasts = inject(Toasts);
    effect(() => {
      if (session.ended()) {
        toasts.show(ENDED, 'logout');
      }
    });
  }

  /**
   * Opens the command palette on Ctrl+K, or ⌘K, instead of the browser's own search, and closes
   * it on the same keys. Not over another dialog, which has the user's attention.
   */
  protected togglePalette(event: KeyboardEvent): void {
    if (!opensPalette(event)) {
      return;
    }
    const open = this.palette();
    if (!open && this.document.querySelector('[role="dialog"][aria-modal="true"]') !== null) {
      return;
    }
    event.preventDefault();
    this.palette.set(!open);
  }
}
