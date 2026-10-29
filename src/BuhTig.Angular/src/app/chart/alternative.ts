import { Component, input, signal } from '@angular/core';
import { HIDE_TABLE, SHOW_TABLE } from './messages';

/** One row of a chart's table: what it is of, and its figure in full. */
export interface Row {
  label: string;
  value: string;
}

/**
 * A chart's text alternative (NFR-UX-04): a sentence that says what it shows, for everyone to
 * read, and its data as a table, shown on request. Neither needs the chart's colors (NFR-UX-05).
 */
@Component({
  selector: 'app-chart-alternative',
  templateUrl: './alternative.html',
  styleUrl: './alternative.css',
})
export class ChartAlternative {
  readonly summary = input.required<string>();
  /** The headers of the table's columns: what a row is of, and what its figure is. */
  readonly headers = input.required<readonly [string, string]>();
  readonly rows = input.required<Row[]>();

  /** Whether the table is shown. */
  protected readonly open = signal(false);
  protected readonly show = SHOW_TABLE;
  protected readonly hide = HIDE_TABLE;
}
