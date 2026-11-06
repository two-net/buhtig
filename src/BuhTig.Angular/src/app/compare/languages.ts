import { Component, computed, inject } from '@angular/core';
import { Segment, SplitBar } from '../chart/stack';
import { ChartTable } from '../chart/table';
import { percent } from '../format/format';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { ComparisonData, Shares } from './data';
import {
  IN_OTHER,
  LANGUAGE,
  LANGUAGES,
  NO_LANGUAGES,
  NO_LANGUAGES_EITHER,
  OTHER,
  bothSides,
  pairHeaders,
  sentence,
  sideLanguages,
} from './messages';

/** How many colors the charts have before "Other"'s gray. */
const COLORS = 8;

/** One side's languages, as the comparison draws them. */
interface Side {
  name: string;
  segments: Segment[];
  summary: string;
}

/**
 * Two repositories' languages, by their shares of the code, or two accounts', by their shares of
 * the repositories that have each as primary language, as two split bars side by side, the first
 * on the left as their heads are (FR-CMP-04). A language has the same color in both, so the two
 * read alike, and each bar's legend names every language with its share, so that no one needs
 * the colors (NFR-UX-05). Its summary says which language has the largest share of each, and its
 * table lists each language's share of both (NFR-UX-04).
 */
@Component({
  selector: 'app-compare-languages',
  imports: [Loaded, SplitBar, Widget],
  template: `
    <app-widget
      [heading]="LANGUAGES"
      [empty]="NO_LANGUAGES_EITHER[kind]"
      emptyIcon="code"
      skeleton="stack"
      [summary]="summary()"
      [table]="table()"
    >
      <ng-template [appLoaded]="languages">
        <div class="cmp-pair">
          @for (side of sides(); track $index) {
            @if (side.segments.length > 0) {
              <app-split-bar
                [label]="side.name"
                [segments]="side.segments"
                [unit]="unit"
                [summary]="side.summary"
              />
            } @else {
              <div>
                <div class="sublabel">{{ side.name }}</div>
                <p class="muted">{{ NO_LANGUAGES[kind] }}</p>
              </div>
            }
          }
        </div>
      </ng-template>
    </app-widget>
  `,
})
export class CompareLanguages {
  private readonly data = inject(ComparisonData);

  /** What the comparison is of, which it is made for: a comparison of others makes another. */
  protected readonly kind = this.data.kind();
  protected readonly unit = this.kind === 'repository' ? 'bytes' : 'repositories';

  protected readonly languages = emptyWhen(
    this.data.languages(),
    ([a, b]) => a.total === 0 && b.total === 0,
  );

  private readonly ready = computed(() => {
    const state = this.languages.state();
    return state.status === 'ready' ? state.data : undefined;
  });

  /**
   * The color of each language of either: those of the first side, in order, then those only
   * the second has, the same in both.
   */
  private readonly colors = computed(() => {
    const colors = new Map<string, string>();
    for (const shares of this.ready() ?? []) {
      for (const { name } of shares.languages) {
        if (!colors.has(name)) {
          colors.set(name, `var(--s${(colors.size % COLORS) + 1})`);
        }
      }
    }
    return colors;
  });

  /** What is said of each side's languages, in a few words. */
  private readonly said = computed(() =>
    (this.ready() ?? []).map((shares, index) =>
      sideLanguages(this.kind, this.data.names()[index], top(shares)),
    ),
  );

  protected readonly sides = computed((): Side[] =>
    (this.ready() ?? []).map((shares, index) => {
      const segments = shares.languages.map(({ name, value }) => ({
        label: name,
        value,
        color: this.colors().get(name)!,
      }));
      if (shares.other > 0) {
        segments.push({ label: OTHER, value: shares.other, color: 'var(--s-other)' });
      }
      return {
        name: this.data.names()[index],
        segments: shares.total > 0 ? segments : [],
        summary: sentence(this.said()[index]),
      };
    }),
  );

  protected readonly summary = computed(() => {
    const [first, second] = this.said();
    return first !== undefined && second !== undefined ? bothSides(first, second) : '';
  });

  /**
   * The table of each language of either, in the order of their colors, with its share of each
   * side, or that a side counts it in "Other", then "Other" of each.
   */
  protected readonly table = computed((): ChartTable | undefined => {
    const ready = this.ready();
    if (!ready) {
      return undefined;
    }
    const share = (shares: Shares, value: number) =>
      shares.total > 0 ? percent(value / shares.total) : percent(0);
    const rows = [...this.colors().keys()].map((language) => ({
      label: language,
      values: ready.map((shares) => {
        const listed = shares.languages.find(({ name }) => name === language);
        return listed ? share(shares, listed.value) : shares.other > 0 ? IN_OTHER : percent(0);
      }),
    }));
    if (ready.some((shares) => shares.other > 0)) {
      rows.push({ label: OTHER, values: ready.map((shares) => share(shares, shares.other)) });
    }
    const [first, second] = this.data.names();
    return { headers: pairHeaders(LANGUAGE, first, second), rows };
  });

  protected readonly LANGUAGES = LANGUAGES;
  protected readonly NO_LANGUAGES = NO_LANGUAGES;
  protected readonly NO_LANGUAGES_EITHER = NO_LANGUAGES_EITHER;
}

/** The language with the largest share of `shares`, and that share, of 1, if any has any. */
function top(shares: Shares): { name: string; share: number } | undefined {
  const [first] = shares.languages;
  return first && shares.total > 0
    ? { name: first.name, share: first.value / shares.total }
    : undefined;
}
