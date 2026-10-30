import { Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { compactNumber, exactNumber } from '../format/format';
import { Tip } from '../tip/tip';
import { READ_WITH_KEYS } from './messages';

/** One of a chart's columns, such as a week: its figure, and what it is of. */
export interface Column {
  value: number;
  /** What it is of, as its tooltip says, such as "Week of Oct 26, 2025". */
  label: string;
}

/** A label of a chart's axis, under the column at `at`, such as a month. */
export interface Tick {
  at: number;
  label: string;
  /** Whether it is left out on narrow screens, as all months but each quarter's first are. */
  minor: boolean;
}

/**
 * A chart of columns side by side, such as the weeks of a year, each bar as high against the
 * gridlines as its figure is. Pointing at a column tells its figure, and so do ← and →, Home and
 * End once the chart has focus, and Esc stops (NFR-UX-03). Its bars grow as the widget around it
 * makes its entrance (FR-ANIM-06).
 *
 * Assistive technology reads its summary, and the widget around it shows its data as a table on
 * request (NFR-UX-04).
 */
@Component({
  selector: 'app-column-chart',
  template: `
    <div class="colchart" [style.--plot-h.px]="height()">
      <div
        class="plot"
        [class.capped]="caps()"
        [class.kbd]="keyboard() && active() !== undefined"
        tabindex="0"
        role="img"
        [attr.aria-label]="label()"
        (keydown)="move($event)"
        (blur)="leave()"
      >
        <div aria-hidden="true">
          @for (line of grid(); track line.value) {
            <div class="gl" [class.base]="line.value === 0" [style.bottom.%]="line.at">
              <span>{{ line.label }}</span>
            </div>
          }
        </div>
        <div class="bars" aria-hidden="true" (pointerleave)="leave()">
          @for (bar of bars(); track $index) {
            <div
              class="col"
              [class.active]="active() === $index"
              [style.--h]="bar.height + '%'"
              [style.--i]="$index"
              (pointermove)="point($index, $event)"
            >
              @if (caps() && bar.value > 0) {
                <b>{{ bar.cap }}</b>
              }
              <i></i>
            </div>
          }
        </div>
      </div>
      <div class="xaxis" aria-hidden="true">
        @for (tick of ticks(); track tick.at) {
          <span
            [class.minor]="tick.minor"
            [style.left.%]="((tick.at + 0.5) / bars().length) * 100"
            >{{ tick.label }}</span
          >
        }
      </div>
    </div>
  `,
  styles: ':host { display: block; }',
})
export class ColumnChart {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tip = inject(Tip);

  readonly columns = input.required<Column[]>();
  readonly ticks = input<Tick[]>([]);
  /** What the figures count, such as "commits", as the tooltip says them. */
  readonly unit = input('');
  /** What the chart shows, in a sentence, as assistive technology reads it. */
  readonly summary = input.required<string>();
  readonly height = input(180);
  /** Whether each column's figure shows above its bar. */
  readonly caps = input(false);

  /** The column pointed at, by its index, if any, and whether the keyboard points at it. */
  protected readonly active = signal<number | undefined>(undefined);
  protected readonly keyboard = signal(false);

  protected readonly label = computed(() => `${this.summary()} ${READ_WITH_KEYS}`);

  /** The top of the chart: a round figure at least as high as the tallest column. */
  private readonly top = computed(() =>
    niceMax(Math.max(0, ...this.columns().map((c) => c.value))),
  );

  protected readonly grid = computed(() => {
    const top = this.top();
    return [0, top / 2, top]
      .filter((value) => Number.isInteger(value))
      .map((value) => ({ value, at: (value / top) * 100, label: compactNumber(value) }));
  });

  protected readonly bars = computed(() => {
    const top = this.top();
    return this.columns().map(({ value }) => ({
      value,
      height: ((value / top) * 100).toFixed(2),
      cap: compactNumber(value),
    }));
  });

  protected point(index: number, event: PointerEvent): void {
    this.keyboard.set(false);
    this.show(index, event);
  }

  protected leave(): void {
    this.active.set(undefined);
    this.keyboard.set(false);
    this.tip.hide();
  }

  /** ← and → point at the column before and after, Home and End at the first and last. */
  protected move(event: KeyboardEvent): void {
    const last = this.columns().length - 1;
    if (last < 0) {
      return;
    }
    const active = this.active();
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = active === undefined ? 0 : Math.min(last, active + 1);
        break;
      case 'ArrowLeft':
        next = active === undefined ? last : Math.max(0, active - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      case 'Escape':
        this.leave();
        return;
      default:
        return;
    }
    event.preventDefault();
    this.keyboard.set(true);
    this.show(next);
  }

  private show(index: number, event?: PointerEvent): void {
    this.active.set(index);
    const bar = this.host.nativeElement.querySelectorAll('.col i')[index];
    const column = this.columns()[index];
    if (bar === undefined || column === undefined) {
      return;
    }
    const unit = this.unit();
    this.tip.show(
      bar,
      {
        value: unit ? `${exactNumber(column.value)} ${unit}` : exactNumber(column.value),
        label: column.label,
        color: 'var(--s1)',
      },
      event,
    );
  }
}

/** A round figure at least `max`, such as 50 for 42, for the top gridline. */
export function niceMax(max: number): number {
  if (max <= 0) {
    return 1;
  }
  const power = 10 ** Math.floor(Math.log10(max));
  const step = max / power;
  return (step <= 1 ? 1 : step <= 2 ? 2 : step <= 2.5 ? 2.5 : step <= 5 ? 5 : 10) * power;
}
