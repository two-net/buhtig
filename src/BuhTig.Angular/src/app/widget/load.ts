import { Signal, computed, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, map, of, startWith, switchMap } from 'rxjs';

/** Where a widget's data is: on its way, missing, failed, or there (FR-REPO-09). */
export type Load<T> =
  { status: 'loading' } | { status: 'empty' } | { status: 'error' } | { status: 'ready'; data: T };

/** A widget's data as it loads, and a way to load it again after a failure. */
export interface Loader<T> {
  readonly state: Signal<Load<T>>;
  retry(): void;
}

/**
 * Loads a widget's data with `request`, apart from the other widgets', so that its failure
 * is its own and they go on to show theirs (FR-REPO-09). Data that `isEmpty` says holds
 * nothing, such as a repository's without commits, is shown as empty, not as a failure
 * (FR-REPO-11).
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
      switchMap((data) =>
        data.pipe(
          map((data): Load<T> => (isEmpty(data) ? { status: 'empty' } : { status: 'ready', data })),
          catchError(() => of<Load<T>>({ status: 'error' })),
          startWith<Load<T>>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } },
  );
  return { state, retry: () => attempts.update((count) => count + 1) };
}
