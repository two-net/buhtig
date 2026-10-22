import { Component, input, signal } from '@angular/core';

let count = 0;

/**
 * Text in short, such as "12.3K" or "3 days ago", with its exact value in a tooltip on hover
 * and focus (UI-06). It takes the focus for that, so that keyboard users reach it too
 * (NFR-UX-03). Esc hides the tooltip until it is hovered or focused again, and pointing at the
 * tooltip keeps it (WCAG 1.4.13).
 */
@Component({
  selector: 'app-exact',
  templateUrl: './exact.html',
  styleUrl: './exact.css',
  host: {
    tabindex: '0',
    '[attr.aria-describedby]': 'id',
    '[class.dismissed]': 'dismissed()',
    '(document:keydown.escape)': 'dismissed.set(true)',
    '(focusin)': 'dismissed.set(false)',
    '(mouseenter)': 'dismissed.set(false)',
  },
})
export class Exact {
  /** The exact value, such as "12,345". */
  readonly value = input.required<string>();

  protected readonly id = `exact-${count++}`;
  protected readonly dismissed = signal(false);
}
