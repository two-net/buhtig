import { Component, computed, input } from '@angular/core';
import { compactNumber } from '../format/format';

/** Where a point is in the chart, in hundredths of its width and height. */
export interface Point {
  x: number;
  y: number;
}

/** A run of days without a figure, from and to where it spans, in hundredths of the width. */
export interface Gap {
  from: number;
  to: number;
}

/** How far from the top and bottom the highest and lowest figures are, in hundredths. */
const PAD = 8;

/**
 * A line of a figure over days, such as a repository's stars as BuhTig observed them, with a dot
 * at each day that has one. Days without a figure are never drawn as zero: the line breaks over
 * them, and a hatched band marks them, so that a gap is told by more than a color (NFR-UX-05). Its
 * scale runs from the lowest figure to the highest, not from zero, with both told beside it. The
 * first and last days are told below it. Its line sweeps in as the widget around it makes its
 * entrance (FR-ANIM-06).
 *
 * Assistive technology reads its summary, and the widget around it shows its data as a table on
 * request (NFR-UX-04).
 */
@Component({
  selector: 'app-line-chart',
  template: `
    <div class="linechart" [style.--plot-h.px]="height()">
      <div class="plot" role="img" [attr.aria-label]="summary()">
        <div aria-hidden="true">
          @for (label of labels(); track label.at) {
            <div class="yl" [style.top.%]="label.at">
              <span>{{ label.text }}</span>
            </div>
          }
          @for (gap of gaps(); track gap.from) {
            <div class="gap" [style.left.%]="gap.from" [style.width.%]="gap.to - gap.from"></div>
          }
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false" aria-hidden="true">
          @for (segment of segments(); track $index) {
            <path class="line" [attr.d]="segment" />
          }
          @for (point of points(); track $index) {
            <path class="pt" [attr.d]="dot(point)" />
          }
        </svg>
      </div>
      <div class="xaxis" aria-hidden="true">
        <span>{{ first() }}</span>
        <span>{{ last() }}</span>
      </div>
    </div>
  `,
  styles: ':host { display: block; }',
})
export class LineChart {
  /** The figure of each day, oldest first, or `null` for a day without one. */
  readonly values = input.required<readonly (number | null)[]>();
  /** What the chart shows, in a sentence, as assistive technology reads it. */
  readonly summary = input.required<string>();
  /** The first and last days, as the axis below tells them. */
  readonly first = input('');
  readonly last = input('');
  readonly height = input(72);

  /** The lowest and highest figures. */
  private readonly range = computed(() => {
    const figures = this.values().filter((value): value is number => value !== null);
    return figures.length === 0
      ? undefined
      : { low: Math.min(...figures), high: Math.max(...figures) };
  });

  /** Where each day is across the chart: the only one in the middle. */
  private x(index: number): number {
    const count = this.values().length;
    return count <= 1 ? 50 : (index / (count - 1)) * 100;
  }

  /** Where a figure is up the chart: a flat line in the middle. */
  private y(value: number): number {
    const range = this.range();
    if (range === undefined || range.high === range.low) {
      return 50;
    }
    return PAD + (1 - (value - range.low) / (range.high - range.low)) * (100 - 2 * PAD);
  }

  /** The days with a figure, where they are. */
  readonly points = computed((): Point[] =>
    this.values().flatMap((value, index) =>
      value === null ? [] : [{ x: this.x(index), y: this.y(value) }],
    ),
  );

  /** The line through each run of days one after another with a figure, as SVG paths. */
  readonly segments = computed((): string[] => {
    const segments: string[] = [];
    let run: Point[] = [];
    const end = () => {
      if (run.length > 1) {
        segments.push(run.map(({ x, y }, i) => `${i ? 'L' : 'M'}${fixed(x)} ${fixed(y)}`).join(''));
      }
      run = [];
    };
    this.values().forEach((value, index) => {
      if (value === null) {
        end();
      } else {
        run.push({ x: this.x(index), y: this.y(value) });
      }
    });
    end();
    return segments;
  });

  /** The runs of days without a figure, each spanning halfway to the days either side. */
  readonly gaps = computed((): Gap[] => {
    const values = this.values();
    const half = values.length <= 1 ? 50 : 50 / (values.length - 1);
    const gaps: Gap[] = [];
    let start: number | undefined;
    values.forEach((value, index) => {
      if (value === null && start === undefined) {
        start = index;
      }
      if (value !== null && start !== undefined) {
        gaps.push(this.gap(start, index - 1, half));
        start = undefined;
      }
    });
    if (start !== undefined) {
      gaps.push(this.gap(start, values.length - 1, half));
    }
    return gaps;
  });

  private gap(from: number, to: number, half: number): Gap {
    return {
      from: Math.max(0, this.x(from) - half),
      to: Math.min(100, this.x(to) + half),
    };
  }

  /** The highest and lowest figures, where they are up the chart, or the one if they are one. */
  readonly labels = computed(() => {
    const range = this.range();
    if (range === undefined) {
      return [];
    }
    const label = (value: number) => ({ at: this.y(value), text: compactNumber(value) });
    return range.high === range.low ? [label(range.high)] : [label(range.high), label(range.low)];
  });

  /**
   * A dot at `point`: a line of no length with round ends, which stays round however the chart
   * is stretched.
   */
  protected dot({ x, y }: Point): string {
    return `M${fixed(x)} ${fixed(y)}h0`;
  }
}

function fixed(value: number): string {
  return value.toFixed(2);
}
