import { Component, computed, inject, input } from '@angular/core';
import { Languages, Resources } from '../dashboard/resources';
import { percent } from '../format/format';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';

/** One language's part of the chart, or that of all the others, "Other". */
interface Segment {
  name: string;
  /** How it is told apart in the bar and the legend, a color of `languages.css`. */
  color: string;
  /** Where it starts in the bar, and how much of it it takes, of 100. */
  at: number;
  share: number;
  /** Its share, as the legend says it. */
  percent: string;
}

/**
 * How much of a repository's code is in each language (FR-REPO-04), as one bar split into
 * the 8 languages with the most code, most first, and the rest as "Other". The legend names
 * each with its share, in the same order, so that no one needs the colors (NFR-UX-05), and
 * it is the chart's text alternative too (NFR-UX-04).
 */
@Component({
  selector: 'app-repository-languages',
  imports: [Loaded, Widget],
  templateUrl: './languages.html',
  styleUrl: './languages.css',
})
export class RepositoryLanguages {
  private readonly resources = inject(Resources);

  /** The repository's names, as the URL has them. */
  readonly owner = input.required<string>();
  readonly repo = input.required<string>();

  protected readonly languages = load(
    () => this.resources.languages(this.owner(), this.repo()),
    (languages) => languages.total === 0,
  );

  protected readonly segments = computed(() => {
    const state = this.languages.state();
    return state.status === 'ready' ? segments(state.data) : [];
  });
}

function segments({ languages, other, total }: Languages): Segment[] {
  const parts = languages.map(({ name, bytes }, index) => ({
    name,
    bytes,
    color: `var(--language-${index + 1})`,
  }));
  if (other > 0) {
    parts.push({ name: 'Other', bytes: other, color: 'var(--language-other)' });
  }
  let at = 0;
  return parts.map(({ name, bytes, color }) => {
    const share = bytes / total;
    const segment = { name, color, at, share: share * 100, percent: percent(share) };
    at += share * 100;
    return segment;
  });
}
