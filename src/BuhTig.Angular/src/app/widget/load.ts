import { HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import { Signal, computed, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, concat, map, of, startWith, switchMap, timer } from 'rxjs';

/**
 * Where a widget's data is: on its way, still being computed by GitHub, missing, failed, or
 * there (FR-REPO-09, FR-REPO-10).
 */
export type Load<T> =
  | { status: 'loading' }
  | { status: 'computing' }
  | { status: 'empty' }
  | { status: 'error'; failure: Failure }
  | { status: 'ready'; data: T };

/**
 * Why a widget's data failed to load, for the widget to say what the user can do (NFR-UX-06):
 * - `held`: the server asks GitHub for no more for visitors for now, since the visitor has
 *   loaded as many dashboards as they may, or visitors together nearly have (FR-DATA-10,
 *   FR-DATA-11).
 * - `unavailable`: the server cannot reach its database.
 * - `github`: GitHub failed, or took too long to compute the data (FR-REPO-10), or anything
 *   else did.
 */
export type Failure = 'held' | 'unavailable' | 'github';

/** A widget's data as it loads, and a way to load it again after a failure. */
export interface Loader<T> {
  readonly state: Signal<Load<T>>;
  retry(): void;
}

/**
 * `loader`, but empty when `isEmpty` says that its data holds nothing for the widget that shows
 * it, as when another widget shows the same data and has something to show.
 */
export function emptyWhen<T>(loader: Loader<T>, isEmpty: (data: T) => boolean): Loader<T> {
  return {
    state: computed(() => {
      const state = loader.state();
      return state.status === 'ready' && isEmpty(state.data) ? { status: 'empty' } : state;
    }),
    retry: () => loader.retry(),
  };
}

/**
 * What a widget's request fails with while GitHub is still computing its data, as it computes a
 * repository's statistics. The widget then asks again (FR-REPO-10).
 */
export class Computing extends Error {}

/**
 * How long a widget waits each time before it asks again for data that GitHub is still
 * computing: longer each time, and 60 seconds in all (FR-REPO-10). After that it fails.
 */
export const RECHECK_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/**
 * Loads a widget's data with `request`, apart from the other widgets', so that its failure
 * is its own and they go on to show theirs (FR-REPO-09). Data that `isEmpty` says holds
 * nothing, such as a repository's without commits, is shown as empty, not as a failure
 * (FR-REPO-11). While GitHub is still computing the data, it is asked for again
 * (FR-REPO-10).
 *
 * `request` is made again whenever a signal it reads changes, as when the dashboard moves to
 * another repository. It is called where `inject` works, as in a field's initializer.
 */
export function load<T>(
  request: () => Observable<T>,
  isEmpty: (data: T) => boolean = () => false,
): Loader<T> {
  const attempts = signal(0);
  const attempt = computed(() => {
    attempts();
    return request();
  });
  const state = toSignal(
    toObservable(attempt).pipe(
      switchMap((data) => answer(data, isEmpty, 0).pipe(startWith<Load<T>>({ status: 'loading' }))),
    ),
    { initialValue: { status: 'loading' } },
  );
  return { state, retry: () => attempts.update((count) => count + 1) };
}

/**
 * What `data` comes to, once it has been asked for after `rechecks` waits for GitHub to compute
 * it.
 */
function answer<T>(
  data: Observable<T>,
  isEmpty: (data: T) => boolean,
  rechecks: number,
): Observable<Load<T>> {
  return data.pipe(
    map((data): Load<T> => (isEmpty(data) ? { status: 'empty' } : { status: 'ready', data })),
    catchError((error: unknown) =>
      error instanceof Computing && rechecks < RECHECK_MS.length
        ? concat(
            of<Load<T>>({ status: 'computing' }),
            timer(RECHECK_MS[rechecks]).pipe(switchMap(() => answer(data, isEmpty, rechecks + 1))),
          )
        : of<Load<T>>({ status: 'error', failure: failureOf(error) }),
    ),
  );
}

/** Why a request failed with `error`, as the server's status says. */
export function failureOf(error: unknown): Failure {
  if (!(error instanceof HttpErrorResponse)) {
    return 'github';
  }
  switch (error.status) {
    case HttpStatusCode.TooManyRequests:
      return 'held';
    case HttpStatusCode.ServiceUnavailable:
      return 'unavailable';
    default:
      return 'github';
  }
}
