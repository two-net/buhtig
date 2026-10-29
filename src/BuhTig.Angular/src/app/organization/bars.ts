import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChartAlternative, Row } from '../chart/alternative';
import { CompactNumber } from '../format/compact-number';
import { exactNumber } from '../format/format';

/** One of the bars of a chart: what it is of, and its figure. */
export interface Bar {
  label: string;
  value: number;
  /** The path of the dashboard that its label opens, if any. */
  path?: string;
}

/**
 * A chart of bars, one under another, each as long against the others as its figure is
 * (FR-ORG-04 to FR-ORG-06). Each says what it is of and its figure in words, so that no color
 * tells anything (NFR-UX-05). Its text alternative is a sentence that says what it shows, and its
 * figures in full as a table on request (NFR-UX-04).
 */
@Component({
  selector: 'app-organization-bars',
  imports: [ChartAlternative, CompactNumber, RouterLink],
  templateUrl: './bars.html',
  styleUrl: './bars.css',
})
export class OrganizationBars {
  readonly bars = input.required<Bar[]>();
  /** What a figure counts, as a count of it, such as 12, takes: "repositories", say. */
  readonly unit = input.required<(count: number) => string>();
  readonly summary = input.required<string>();
  /** The headers of the table's columns: what a bar is of, and what its figure is. */
  readonly headers = input.required<readonly [string, string]>();

  protected readonly rows = computed<Row[]>(() =>
    this.bars().map(({ label, value }) => ({ label, value: exactNumber(value) })),
  );

  /** How long each bar is, as a percentage: the longest the whole width. */
  protected readonly lengths = computed(() => {
    const bars = this.bars();
    const largest = Math.max(0, ...bars.map((bar) => bar.value));
    return bars.map((bar) => (largest > 0 ? (bar.value / largest) * 100 : 0));
  });
}
