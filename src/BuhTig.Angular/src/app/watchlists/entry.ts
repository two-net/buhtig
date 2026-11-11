import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NEVER, tap } from 'rxjs';
import { Sparkline } from '../chart/sparkline';
import {
  AUTHORIZE_SSO,
  AUTHORIZE_TOKEN,
  ADD_TOKEN,
  NOT_FOUND_OR_PRIVATE,
  REPLACE_TOKEN,
  SSO_REQUIRED,
  TOKEN_REFUSED,
  TOKEN_SETTINGS,
  heldData,
  invalidName,
  notFoundForSignedIn,
  notFoundWithInvalidToken,
  notFoundWithToken,
  staleData,
} from '../dashboard/messages';
import { Glance, Resources } from '../dashboard/resources';
import { Clock } from '../format/clock';
import { relativeTime } from '../format/format';
import { RelativeTime } from '../format/relative-time';
import { GITHUB_HOST } from '../github/host';
import { Icon } from '../icon/icon';
import { sparklineLabel } from '../organization/messages';
import { VISIBILITY } from '../repository/head';
import {
  PRIVATE_TRENDS,
  RUNS_HIDDEN,
  noBaseline,
  noRuns,
  trendsDescription,
} from '../repository/messages';
import { runBadge } from '../repository/workflows';
import { Session } from '../session/session';
import { load } from '../widget/load';
import {
  FAILING_SINCE,
  LATEST_RELEASE,
  LATEST_RUN,
  NEW_SINCE,
  NO_FIGURES_YET,
  NO_RELEASES,
  OVER_A_WEEK,
  PASSED_THEN,
  PUSHED,
  RELEASE_FAILED,
  RUNS_FAILED,
  TREND_FAILED,
  TRY_AGAIN,
  UPDATED,
  loadingRow,
  releaseThen,
  rowFailure,
} from './messages';
import { Slots } from './slots';
import { Shown, Watchlists } from './watchlists';

/** FR-PERS-08: the weeks of commits that a repository's sparkline shows, as in an account's list. */
const WEEKS = 26;

/**
 * One of a watchlist's repositories, as a row of it (FR-PERS-08): its name, linking to its
 * dashboard, with badges for its visibility and for Archived and Fork, its description, its latest
 * release, when it was last pushed to, how its latest workflow run on the default branch went, in
 * words and with an icon (NFR-UX-05), its commits over the last 26 weeks as a sparkline, and when
 * its data was fetched, saying so when it is saved data (FR-DATA-05, FR-DATA-06). Below, how its
 * stars, forks, open issues and open pull requests changed over a week, as BuhTig observed them
 * (FR-PERS-10). Beside its latest release, workflow run and push, what is new in each since the
 * user last looked at the row (FR-PERS-11): once it has loaded, the row tells the server what it
 * showed, for the next time. There is no score of how it fares, only what each of these says.
 *
 * It shows its name at once, and asks for the rest only once its row comes into view, through the
 * page's slots, a few rows at a time (FR-PERS-09). Each row loads, fails and tries again alone, so
 * that one that fails holds up no other. Of a repository that GitHub does not show the viewer, it
 * shows the name it was added by alone, and what the viewer can do (FR-ACC-05, FR-PAT-08).
 */
@Component({
  selector: 'app-watchlist-entry',
  imports: [Icon, RelativeTime, RouterLink, Sparkline],
  template: `
    @let shown = found();
    <div class="t">
      <h3>
        <a [routerLink]="shown?.path ?? '/' + name()">{{ shown?.repository.name ?? name() }}</a>
        @if (shown; as shown) {
          <span class="label">{{ VISIBILITY[shown.repository.visibility] }}</span>
          @if (shown.repository.archived) {
            <span class="label attention"><app-icon name="archive" />Archived</span>
          }
          @if (shown.repository.fork) {
            <span class="label">Fork</span>
          }
        }
      </h3>
      @if (shown; as shown) {
        @if (shown.repository.description; as description) {
          <p>{{ description }}</p>
        }
        <div class="rmeta">
          <span class="release">
            <app-icon name="tag" />
            @if (shown.latestRelease.ok) {
              @if (shown.latestRelease.release; as release) {
                {{ LATEST_RELEASE }}
                @if (release.url; as url) {
                  <a [href]="url">{{ release.tag }}</a>
                } @else {
                  {{ release.tag }}
                }
                @if (release.publishedAt; as publishedAt) {
                  · <app-relative-time [value]="publishedAt" />
                }
                @if (marks().release; as seen) {
                  <span class="wl-new"
                    ><app-icon name="sparkle" />{{ NEW_SINCE }}
                    <app-relative-time [value]="seen.seenAt" />{{ releaseThen(seen.tag) }}</span
                  >
                }
              } @else {
                {{ NO_RELEASES }}
              }
            } @else {
              {{ RELEASE_FAILED }}
            }
          </span>
          @if (shown.repository.pushedAt; as pushedAt) {
            <span class="pushed"
              ><app-icon name="pulse" />{{ PUSHED }} <app-relative-time [value]="pushedAt" />
              @if (marks().push; as seen) {
                <span class="wl-new"
                  ><app-icon name="sparkle" />{{ NEW_SINCE }}
                  <app-relative-time [value]="seen.seenAt"
                /></span>
              }
            </span>
          }
          <span class="runs">
            @if (shown.workflowRuns.ok) {
              @if (shown.workflowRuns.hidden) {
                <app-icon name="lock" />{{ RUNS_HIDDEN }}
              } @else if (shown.workflowRuns.latest; as run) {
                @let badge = badgeOf(run);
                <span class="label run" [class]="badge.tone"
                  ><app-icon [name]="badge.icon" />{{ badge.label }}</span
                >
                @if (run.url; as url) {
                  <a [href]="url">{{ run.name ?? LATEST_RUN }}</a>
                } @else {
                  {{ run.name ?? LATEST_RUN }}
                }
                @if (marks().run; as seen) {
                  <span class="wl-new failing"
                    ><app-icon name="alert" />{{ FAILING_SINCE }}
                    <app-relative-time [value]="seen.seenAt" />{{ PASSED_THEN }}</span
                  >
                }
              } @else {
                <app-icon name="pulse" />{{ noRuns(shown.workflowRuns.branch) }}
              }
            } @else {
              <app-icon name="alert" />{{ RUNS_FAILED }}
            }
          </span>
          @if (fetchedAt(); as fetchedAt) {
            <span class="updated">{{ UPDATED }} <app-relative-time [value]="fetchedAt" /></span>
          }
        </div>
        @if (trend(); as trend) {
          <p class="wl-trend" [class.err]="trend.failed">
            <app-icon [name]="trend.failed ? 'alert' : 'history'" />
            <span>
              @if (!trend.failed) {
                <strong>{{ OVER_A_WEEK }}</strong>
              }
              {{ trend.text }}
            </span>
          </p>
        }
        @if (staleNote(); as note) {
          <p class="wl-note warn">
            <app-icon [name]="note.held ? 'gauge' : 'cloudoff'" />{{ note.text }}
          </p>
        }
      } @else {
        @switch (shape()) {
          @case ('not-found') {
            <p class="wl-note">
              <app-icon name="lock" />
              <span
                ><strong>{{ NOT_FOUND_OR_PRIVATE }}.</strong> {{ notFound().text }}
                <a routerLink="/-/settings">{{ notFound().action }}</a></span
              >
            </p>
          }
          @case ('invalid') {
            <p class="wl-note"><app-icon name="question" />{{ invalidName(name()) }}</p>
          }
          @case ('denied') {
            <p class="wl-note warn">
              <app-icon name="lock" />
              @if (denied(); as denied) {
                @if (denied.reason === 'sso') {
                  <span
                    >{{ SSO_REQUIRED }}
                    @if (denied.url; as url) {
                      <a [href]="url">{{ AUTHORIZE_SSO }}</a>
                    } @else {
                      <a [href]="'https://' + gitHub + '/settings/tokens'">{{ AUTHORIZE_TOKEN }}</a>
                    }
                  </span>
                } @else {
                  <span
                    >{{ TOKEN_REFUSED }} <a routerLink="/-/settings">{{ REPLACE_TOKEN }}</a></span
                  >
                }
              }
            </p>
          }
          @case ('error') {
            <div class="wl-failed">
              <p class="wl-note err"><app-icon name="alert" />{{ failure() }}</p>
              <button type="button" class="btn sm retry" (click)="glance.retry()">
                {{ TRY_AGAIN }}
              </button>
            </div>
          }
          @default {
            <div class="wl-skel" aria-hidden="true">
              <span class="skel line"></span>
              <span class="skel line thin"></span>
            </div>
            <span class="sr">{{ loadingRow(name()) }}</span>
          }
        }
      }
    </div>
    @if (shown) {
      @switch (activity.state().status) {
        @case ('ready') {
          <span class="spark-wrap" role="img" [attr.aria-label]="sparkLabel()">
            <app-sparkline [values]="weeks()" />
          </span>
        }
        @case ('error') {}
        @case ('empty') {}
        @default {
          <span class="spark waiting" aria-hidden="true"></span>
        }
      }
    }
  `,
  host: { class: 'wl-entry', '[attr.aria-busy]': "shape() === 'loading' ? 'true' : null" },
})
export class WatchlistEntry {
  /** `github.host`, where GitHub's own pages are. */
  protected readonly gitHub = inject(GITHUB_HOST);
  private readonly resources = inject(Resources);
  private readonly watchlists = inject(Watchlists);
  private readonly slots = inject(Slots);
  private readonly session = inject(Session);
  private readonly clock = inject(Clock);

  /** The repository's `owner/repo`, as it was added to the watchlist. */
  readonly name = input.required<string>();

  /** The ID of the watchlist that the row is in, for it to tell what is new (FR-PERS-11). */
  readonly watchlist = input<number>();

  /** Whether the row has come into view, after which it stays loaded. */
  private readonly seen = signal(false);

  /**
   * What the server shows of the repository, once the row has come into view. Once it has loaded,
   * the row says what it showed (FR-PERS-11).
   */
  protected readonly glance = load(() => {
    const name = this.name();
    const watchlist = this.watchlist();
    const [owner, repo] = name.split('/');
    if (!this.seen()) {
      return NEVER;
    }
    return this.slots.run(this.resources.glance(owner, repo ?? '', watchlist)).pipe(
      tap((glanced) => {
        if (glanced.status === 'found' && watchlist !== undefined) {
          this.remember(watchlist, name, glanced.glance);
        }
      }),
    );
  });

  /** What the row shows of the repository, once GitHub has shown it to the viewer. */
  protected readonly found = computed((): Glance | undefined => {
    const state = this.glance.state();
    return state.status === 'ready' && state.data.status === 'found'
      ? state.data.glance
      : undefined;
  });

  /** What the row shows in place of the repository, until or unless it shows it. */
  protected readonly shape = computed(() => {
    const state = this.glance.state();
    switch (state.status) {
      case 'ready':
        return state.data.status;
      case 'error':
        return 'error';
      default:
        return 'loading';
    }
  });

  protected readonly denied = computed(() => {
    const state = this.glance.state();
    return state.status === 'ready' && state.data.status === 'denied'
      ? state.data.denied
      : undefined;
  });

  protected readonly failure = computed(() => {
    const state = this.glance.state();
    return state.status === 'error' ? rowFailure(state.failure) : '';
  });

  /** The repository's name as GitHub spells it, once it has, for its commits to be asked for. */
  private readonly gitHubName = computed(() => this.found()?.repository.name);

  /** Its commits per week, asked for only once GitHub has shown it to the viewer (FR-PERS-09). */
  protected readonly activity = load(
    () => {
      const name = this.gitHubName();
      if (name === undefined) {
        return NEVER;
      }
      const [owner, repo] = name.split('/');
      return this.slots.run(this.resources.commitActivity(owner, repo));
    },
    (activity) => activity.weeks.length === 0,
  );

  protected readonly weeks = computed(() => {
    const state = this.activity.state();
    return state.status === 'ready'
      ? state.data.weeks.slice(-WEEKS).map((week) => week.commits)
      : [];
  });

  protected readonly sparkLabel = computed(() =>
    sparklineLabel(this.weeks().reduce((total, commits) => total + commits, 0)),
  );

  /**
   * When the oldest of the data the row shows was fetched (FR-DATA-06): the repository's, its
   * latest release's or its workflow runs', which may each have been fetched at another time.
   */
  protected readonly fetchedAt = computed(() => {
    const shown = this.found();
    if (!shown) {
      return undefined;
    }
    const times = [
      shown.fetchedAt,
      shown.latestRelease.ok ? shown.latestRelease.fetchedAt : undefined,
      shown.workflowRuns.ok ? shown.workflowRuns.fetchedAt : undefined,
    ].flatMap((time) => (time ? [time.getTime()] : []));
    return times.length > 0 ? new Date(Math.min(...times)) : undefined;
  });

  /**
   * How the repository's figures changed over a week, in words (FR-PERS-10): between which
   * observations, with the figures at each, on how many of the days there is one, or why there is
   * no change. Nothing while GitHub has not just given or confirmed the repository.
   */
  protected readonly trend = computed(() => {
    const trend = this.found()?.trend;
    if (trend === undefined) {
      return undefined;
    }
    if (!trend.ok) {
      return { failed: true, text: TREND_FAILED };
    }
    const { period, latest, trackingSince, scope } = trend;
    const text =
      latest === undefined
        ? NO_FIGURES_YET
        : !period.supported && period.reason === 'first_observation'
          ? noBaseline(latest)
          : trendsDescription(period, latest, trackingSince);
    return { failed: false, text: scope === 'private' ? `${text} ${PRIVATE_TRENDS}` : text };
  });

  /**
   * What is new since the user last looked at the row, beside the part it is of (FR-PERS-11): a
   * release of another tag, a workflow run that failed after one that passed, and a newer push.
   */
  protected readonly marks = computed(() => {
    const since = this.found()?.since;
    const fresh = <T extends { new: boolean }>(seen: T | undefined) =>
      seen?.new ? seen : undefined;
    return {
      release: fresh(since?.release),
      run: fresh(since?.run),
      push: fresh(since?.push),
    };
  });

  /** That some of what the row shows is saved data, and why, with how old (FR-DATA-05). */
  protected readonly staleNote = computed(() => {
    const shown = this.found();
    const fetchedAt = this.fetchedAt();
    if (!shown || !fetchedAt) {
      return undefined;
    }
    const stales = [
      shown.stale,
      shown.latestRelease.ok ? shown.latestRelease.stale : undefined,
      shown.workflowRuns.ok ? shown.workflowRuns.stale : undefined,
    ];
    if (!stales.some((stale) => stale !== undefined)) {
      return undefined;
    }
    const held = stales.includes('held');
    const age = relativeTime(fetchedAt, this.clock.now());
    return { held, text: held ? heldData(age) : staleData(age) };
  });

  /**
   * What the row says of a repository that GitHub does not show the viewer, and what they can do,
   * as its dashboard would (FR-ACC-05).
   */
  protected readonly notFound = computed(() => {
    const name = this.name();
    const token = this.session.token();
    if (!token) {
      return { text: notFoundForSignedIn('repository', name), action: ADD_TOKEN };
    }
    return token.status === 'invalid'
      ? { text: notFoundWithInvalidToken('repository', name), action: REPLACE_TOKEN }
      : { text: notFoundWithToken(name), action: TOKEN_SETTINGS };
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Where the browser cannot tell what is in view, as the tests' jsdom cannot, it loads at once.
      if (typeof IntersectionObserver !== 'function') {
        this.seen.set(true);
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.seen.set(true);
          observer.disconnect();
        }
      });
      observer.observe(host);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /**
   * Says that the row of `name` in the watchlist `id` showed `glance`, for the next time it loads
   * to mark what is new since (FR-PERS-11). If that fails, the next time marks what this one did.
   */
  private remember(id: number, name: string, glance: Glance): void {
    this.watchlists.seen(id, name, shownBy(glance)).subscribe({ error: () => undefined });
  }

  protected readonly badgeOf = runBadge;
  protected readonly releaseThen = releaseThen;
  protected readonly noRuns = noRuns;
  protected readonly invalidName = invalidName;
  protected readonly loadingRow = loadingRow;
  protected readonly VISIBILITY = VISIBILITY;
  protected readonly LATEST_RELEASE = LATEST_RELEASE;
  protected readonly NO_RELEASES = NO_RELEASES;
  protected readonly RELEASE_FAILED = RELEASE_FAILED;
  protected readonly PUSHED = PUSHED;
  protected readonly LATEST_RUN = LATEST_RUN;
  protected readonly RUNS_HIDDEN = RUNS_HIDDEN;
  protected readonly RUNS_FAILED = RUNS_FAILED;
  protected readonly UPDATED = UPDATED;
  protected readonly OVER_A_WEEK = OVER_A_WEEK;
  protected readonly NEW_SINCE = NEW_SINCE;
  protected readonly FAILING_SINCE = FAILING_SINCE;
  protected readonly PASSED_THEN = PASSED_THEN;
  protected readonly TRY_AGAIN = TRY_AGAIN;
  protected readonly NOT_FOUND_OR_PRIVATE = NOT_FOUND_OR_PRIVATE;
  protected readonly SSO_REQUIRED = SSO_REQUIRED;
  protected readonly AUTHORIZE_SSO = AUTHORIZE_SSO;
  protected readonly AUTHORIZE_TOKEN = AUTHORIZE_TOKEN;
  protected readonly TOKEN_REFUSED = TOKEN_REFUSED;
  protected readonly REPLACE_TOKEN = REPLACE_TOKEN;
}

/**
 * What a row shows of `glance`, as the server is told it once the row has loaded (FR-PERS-11): of
 * each part, only what loaded. A workflow run says how it ended only once it has.
 */
export function shownBy(glance: Glance): Shown {
  const shown: Shown = {};
  if (glance.latestRelease.ok) {
    shown.release = { tag: glance.latestRelease.release?.tag ?? null };
  }
  const runs = glance.workflowRuns;
  const conclusion = runs.ok && !runs.hidden ? runs.latest?.conclusion : undefined;
  if (conclusion !== undefined) {
    shown.conclusion = conclusion;
  }
  if (glance.repository.pushedAt !== undefined) {
    shown.pushed_at = glance.repository.pushedAt.toISOString();
  }
  return shown;
}
