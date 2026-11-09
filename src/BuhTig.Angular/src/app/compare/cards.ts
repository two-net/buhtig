import { Component, computed, inject, input } from '@angular/core';
import { UPDATED, heldData, staleData } from '../dashboard/messages';
import { Freshness, Release } from '../dashboard/resources';
import { Clock } from '../format/clock';
import { CompactNumber } from '../format/compact-number';
import {
  duration,
  percent,
  percentagePoints,
  relativeTime,
  signedCompactNumber,
} from '../format/format';
import { RelativeTime } from '../format/relative-time';
import { Icon, IconName } from '../icon/icon';
import { Load, Loader } from '../widget/load';
import {
  FIGURES,
  Figure,
  Measure,
  NO_FIGURE,
  SAME,
  asMany,
  higherThan,
  longer,
  longerThan,
  moreThan,
  pointsHigher,
  sameMeasure,
  sideOf,
} from './messages';

/**
 * What one side shows on a card: a count, a figure in words, such as a span of time, with what
 * it is of, nothing, with why, a release, or words, such as a language.
 */
export type Value =
  | { kind: 'count'; value: number; sub?: string }
  | { kind: 'figure'; text: string; sub: string }
  | { kind: 'missing'; reason: string }
  | { kind: 'release'; release: Release }
  | { kind: 'text'; text: string };

/**
 * How two sides differ on a card: which is ahead, by how much in short, and in a sentence for
 * assistive technology; or that they are the same. What is `wide`, such as "5.8 months newer",
 * takes the card's width, from the side of the one ahead, rather than its column's.
 */
export type Delta =
  { ahead: 0 | 1; shown: string; said: string; wide?: boolean } | { ahead: 'same'; said: string };

/** One card of a comparison: what it is of, what each side has, and how they differ. */
export interface Card {
  label: string;
  icon: IconName;
  values: [Value, Value];
  delta: Delta | undefined;
}

/** `loader`, with its data made into cards by `make` once it has loaded. */
export function cardsOf<T>(loader: Loader<T>, make: (data: T) => Card[]): Loader<Card[]> {
  return {
    state: computed((): Load<Card[]> => {
      const state = loader.state();
      return state.status === 'ready' ? { status: 'ready', data: make(state.data) } : state;
    }),
    retry: () => loader.retry(),
  };
}

/** A card of a count, `a` of the first side's and `b` of the second's. */
export function countCard(
  figure: Figure,
  icon: IconName,
  a: number,
  b: number,
  names: readonly [string, string],
): Card {
  return {
    label: FIGURES[figure].label,
    icon,
    values: [
      { kind: 'count', value: a },
      { kind: 'count', value: b },
    ],
    delta: countDelta(figure, a, b, names),
  };
}

/** How two counts differ: the one with more marked by how many more, or the same. */
export function countDelta(
  figure: Figure,
  a: number,
  b: number,
  [first, second]: readonly [string, string],
): Delta {
  if (a === b) {
    return { ahead: 'same', said: asMany(figure, first, second) };
  }
  return a > b
    ? { ahead: 0, shown: signedCompactNumber(a - b), said: moreThan(figure, first, a - b, second) }
    : { ahead: 1, shown: signedCompactNumber(b - a), said: moreThan(figure, second, b - a, first) };
}

/**
 * How two spans of time of `measure`, in seconds, differ (FR-CMP-06): the longer marked by how
 * much longer, with its unit, or the same when they show the same, so that no difference shows
 * as none. Longer is said as longer, neither better nor worse. None unless both have one.
 */
export function spanDelta(
  measure: Measure,
  a: number | undefined,
  b: number | undefined,
  [first, second]: readonly [string, string],
): Delta | undefined {
  if (a === undefined || b === undefined) {
    return undefined;
  }
  if (duration(a) === duration(b)) {
    return { ahead: 'same', said: sameMeasure(measure, first, second) };
  }
  const span = duration(Math.abs(a - b));
  return a > b
    ? { ahead: 0, wide: true, shown: longer(span), said: longerThan(measure, first, span, second) }
    : { ahead: 1, wide: true, shown: longer(span), said: longerThan(measure, second, span, first) };
}

/**
 * How two shares of `measure` differ (FR-CMP-06): the higher marked by how many percentage points
 * higher, of the shares as shown, or the same when they show the same. Higher is said as higher,
 * neither better nor worse. None unless both have one.
 */
export function shareDelta(
  measure: Measure,
  a: number | undefined,
  b: number | undefined,
  [first, second]: readonly [string, string],
): Delta | undefined {
  if (a === undefined || b === undefined) {
    return undefined;
  }
  if (percent(a) === percent(b) || Math.round(a * 1000) === Math.round(b * 1000)) {
    return { ahead: 'same', said: sameMeasure(measure, first, second) };
  }
  const points = percentagePoints(a, b);
  return a > b
    ? {
        ahead: 0,
        wide: true,
        shown: pointsHigher(points),
        said: higherThan(measure, first, points, second),
      }
    : {
        ahead: 1,
        wide: true,
        shown: pointsHigher(points),
        said: higherThan(measure, second, points, first),
      };
}

/**
 * Cards of two sides, named `names`, each with both sides' values, the first on the left as
 * their heads are, and how they differ: the one ahead is marked with an arrow and by how much,
 * and the same as the same, so that no one needs a color (NFR-UX-05). Assistive technology reads
 * how they differ in a sentence. Counts count up as they come into view (FR-ANIM-05). A side
 * without a figure shows a dash, and why, rather than a zero (FR-CMP-06).
 */
@Component({
  selector: 'app-compare-cards',
  imports: [CompactNumber, Icon, RelativeTime],
  template: `
    <div class="cmp-stats-wrap">
      <dl class="cmp-stats" [class.measures]="measures()">
        @for (card of cards(); track card.label) {
          <div class="cmp-stat">
            <dt><app-icon [name]="card.icon" />{{ card.label }}</dt>
            <dd class="cmp-vals">
              @for (value of card.values; track $index) {
                <div class="cmp-val">
                  <span class="sr">{{ sideOf(names()[$index]) }}</span>
                  @switch (value.kind) {
                    @case ('count') {
                      <span class="val">
                        <app-compact-number [value]="value.value" [countUp]="true" />
                      </span>
                      @if (value.sub) {
                        <span class="sub">{{ value.sub }}</span>
                      }
                    }
                    @case ('figure') {
                      <span class="val">{{ value.text }}</span>
                      <span class="sub">{{ value.sub }}</span>
                    }
                    @case ('missing') {
                      <span class="val" aria-hidden="true">{{ NO_FIGURE }}</span>
                      <span class="sub">{{ value.reason }}</span>
                    }
                    @case ('release') {
                      <span class="val txt" [title]="value.release.tag">
                        @if (value.release.url; as url) {
                          <a [href]="url">{{ value.release.tag }}</a>
                        } @else {
                          {{ value.release.tag }}
                        }
                      </span>
                      @if (value.release.publishedAt; as publishedAt) {
                        <span class="sub"><app-relative-time [value]="publishedAt" /></span>
                      }
                    }
                    @case ('text') {
                      <span class="val txt">{{ value.text }}</span>
                    }
                  }
                  @if (ahead(card, $index); as shown) {
                    <span class="cmp-delta" aria-hidden="true"
                      ><app-icon name="up" />{{ shown }}</span
                    >
                  }
                </div>
              }
              @if (wide(card); as delta) {
                <span class="cmp-delta wide" [class.second]="delta.ahead === 1" aria-hidden="true"
                  ><app-icon name="up" />{{ delta.shown }}</span
                >
              }
            </dd>
            @if (card.delta; as delta) {
              @if (delta.ahead === 'same') {
                <dd class="cmp-delta same" aria-hidden="true">
                  <app-icon name="equal" />{{ SAME }}
                </dd>
              }
              <dd class="sr">{{ delta.said }}</dd>
            }
          </div>
        }
      </dl>
    </div>
  `,
})
export class CompareCards {
  readonly cards = input.required<Card[]>();
  /** The two sides' names, as their heads show them. */
  readonly names = input.required<readonly [string, string]>();
  /**
   * Whether the cards are of maintenance figures, wider, with what each figure is of on as many
   * lines as it takes (FR-CMP-06).
   */
  readonly measures = input(false);

  /** By how much the side at `index` is ahead on `card`, in short, if it is, under its figure. */
  protected ahead(card: Card, index: number): string | undefined {
    const delta = card.delta;
    return delta && delta.ahead === index && !delta.wide ? delta.shown : undefined;
  }

  /** How either side is ahead on `card`, if it is by more than its column fits. */
  protected wide(card: Card): Extract<Delta, { shown: string }> | undefined {
    const delta = card.delta;
    return delta && delta.ahead !== 'same' && delta.wide ? delta : undefined;
  }

  protected readonly sideOf = sideOf;
  protected readonly NO_FIGURE = NO_FIGURE;
  protected readonly SAME = SAME;
}

/**
 * When one side's data of a section was fetched (FR-DATA-06), or that it is saved data, and why,
 * with an icon as well as words (FR-DATA-05, NFR-UX-05), as of each section of a comparison,
 * whose data may be fetched at other times than its head's (FR-CMP-06).
 */
@Component({
  selector: 'app-compare-fresh',
  imports: [Icon, RelativeTime],
  template: `
    @if (age(); as age) {
      <span class="cmp-fresh stale">
        <app-icon [name]="freshness().stale === 'held' ? 'gauge' : 'cloudoff'" />{{ age }}
      </span>
    } @else if (freshness().fetchedAt; as fetchedAt) {
      <span class="cmp-fresh">{{ UPDATED }} <app-relative-time [value]="fetchedAt" /></span>
    }
  `,
})
export class CompareFresh {
  private readonly clock = inject(Clock);

  readonly freshness = input.required<Freshness>();

  /** What to say of saved data, if it is saved data. */
  protected readonly age = computed(() => {
    const { fetchedAt, stale } = this.freshness();
    if (!stale || !fetchedAt) {
      return undefined;
    }
    const age = relativeTime(fetchedAt, this.clock.now());
    return stale === 'held' ? heldData(age) : staleData(age);
  });

  protected readonly UPDATED = UPDATED;
}
