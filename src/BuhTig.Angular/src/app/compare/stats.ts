import { Component, Signal, computed, inject } from '@angular/core';
import { OrganizationStats, Release, Stats } from '../dashboard/resources';
import { duration } from '../format/format';
import { Icon } from '../icon/icon';
import { truncated } from '../organization/messages';
import { Loader } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { Card, CompareCards, Delta, Value, cardsOf, countCard } from './cards';
import { ComparisonData } from './data';
import {
  LATEST_RELEASE,
  NONE,
  OVERVIEW,
  TOP_LANGUAGE,
  newer,
  newerThan,
  sameDay,
  sameLanguage,
} from './messages';

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
  imports: [CompareCards, Icon, Loaded, Widget],
  template: `
    <app-widget [heading]="OVERVIEW" [empty]="NONE" skeleton="figures" [flush]="true">
      <ng-template [appLoaded]="cards" let-cards>
        <app-compare-cards [cards]="cards" [names]="names()" />
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

  protected readonly OVERVIEW = OVERVIEW;
  protected readonly NONE = NONE;
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
