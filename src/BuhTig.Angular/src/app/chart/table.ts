import { Component, computed, input } from '@angular/core';

/** One row of a chart's table: what it is of, and its figures in full, one a column. */
export interface Row {
  label: string;
  values: readonly string[];
}

/**
 * A chart's data as a table: the headers of its columns, first that of what each row is of,
 * then those of its figures, and its rows.
 */
export interface ChartTable {
  headers: readonly [string, ...string[]];
  rows: Row[];
}

/**
 * A chart's data as a table, which shows in its place on request (NFR-UX-04). It needs none of
 * the chart's colors (NFR-UX-05).
 */
@Component({
  selector: 'app-data-table',
  template: `
    <div class="tbl-wrap dtable">
      <table class="tbl">
        <thead>
          <tr>
            <th scope="col">{{ table().headers[0] }}</th>
            @for (header of figures(); track $index) {
              <th scope="col" class="num">{{ header }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of table().rows; track $index) {
            <tr>
              <th scope="row">{{ row.label }}</th>
              @for (value of row.values; track $index) {
                <td class="num">{{ value }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class DataTable {
  readonly table = input.required<ChartTable>();

  /** The headers of the figures' columns. */
  protected readonly figures = computed(() => this.table().headers.slice(1));
}
