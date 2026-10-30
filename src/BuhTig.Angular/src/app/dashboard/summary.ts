import { Signal, WritableSignal, computed, inject, linkedSignal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, mergeMap, switchMap } from 'rxjs';
import { Announcer } from '../live/announcer';
import { Resource, dashboardPath } from '../search/parse';
import { Session } from '../session/session';
import { Personal } from '../shortcuts/personal';
import { shortcutOf } from '../shortcuts/pick';
import { Toasts } from '../toast/toasts';
import { REFRESHED, STILL_SAVED, loaded, renamed } from './messages';
import { Resources, Summary } from './resources';

/** What a dashboard knows of its resource, and how to ask again. */
export interface Followed {
  /** What BuhTig knows of the resource, once it says, for each resource anew. */
  readonly summary: Signal<Summary | undefined>;
  /** Whether the dashboard is being refreshed, until its data has come again. */
  readonly refreshing: WritableSignal<boolean>;
  /** Asks for the resource again, as after a failure. */
  retry(): void;
}

/**
 * Follows what BuhTig knows of a dashboard's `resource`, as its URL names it: asked for again on
 * each refresh (FR-DATA-07). Called where `inject` works, as in a constructor.
 *
 * Once it knows how GitHub spells the names, the dashboard moves there, to the same tab, `at`
 * the canonical path, in place of the URL it was opened at (FR-NAV-04), and says so when the
 * resource was renamed or transferred (FR-NAV-05). Its view is then recorded in a signed-in
 * user's history, once per dashboard (FR-PERS-01), and assistive technology is told that it has
 * loaded. A refresh says what came of it, and keeps what was shown when nothing came instead.
 */
export function followSummary(resource: Signal<Resource>, at: (path: string) => string): Followed {
  const router = inject(Router);
  const resources = inject(Resources);
  const personal = inject(Personal);
  const toasts = inject(Toasts);
  const announcer = inject(Announcer);
  const user = inject(Session).user;

  const summary = linkedSignal<Resource, Summary | undefined>({
    source: resource,
    computation: () => undefined,
  });
  const refreshing = signal(false);
  const attempts = signal(0);

  // Asked for again on each refresh, and each retry.
  const asked = computed(() => ({
    resource: resource(),
    refreshes: resources.refreshes(),
    attempts: attempts(),
  }));
  toObservable(asked)
    .pipe(
      // A dashboard left behind no longer moves.
      switchMap(({ resource }) =>
        resources.summary(resource).pipe(map((answer) => ({ resource, answer }))),
      ),
      takeUntilDestroyed(),
    )
    .subscribe(({ resource, answer }) => {
      const before = summary();
      const wasRefreshing = refreshing();
      refreshing.set(false);
      if (wasRefreshing) {
        toasts.show(
          answer.failure || answer.stale ? STILL_SAVED : REFRESHED,
          answer.failure || answer.stale ? 'cloudoff' : 'check',
        );
      }
      // What was shown stays, rather than a failure to show it again.
      if (answer.failure && before?.path !== undefined) {
        return;
      }
      summary.set(answer);
      if (before === undefined && answer.path !== undefined) {
        announcer.announce(loaded(answer.path.slice(1)));
      }
      if (answer.path === undefined) {
        return;
      }
      const opened = dashboardPath(resource);
      if (answer.path.toLowerCase() !== opened.toLowerCase()) {
        toasts.show(renamed(opened.slice(1), answer.path.slice(1)), 'info');
      }
      toCanonical(answer.path);
    });

  /**
   * Moves to the canonical URL of the dashboard at `path`, in place of the URL in the history, so
   * that Back does not lead to it again, unless the dashboard is there already.
   */
  function toCanonical(path: string): void {
    const canonical = at(path);
    if (canonical !== router.url.split(/[?#]/)[0]) {
      void router.navigateByUrl(canonical, { replaceUrl: true });
    }
  }

  // A move to the same dashboard spelled otherwise, as from its search box, asks for nothing
  // new, since the resource is the same: the dashboard moves back to its canonical URL.
  router.events
    .pipe(
      filter((event) => event instanceof NavigationEnd),
      takeUntilDestroyed(),
    )
    .subscribe(() => {
      const path = summary()?.path;
      const here = router.url.split(/[?#]/)[0];
      if (path !== undefined && at(path).toLowerCase() === here.toLowerCase()) {
        toCanonical(path);
      }
    });

  // The resource, for a signed-in user, with the names as GitHub spells them, once BuhTig knows:
  // what their history records. Not one that GitHub says is not there, or keeps from the viewer,
  // which has no path.
  const viewed = computed(
    () => {
      const path = summary()?.path;
      const current = resource();
      return user() && path?.toLowerCase() === dashboardPath(current).toLowerCase()
        ? resourceAt(path!, current.kind)
        : undefined;
    },
    { equal: (a, b) => a === b || (a !== undefined && b !== undefined && same(a, b)) },
  );
  toObservable(viewed)
    .pipe(
      filter((resource) => resource !== undefined),
      mergeMap((resource) => personal.record(shortcutOf(resource))),
      takeUntilDestroyed(),
    )
    .subscribe();

  return { summary, refreshing, retry: () => attempts.update((count) => count + 1) };
}

/** The resource of `kind` whose dashboard's path is `path`, such as `/owner/repo`. */
function resourceAt(path: string, kind: Resource['kind']): Resource {
  if (kind === 'organization') {
    return { kind, org: path.slice(1) };
  }
  const [owner, repo] = path.slice(1).split('/');
  return { kind, owner, repo };
}

/** Whether `a` and `b` are the same resource, whatever the letter case of their names. */
export function same(a: Resource, b: Resource): boolean {
  return dashboardPath(a).toLowerCase() === dashboardPath(b).toLowerCase();
}
