import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';

/** What the server writes into the page when `ui.animations` is `false`. */
const STILL = 'meta[name="buhtig-animations"][content="off"]';

/**
 * Whether BuhTig may move: not when the browser asks for reduced motion, nor when its operator
 * has turned animations off for everyone with `ui.animations` (FR-ANIM-10). While it may not,
 * `<html>` has the class `still`, for styles to keep still by.
 */
@Injectable({ providedIn: 'root' })
export class Motion {
  private readonly document = inject(DOCUMENT);
  private readonly allowed = this.document.head.querySelector(STILL) === null;
  private readonly reduced = signal(false);

  /** Whether animations play in full. */
  readonly full = computed(() => this.allowed && !this.reduced());

  constructor() {
    // Not every environment has `matchMedia`; the tests' jsdom has none.
    if (typeof matchMedia === 'function') {
      const query = matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced.set(query.matches);
      // The browser's setting may change while the page is open.
      query.addEventListener?.('change', (event) => this.reduced.set(event.matches));
    }
    effect(() => this.document.documentElement.classList.toggle('still', !this.full()));
  }
}
