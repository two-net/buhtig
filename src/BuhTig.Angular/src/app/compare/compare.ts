import {
  Component,
  Injector,
  Signal,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { NEVER, Observable, map, startWith, switchMap } from 'rxjs';
import { once } from '../dashboard/data';
import { FailurePage } from '../dashboard/failure';
import { renamed } from '../dashboard/messages';
import { NotFoundOrPrivate } from '../dashboard/not-found-or-private';
import { Resources, Summary } from '../dashboard/resources';
import { same } from '../dashboard/summary';
import { Header } from '../header/header';
import { Announcer } from '../live/announcer';
import { Known, Owner, Resource, dashboardPath, parse } from '../search/parse';
import { CompareStyles, DashboardStyles } from '../styles/styles';
import { TipHost } from '../tip/tip';
import { Toasts } from '../toast/toasts';
import { Loader, both, load } from '../widget/load';
import { LOADING } from '../widget/messages';
import { CompareCreated, CompareLastPush } from './account-activity';
import { CompareActivity } from './activity';
import { ComparisonData, bytesShares, repositoryShares } from './data';
import { CompareHead } from './head';
import { CompareLanguages } from './languages';
import { COMPARE, VS, comparisonLoaded } from './messages';
import { Compared, comparePath } from './route';
import { CompareStats } from './stats';

/** What keeps a comparison from showing its two resources, and which of them it is. */
type Problem =
  | { kind: 'invalid' | 'not-found'; name: string }
  | { kind: 'failure'; failure: NonNullable<Summary['failure']> };

/**
 * Two repositories, or two accounts, side by side (FR-CMP-01): each one's head, with when its
 * data was fetched (FR-DATA-06), then their stat cards, each with how they differ (FR-CMP-03),
 * and their charts against one scale, each with a sentence and a table (FR-CMP-04). Of two
 * repositories, their commit activity and languages; of two accounts, which may each be an
 * organization or a user, their languages, and their repositories by last push and by year
 * created.
 *
 * Each side comes from the same endpoints and cache as its dashboard, so as the viewer's own
 * credentials allow, and counts as a load of its dashboard (FR-CMP-05). When GitHub says there is
 * no such resource, it shows nothing of either, and says what the viewer can do of the one there
 * is not (FR-ACC-05). A comparison is no dashboard: it goes in no history, and is pinned to
 * nothing. Once it knows how GitHub spells both names, it moves to the URL that spells them so.
 */
@Component({
  selector: 'app-comparison',
  imports: [
    CompareActivity,
    CompareCreated,
    CompareHead,
    CompareLanguages,
    CompareLastPush,
    CompareStats,
    CompareStyles,
    DashboardStyles,
    FailurePage,
    Header,
    NotFoundOrPrivate,
    TipHost,
  ],
  templateUrl: './compare.html',
  providers: [{ provide: ComparisonData, useExisting: forwardRef(() => Comparison) }],
})
export class Comparison implements ComparisonData {
  private readonly resources = inject(Resources);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly toasts = inject(Toasts);
  private readonly announcer = inject(Announcer);

  /** What the comparison is of, and the names of the two, as the URL has them. */
  readonly kind = input.required<Compared>();
  readonly first = input.required<string>();
  readonly second = input.required<string>();

  /** The two resources, as the URL names them, the same whatever the letter case of the names. */
  private readonly firstResource = computed(() => this.side(this.first()), { equal: same });
  private readonly secondResource = computed(() => this.side(this.second()), { equal: same });

  /** How many times the user has tried again, after BuhTig failed to show either. */
  private readonly attempts = signal(0);

  /** What BuhTig knows of each, once it says, for each resource anew. */
  protected readonly firstSummary = this.follow(this.firstResource);
  protected readonly secondSummary = this.follow(this.secondResource);

  /** Each resource, of the kind GitHub tells and with its names as GitHub spells them. */
  private readonly firstKnown = known(this.firstSummary);
  private readonly secondKnown = known(this.secondSummary);

  readonly names = computed(
    (): readonly [string, string] => [
      this.firstSummary()?.path?.slice(1) ?? this.first(),
      this.secondSummary()?.path?.slice(1) ?? this.second(),
    ],
    { equal: (a, b) => a[0] === b[0] && a[1] === b[1] },
  );

  /** What keeps the comparison from showing its two resources, if anything does. */
  protected readonly problem = computed((): Problem | undefined => {
    const summaries = [this.firstSummary(), this.secondSummary()];
    const names = [this.first(), this.second()];
    for (const kind of ['invalid', 'not-found'] as const) {
      const at = summaries.findIndex((summary) =>
        kind === 'invalid' ? summary?.invalid : summary?.notFound,
      );
      if (at >= 0) {
        return { kind, name: names[at] };
      }
    }
    const failure = summaries.find((summary) => summary?.failure)?.failure;
    return failure ? { kind: 'failure', failure } : undefined;
  });

  /** Whether the comparison shows its widgets: once it knows both, and GitHub keeps neither. */
  protected readonly shown = computed(
    () =>
      this.firstKnown() !== undefined &&
      this.secondKnown() !== undefined &&
      !this.firstSummary()?.denied &&
      !this.secondSummary()?.denied,
  );

  protected readonly busy = computed(
    () => this.firstSummary() === undefined || this.secondSummary() === undefined,
  );

  protected readonly crumbs = computed(() => [
    { label: COMPARE, link: comparePath(this.firstResource(), this.secondResource()) },
  ]);

  readonly stats = this.repositories((owner, repo) => this.resources.stats(owner, repo));
  readonly activity = this.repositories((owner, repo) =>
    this.resources.commitActivity(owner, repo),
  );
  readonly accountStats = this.accounts((owner) => this.resources.accountStats(owner));
  readonly lastPush = this.accounts((owner) => this.resources.lastPush(owner));
  readonly createdPerYear = this.accounts((owner) => this.resources.createdPerYear(owner));
  readonly languages = this.pair((known) =>
    known.kind === 'repository'
      ? this.resources.languages(known.owner, known.repo).pipe(map(bytesShares))
      : this.resources.accountLanguages(known).pipe(map(repositoryShares)),
  );

  constructor() {
    // Once BuhTig knows both, the comparison moves to the URL that spells their names as GitHub
    // does, in place of the URL it was opened at (FR-CMP-01), and says which were renamed or
    // transferred, as a dashboard does (FR-NAV-05). Assistive technology is told it has loaded.
    let announced = '';
    effect(() => {
      const first = this.firstKnown();
      const second = this.secondKnown();
      if (first === undefined || second === undefined) {
        return;
      }
      untracked(() => {
        for (const [opened, known] of [
          [this.firstResource(), first],
          [this.secondResource(), second],
        ] as const) {
          if (!same(opened, known)) {
            this.toasts.show(renamed(name(opened), name(known)), 'info');
          }
        }
        const canonical = comparePath(first, second);
        if (canonical !== announced) {
          announced = canonical;
          this.announcer.announce(comparisonLoaded(name(first), name(second)));
        }
        if (canonical !== this.router.url.split(/[?#]/)[0]) {
          void this.router.navigateByUrl(canonical, { replaceUrl: true });
        }
      });
    });
  }

  protected retry(): void {
    this.attempts.update((count) => count + 1);
  }

  protected readonly LOADING = LOADING;
  protected readonly VS = VS;

  /** The resource the URL names `name`, such as `owner/repo`, as the route took it. */
  private side(name: string): Resource {
    const parsed = parse(name);
    return parsed.ok ? parsed.resource : { kind: 'account', name };
  }

  /** What BuhTig knows of `resource`, asked for again on each attempt, unknown meanwhile. */
  private follow(resource: Signal<Resource>): Signal<Summary | undefined> {
    const asked = computed(() => ({ resource: resource(), attempts: this.attempts() }));
    return toSignal(
      toObservable(asked).pipe(
        switchMap(({ resource }) =>
          this.resources.summary(resource).pipe(startWith<Summary | undefined>(undefined)),
        ),
      ),
      { initialValue: undefined },
    );
  }

  /**
   * A part of both resources, loaded once its first widget asks for it, with each resource as
   * GitHub tells it, and again as the comparison moves to others.
   */
  private pair<T>(request: (known: Known) => Observable<T>): () => Loader<[T, T]> {
    return once(this.injector, () => {
      const of = (known: Signal<Known | undefined>) =>
        load(() => {
          const resource = known();
          return resource === undefined ? NEVER : request(resource);
        });
      return both(of(this.firstKnown), of(this.secondKnown));
    });
  }

  /** A part of two repositories, which two accounts have none of. */
  private repositories<T>(
    request: (owner: string, repo: string) => Observable<T>,
  ): () => Loader<[T, T]> {
    return this.pair((known) =>
      known.kind === 'repository' ? request(known.owner, known.repo) : NEVER,
    );
  }

  /** A part of two accounts, which two repositories have none of. */
  private accounts<T>(request: (owner: Owner) => Observable<T>): () => Loader<[T, T]> {
    return this.pair((known) => (known.kind === 'repository' ? NEVER : request(known)));
  }
}

/** The resource `summary` tells of, the same whatever the letter case of its names. */
function known(summary: Signal<Summary | undefined>): Signal<Known | undefined> {
  return computed(() => summary()?.resource, {
    equal: (a, b) => a === b || (a !== undefined && b !== undefined && same(a, b)),
  });
}

/** The name of `resource`, such as `owner/repo`. */
function name(resource: Resource): string {
  return dashboardPath(resource).slice(1);
}
