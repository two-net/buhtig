import { Injectable, signal } from '@angular/core';

/** Where the browser keeps that the user has turned `/` off. */
const OFF = 'buhtig.slash-off';

/**
 * Whether `/` focuses the search box (FR-SRCH-07). A shortcut of a single character is easy to
 * press by mistake, as speech input may, so the user can turn it off on the About page (WCAG
 * 2.1.4). The browser keeps the choice, and BuhTig never sees it (NFR-PRIV-01).
 */
@Injectable({ providedIn: 'root' })
export class Shortcut {
  private readonly on = signal(isOn());
  readonly enabled = this.on.asReadonly();

  /**
   * Turns `/` on or off. The browser's storage may be unavailable, as in a private window, or full;
   * then the choice lasts until the page is loaded again.
   */
  set(on: boolean): void {
    this.on.set(on);
    try {
      if (on) {
        localStorage.removeItem(OFF);
      } else {
        localStorage.setItem(OFF, '');
      }
    } catch {
      // As said above.
    }
  }
}

/** Whether `/` is on, as it is unless the browser has kept that it is off. */
function isOn(): boolean {
  try {
    return localStorage.getItem(OFF) === null;
  } catch {
    return true;
  }
}
