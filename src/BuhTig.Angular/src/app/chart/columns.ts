import { Component, computed, input, signal } from '@angular/core';
import { ChartAlternative, Row } from './alternative';

/** How wide each column is in the chart, of which its bar takes `BAR`. */
const COLUMN = 10;
const BAR = 7;

/** How high the tallest bar is. */
const HEIGHT = 100;

/** How high a bar is at least, if its figure is not 0, so that it shows beside a tall one. */
const LEAST = 2;

/** One of a chart's columns, such as a week: its figure, and what is said of it. */
export interface Column {
  value: number;
  /** What the caption says while it is pointed at, such as "Week of Oct 26, 2025: 12 commits". */
  readout: string;
  /** What it is of, and its figure in full, as its row of the table says them. */
  label: string;
  cell: string;
}

/**
 * A chart of columns side by side, such as the weeks of a year, each bar as high against the
 * others as its figure is. The labels of its axis go within it, under the bars.
 *
 * Its caption says what it shows in all, or what the column pointed at shows. The pointer points
 * at a column, and so do ← and →, Home and End once the chart has focus (NFR-UX-03).
 *
 * Its text alternative is a sentence that says what it shows, and its data as a table on request
 * (NFR-UX-04). The caption says nothing that those do not, so assistive technology skips it.
 */
@Component({
  selector: 'app-column-chart',
  imports: [ChartAlternative],
  templateUrl: './columns.html',
  styleUrl: './columns.css',
})
export class ColumnChart {
  readonly columns = input.required<Column[]>();
  /** What the caption says while no column is pointed at, such as "312 commits in the last year". */
  readonly total = input.required<string>();
  /** What the chart is, as assistive technology names it, such as "Commits per week". */
  readonly name = input.required<string>();
  readonly summary = input.required<string>();
  /** The headers of the table's columns: what a row is of, and what its figure is. */
  readonly headers = input.required<readonly [string, string]>();

  /** The column pointed at, by its index, if any. */
  protected readonly pointed = signal<number | undefined>(undefined);

  protected readonly caption = computed(() => {
    const pointed = this.pointed();
    const column = pointed === undefined ? undefined : this.columns()[pointed];
    return column?.readout ?? this.total();
  });

  /** How each column's bar is drawn: the tallest as high as the chart. */
  protected readonly bars = computed(() => {
    const columns = this.columns();
    const tallest = Math.max(...columns.map((column) => column.value));
    return columns.map((column, index) => ({
      at: index * COLUMN,
      height: column.value === 0 ? 0 : Math.max(LEAST, (column.value / tallest) * HEIGHT),
    }));
  });

  /** The width of all the columns together. */
  protected readonly width = computed(() => this.columns().length * COLUMN);

  protected readonly rows = computed<Row[]>(() =>
    this.columns().map(({ label, cell }) => ({ label, value: cell })),
  );

  protected readonly offset = (COLUMN - BAR) / 2;
  protected readonly barWidth = BAR;
  protected readonly columnWidth = COLUMN;
  protected readonly height = HEIGHT;

  /** Focus points at the last column, the latest, unless the pointer is on one already. */
  protected focus(): void {
    if (this.pointed() === undefined) {
      this.pointed.set(this.columns().length - 1);
    }
  }

  /** ← and → point at the column before and after, and Home and End at the first and last. */
  protected move(event: KeyboardEvent): void {
    const last = this.columns().length - 1;
    const pointed = this.pointed() ?? last;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = Math.max(0, pointed - 1);
        break;
      case 'ArrowRight':
        next = Math.min(last, pointed + 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.pointed.set(next);
  }
}
