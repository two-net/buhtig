import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Entrance } from '../motion/entrance';
import { Exact } from './exact';
import { compactNumber, exactNumber } from './format';

/** How long a figure takes to count up to its value (FR-ANIM-05). */
const COUNT_UP_MS = 900;

/**
 * A number in short, such as "12.3K", with the exact number on hover and focus (UI-06). A
 * number that is short already, such as "42", is shown as it is, and takes no focus.
 *
 * A stat card's counts up to its value from 0 as the widget around it makes its entrance
 * (FR-ANIM-05). Meanwhile assistive technology reads the value alone.
 */
@Component({
  selector: 'app-compact-number',
  imports: [Exact],
  templateUrl: './compact-number.html',
  styleUrl: './compact-number.css',
})
export class CompactNumber {
  private readonly entrance = inject(Entrance, { optional: true });

  readonly value = input.required<number>();
  /** Whether it counts up to its value as the widget around it makes its entrance. */
  readonly countUp = input(false);

  protected readonly compact = computed(() => compactNumber(this.value()));
  protected readonly exact = computed(() => exactNumber(this.value()));
  /** What it shows while it counts up. */
  protected readonly counted = signal<string | undefined>(undefined);

  constructor() {
    effect((onCleanup) => {
      if (!this.countUp() || !this.entrance?.playing()) {
        return;
      }
      const value = untracked(this.value);
      let start: number | undefined;
      let frame: number;
      const step = (now: number) => {
        start ??= now;
        const progress = Math.min(1, (now - start) / COUNT_UP_MS);
        if (progress === 1) {
          this.counted.set(undefined);
          return;
        }
        // Quick at first, and slower as it nears the value.
        this.counted.set(compactNumber(Math.round(value * (1 - (1 - progress) ** 3))));
        frame = requestAnimationFrame(step);
      };
      this.counted.set(compactNumber(0));
      frame = requestAnimationFrame(step);
      onCleanup(() => {
        cancelAnimationFrame(frame);
        this.counted.set(undefined);
      });
    });
  }
}
