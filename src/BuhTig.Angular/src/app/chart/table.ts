import { Component, input } from '@angular/core';

/** One row of a chart's table: what it is of, and its figure in full. */
export interface Row {
  label: string;
  value: string;
}

/** A chart's data as a table: the headers of its two columns, and its rows. */
export interface ChartTable {
  headers: readonly [string, string];
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
            <th scope="col" class="num">{{ table().headers[1] }}</th>
          </tr>
        </thead>
        <tbody>
          @for (row of table().rows; track $index) {
            <tr>
              <th scope="row">{{ row.label }}</th>
              <td class="num">{{ row.value }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class DataTable {
  readonly table = input.required<ChartTable>();
}
