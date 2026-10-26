import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CompactNumber } from '../format/compact-number';

/** One of the bars of a chart: what it is of, and its figure. */
export interface Bar {
  label: string;
  value: number;
  /** The path of the dashboard that its label opens, if any. */
  path?: string;
}

/**
 * A chart of bars, one under another, each as long against the others as its figure is
 * (FR-ORG-04 to FR-ORG-06). Each says what it is of and its figure in words, so that the bars
 * themselves need no text alternative (NFR-UX-04), and no color tells anything (NFR-UX-05).
 */
@Component({
  selector: 'app-organization-bars',
  imports: [CompactNumber, RouterLink],
  templateUrl: './bars.html',
  styleUrl: './bars.css',
})
export class OrganizationBars {
  readonly bars = input.required<Bar[]>();
  /** What a figure counts, as a count of it, such as 12, takes: "repositories", say. */
  readonly unit = input.required<(count: number) => string>();

  /** How long each bar is, as a percentage: the longest the whole width. */
  protected readonly lengths = computed(() => {
    const bars = this.bars();
    const largest = Math.max(0, ...bars.map((bar) => bar.value));
    return bars.map((bar) => (largest > 0 ? (bar.value / largest) * 100 : 0));
  });
}
