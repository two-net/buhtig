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
  | { status: 'error' }
  | { status: 'ready'; data: T };

/** A widget's data as it loads, and a way to load it again after a failure. */
export interface Loader<T> {
  readonly state: Signal<Load<T>>;
  retry(): void;
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
        : of<Load<T>>({ status: 'error' }),
    ),
  );
}
