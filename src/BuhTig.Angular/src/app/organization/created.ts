import { Component, computed, inject, input, signal } from '@angular/core';
import { Resources, YearCount } from '../dashboard/resources';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { createdDescription, createdTotal, yearSummary } from './messages';

/** How wide each year's column is in the chart, of which its bar takes `BAR`. */
const COLUMN = 10;
const BAR = 7;

/** How high the busiest year's bar is. */
const HEIGHT = 100;

/** How high a year's bar is at least, if it has repositories, so that it shows beside a busy year. */
const LEAST = 2;

/** The chart of the repositories created in each year, as it is drawn. */
interface Chart {
  /** The width of all the columns together. */
  width: number;
  bars: Bar[];
  /** The first and last years, which label the chart's ends. */
  first: number;
  last: number;
  description: string;
}

interface Bar {
  year: YearCount;
  /** Where its column starts. */
  column: number;
  height: number;
}

/**
 * How many of an organization's repositories were created in each year, from the first's to
 * this one (FR-ORG-06), as a bar chart. Pointing at a year tells its repositories. Its text
 * alternative is a sentence that says what it shows in all (NFR-UX-04).
 */
@Component({
  selector: 'app-organization-created',
  imports: [Loaded, Widget],
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

  /** The year pointed at, if any. */
  protected readonly pointed = signal<YearCount | undefined>(undefined);

  protected readonly caption = computed(() => {
    const state = this.years.state();
    const pointed = this.pointed();
    if (pointed !== undefined) {
      return yearSummary(pointed);
    }
    return state.status === 'ready' ? createdTotal(state.data) : '';
  });

  protected readonly offset = (COLUMN - BAR) / 2;
  protected readonly barWidth = BAR;
  protected readonly columnWidth = COLUMN;
  protected readonly height = HEIGHT;
}

/** How `years` are drawn: the busiest year's bar as high as the chart. */
function chart(years: YearCount[]): Chart {
  const busiest = Math.max(...years.map((year) => year.repositories));
  const bars = years.map((year, index) => ({
    year,
    column: index * COLUMN,
    height: year.repositories === 0 ? 0 : Math.max(LEAST, (year.repositories / busiest) * HEIGHT),
  }));
  return {
    width: years.length * COLUMN,
    bars,
    first: years[0].year,
    last: years[years.length - 1].year,
    description: createdDescription(years),
  };
}
