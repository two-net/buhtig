import { Injectable, InjectionToken, inject } from '@angular/core';
import { NavigationError, PreloadingStrategy, Route, Router } from '@angular/router';
import { Observable, catchError, of, switchMap } from 'rxjs';

/** How long a page may stay busy before what it loads ahead of need goes all the same. */
export const IDLE_TIMEOUT_MS = 2000;

/** How long to wait instead, where the browser does not tell when it is idle, as Safari's. */
export const NO_IDLE_CALLBACK_MS = 500;

/**
 * Loads the routes whose `data` says `preload`, the dashboard's, ahead of need (NFR-PERF-04), but
 * only once the browser has a moment to spare, so that it comes after what the open page needs
 * (NFR-PERF-01). A route that fails to load is left to load as it is opened.
 */
@Injectable({ providedIn: 'root' })
export class PreloadWhenIdle implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (route.data?.['preload'] !== true) {
      return of(null);
    }
    return idle().pipe(
      switchMap(() => load()),
      catchError(() => of(null)),
    );
  }
}

/** Emits once the browser is idle, or once it has been busy for long enough. */
function idle(): Observable<void> {
  return new Observable((subscriber) => {
    const done = () => {
      subscriber.next();
      subscriber.complete();
    };
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(done, { timeout: IDLE_TIMEOUT_MS });
      return () => cancelIdleCallback(handle);
    }
    const handle = setTimeout(done, NO_IDLE_CALLBACK_MS);
    return () => clearTimeout(handle);
  });
}

/** How the browser loads a page of the app afresh, from the server. */
export const LOAD_PAGE = new InjectionToken<(url: string) => void>('load page', {
  factory: () => (url) => location.assign(url),
});

/**
 * Loads the page of a navigation afresh when the code it needed failed to load, as it does once a
 * new release of BuhTig has replaced the files that the page in the browser came with: the new
 * page comes with the new files. A page that has opened none yet does not, so that it cannot load
 * itself over and over while the server is out of reach.
 */
export function reloadForNewRelease(error: NavigationError): void {
  if (inject(Router).navigated && failedToLoad(error.error)) {
    inject(LOAD_PAGE)(error.url);
  }
}

/** Whether `error` is a browser's for a script that it could not import. */
function failedToLoad(error: unknown): boolean {
  // "Failed to fetch dynamically imported module" (Chrome), "error loading dynamically imported
  // module" (Firefox), "Importing a module script failed" (Safari).
  return error instanceof TypeError && /import/i.test(error.message);
}
