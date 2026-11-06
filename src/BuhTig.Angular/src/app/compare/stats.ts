import { Component, Signal, computed, inject } from '@angular/core';
import { OrganizationStats, Release, Stats } from '../dashboard/resources';
import { CompactNumber } from '../format/compact-number';
import { duration, signedCompactNumber } from '../format/format';
import { RelativeTime } from '../format/relative-time';
import { Icon, IconName } from '../icon/icon';
import { truncated } from '../organization/messages';
import { Load, Loader } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { ComparisonData } from './data';
import {
  FIGURES,
  Figure,
  LATEST_RELEASE,
  NONE,
  OVERVIEW,
  SAME,
  TOP_LANGUAGE,
  asMany,
  moreThan,
  newer,
  newerThan,
  sameDay,
  sameLanguage,
  sideOf,
} from './messages';

/** What one side shows on a card: a count, a release, or words, such as a language. */
export type Value =
  | { kind: 'count'; value: number }
  | { kind: 'release'; release: Release }
  | { kind: 'text'; text: string };

/**
 * How two sides differ on a card: which is ahead, by how much in short, and in a sentence for
 * assistive technology; or that they are the same. What is `wide`, such as "5.8 months newer",
 * takes the card's width, from the side of the one ahead, rather than its column's.
 */
export type Delta =
  { ahead: 0 | 1; shown: string; said: string; wide?: boolean } | { ahead: 'same'; said: string };

/** One stat card of a comparison: what it is of, what each side has, and how they differ. */
export interface Card {
  label: string;
  icon: IconName;
  values: [Value, Value];
  delta: Delta | undefined;
}

/** How far apart two releases must be to be on different days. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The stat cards of a comparison (FR-CMP-03): of two repositories, their stars, forks, watchers,
 * open issues, open pull requests and latest release; of two accounts, their repositories, stars,
 * forks, open issues and pull requests, and top language. Each card shows both, the first on the
 * left as their heads are, and how they differ: the one with more is marked with an arrow and by
 * how much, the newer release by how much newer, and the same as the same, so that no one needs
 * a color (NFR-UX-05). Assistive technology reads which has more in a sentence. The figures count
 * up as the widget comes into view (FR-ANIM-05). Of an account with more repositories than
 * BuhTig reads, it says so (FR-ORG-08).
 */
@Component({
  selector: 'app-compare-stats',
  imports: [CompactNumber, Icon, Loaded, RelativeTime, Widget],
  template: `
    <app-widget [heading]="OVERVIEW" [empty]="NONE" skeleton="figures" [flush]="true">
      <ng-template [appLoaded]="cards" let-cards>
        <div class="cmp-stats-wrap">
          <dl class="cmp-stats">
            @for (card of cards; track card.label) {
              <div class="cmp-stat">
                <dt><app-icon [name]="card.icon" />{{ card.label }}</dt>
                <dd class="cmp-vals">
                  @for (value of card.values; track $index) {
                    <div class="cmp-val">
                      <span class="sr">{{ sideOf(names()[$index]) }}</span>
                      @if (value.kind === 'count') {
                        <span class="val">
                          <app-compact-number [value]="value.value" [countUp]="true" />
                        </span>
                      } @else if (value.kind === 'release') {
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
                      } @else {
                        <span class="val txt">{{ value.text }}</span>
                      }
                      @if (ahead(card, $index); as shown) {
                        <span class="cmp-delta" aria-hidden="true"
                          ><app-icon name="up" />{{ shown }}</span
                        >
                      }
                    </div>
                  }
                  @if (wide(card); as delta) {
                    <span
                      class="cmp-delta wide"
                      [class.second]="delta.ahead === 1"
                      aria-hidden="true"
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
      </ng-template>
      @if (notes().length > 0) {
        <div class="Box-footer" footer>
          @for (note of notes(); track $index) {
            <span><app-icon name="info" /> {{ note }}</span>
          }
        </div>
      }
    </app-widget>
  `,
})
export class CompareStats {
  private readonly data = inject(ComparisonData);

  protected readonly names = this.data.names;

  /**
   * The figures of two repositories, or of two accounts, as the comparison was made for: a
   * comparison of others makes other widgets.
   */
  private readonly stats = this.data.kind() === 'repository' ? this.data.stats() : undefined;
  private readonly accountStats =
    this.data.kind() === 'account' ? this.data.accountStats() : undefined;

  protected readonly cards: Loader<Card[]> = this.stats
    ? cardsOf(this.stats, (stats) => repositoryCards(stats, this.names()))
    : cardsOf(this.accountStats!, (stats) => accountCards(stats, this.names()));

  /** What to say of accounts with more repositories than BuhTig reads (FR-ORG-08). */
  protected readonly notes: Signal<string[]> = computed(() => {
    const state = this.accountStats?.state();
    return state?.status === 'ready'
      ? state.data.flatMap((stats, index) =>
          stats.truncated ? [truncated(this.names()[index], stats.repositories)] : [],
        )
      : [];
  });

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
  protected readonly OVERVIEW = OVERVIEW;
  protected readonly NONE = NONE;
  protected readonly SAME = SAME;
}

/** `loader`, with its data made into cards by `make` once it has loaded. */
function cardsOf<T>(loader: Loader<T>, make: (data: T) => Card[]): Loader<Card[]> {
  return {
    state: computed((): Load<Card[]> => {
      const state = loader.state();
      return state.status === 'ready' ? { status: 'ready', data: make(state.data) } : state;
    }),
    retry: () => loader.retry(),
  };
}

/** The cards of two repositories, named `names` (FR-CMP-03). */
export function repositoryCards([a, b]: [Stats, Stats], names: readonly [string, string]): Card[] {
  return [
    countCard('stars', 'star', a.stars, b.stars, names),
    countCard('forks', 'fork', a.forks, b.forks, names),
    countCard('watchers', 'eye', a.watchers, b.watchers, names),
    countCard('openIssues', 'issue', a.openIssues, b.openIssues, names),
    countCard('openPullRequests', 'pr', a.openPullRequests, b.openPullRequests, names),
    releaseCard(a.latestRelease, b.latestRelease, names),
  ];
}

/** The cards of two accounts, organizations or users, named `names` (FR-CMP-03). */
export function accountCards(
  [a, b]: [OrganizationStats, OrganizationStats],
  names: readonly [string, string],
): Card[] {
  return [
    countCard('repositories', 'repo', a.repositories, b.repositories, names),
    countCard('stars', 'star', a.stars, b.stars, names),
    countCard('forks', 'fork', a.forks, b.forks, names),
    countCard(
      'openIssuesAndPullRequests',
      'issue',
      a.openIssuesAndPullRequests,
      b.openIssuesAndPullRequests,
      names,
    ),
    languageCard(a.topLanguage, b.topLanguage, names),
  ];
}

/** A card of a count, `a` of the first side's and `b` of the second's. */
function countCard(
  figure: Figure,
  icon: IconName,
  a: number,
  b: number,
  [first, second]: readonly [string, string],
): Card {
  let delta: Delta;
  if (a === b) {
    delta = { ahead: 'same', said: asMany(figure, first, second) };
  } else if (a > b) {
    delta = {
      ahead: 0,
      shown: signedCompactNumber(a - b),
      said: moreThan(figure, first, a - b, second),
    };
  } else {
    delta = {
      ahead: 1,
      shown: signedCompactNumber(b - a),
      said: moreThan(figure, second, b - a, first),
    };
  }
  return {
    label: FIGURES[figure].label,
    icon,
    values: [
      { kind: 'count', value: a },
      { kind: 'count', value: b },
    ],
    delta,
  };
}

/**
 * The card of the latest releases, the newer marked by how much newer it is, unless either has
 * none, or GitHub does not say when it was published.
 */
function releaseCard(
  a: Release | undefined,
  b: Release | undefined,
  [first, second]: readonly [string, string],
): Card {
  const value = (release: Release | undefined): Value =>
    release ? { kind: 'release', release } : { kind: 'text', text: NONE };
  let delta: Delta | undefined;
  const at = [a?.publishedAt?.getTime(), b?.publishedAt?.getTime()];
  if (at[0] !== undefined && at[1] !== undefined) {
    const apart = Math.abs(at[0] - at[1]);
    if (apart < DAY_MS) {
      delta = { ahead: 'same', said: sameDay(first, second) };
    } else {
      const ahead = at[0] > at[1] ? 0 : 1;
      const span = duration(apart / 1000);
      delta = {
        ahead,
        wide: true,
        shown: newer(span),
        said: ahead === 0 ? newerThan(first, span, second) : newerThan(second, span, first),
      };
    }
  }
  return { label: LATEST_RELEASE, icon: 'tag', values: [value(a), value(b)], delta };
}

/** The card of the top languages, marked the same when they are. */
function languageCard(
  a: string | undefined,
  b: string | undefined,
  [first, second]: readonly [string, string],
): Card {
  return {
    label: TOP_LANGUAGE,
    icon: 'code',
    values: [
      { kind: 'text', text: a ?? NONE },
      { kind: 'text', text: b ?? NONE },
    ],
    delta:
      a !== undefined && a === b
        ? { ahead: 'same', said: sameLanguage(first, second, a) }
        : undefined,
  };
}
