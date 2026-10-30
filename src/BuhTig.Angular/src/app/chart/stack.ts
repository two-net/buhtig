import { Component, computed, inject, input } from '@angular/core';
import { exactNumber, percent } from '../format/format';
import { Tip } from '../tip/tip';

/** One part of a split bar, such as a language: what it is, its figure, and its color. */
export interface Segment {
  label: string;
  value: number;
  color: string;
}

/** A part as the bar draws it, with its share of the whole and what the legend says of it. */
interface Part extends Segment {
  share: string;
  shown: string;
}

/**
 * One bar split into parts by their shares of the whole, such as languages by bytes of code,
 * with a legend that names each with its share or figure, in the same order, so that no one
 * needs the colors (NFR-UX-05). Pointing at a part tells its figure in full. The bar sweeps in
 * as the widget around it makes its entrance (FR-ANIM-06).
 */
@Component({
  selector: 'app-split-bar',
  template: `
    @if (label()) {
      <div class="sublabel">{{ label() }}</div>
    }
    <div class="stack" role="img" [attr.aria-label]="summary()">
      @for (part of parts(); track $index) {
        @if (part.value > 0) {
          <i
            [style.flex-grow]="part.value"
            [style.background]="part.color"
            (pointermove)="show(part, $event)"
            (pointerleave)="tip.hide()"
          ></i>
        }
      }
    </div>
    <ul class="legend">
      @for (part of parts(); track $index) {
        <li>
          <span class="sw" [style.background]="part.color"></span>
          <span class="nm">{{ part.label }}</span>
          <span class="pc">{{ part.shown }}</span>
        </li>
      }
    </ul>
  `,
  styles: ':host { display: block; }',
})
export class SplitBar {
  protected readonly tip = inject(Tip);

  readonly segments = input.required<Segment[]>();
  /** What the figures count, such as "bytes", as the tooltip says them. */
  readonly unit = input('');
  /** What the bar shows, in a sentence, as assistive technology reads it. */
  readonly summary = input.required<string>();
  /** Whether the legend gives each part's share, or else its figure. */
  readonly shares = input(true);
  /** What the bar is of, above it, such as "Issues". */
  readonly label = input('');

  protected readonly parts = computed((): Part[] => {
    const segments = this.segments();
    const total = segments.reduce((total, segment) => total + segment.value, 0) || 1;
    return segments.map((segment) => ({
      ...segment,
      share: percent(segment.value / total),
      shown: this.shares() ? percent(segment.value / total) : exactNumber(segment.value),
    }));
  });

  protected show(part: Part, event: PointerEvent): void {
    const unit = this.unit();
    this.tip.show(
      event.currentTarget as Element,
      {
        value: `${exactNumber(part.value)}${unit ? ` ${unit}` : ''} (${part.share})`,
        label: part.label,
        color: part.color,
      },
      event,
    );
  }
}
