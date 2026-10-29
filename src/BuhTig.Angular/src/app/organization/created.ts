import { Component, computed, inject, input } from '@angular/core';
import { Column, ColumnChart } from '../chart/columns';
import { Resources, YearCount } from '../dashboard/resources';
import { exactNumber } from '../format/format';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import {
  CREATED_CHART,
  CREATED_HEADERS,
  createdDescription,
  createdTotal,
  yearSummary,
} from './messages';

/** The chart of the repositories created in each year, as it is drawn. */
interface Chart {
  columns: Column[];
  /** The first and last years, which label the chart's ends. */
  first: number;
  last: number;
  total: string;
  summary: string;
}

/**
 * How many of an organization's repositories were created in each year, from the first's to
 * this one (FR-ORG-06), as a chart of columns. Pointing at a year tells its repositories. Its
 * text alternative says what it shows in all, and lists every year's repositories on request
 * (NFR-UX-04).
 */
@Component({
  selector: 'app-organization-created',
  imports: [ColumnChart, Loaded, Widget],
  templateUrl: './created.html',
  styleUrl: './created.css',
})
export class OrganizationCreated {
  private readonly resources = inject(Resources);

  /** The organization's login, as the URL has it. */
  readonly org = input.required<string>();

  protected readonly years = load(
    () => this.resources.createdPerYear(this.org()),
    (years) => years.length === 0,
  );

  protected readonly chart = computed(() => {
    const state = this.years.state();
    return state.status === 'ready' ? chart(state.data) : undefined;
  });

  protected readonly name = CREATED_CHART;
  protected readonly headers = CREATED_HEADERS;
}

/** How `years` are drawn, a column for each. */
function chart(years: YearCount[]): Chart {
  return {
    columns: years.map((year) => ({
      value: year.repositories,
      readout: yearSummary(year),
      label: String(year.year),
      cell: exactNumber(year.repositories),
    })),
    first: years[0].year,
    last: years[years.length - 1].year,
    total: createdTotal(years),
    summary: createdDescription(years),
  };
}
