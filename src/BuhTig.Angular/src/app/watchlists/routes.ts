import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { TITLES } from '../messages';
import { WatchlistsPage } from './page';

/**
 * The routes below `/-/watchlists`, which come with the watchlists' code as they are first opened,
 * rather than with the home page's (NFR-PERF-01): `/-/watchlists`, and each watchlist at
 * `/-/watchlists/{id}` (FR-PERS-08). Both are one route, so that moving from one watchlist to
 * another keeps the page, and what it knows of the user's watchlists.
 */
export const WATCHLIST_ROUTES: Routes = [
  { matcher: watchlistMatcher, component: WatchlistsPage, title: TITLES.watchlists },
  {
    path: '**',
    loadComponent: () => import('../not-found/not-found').then((module) => module.NotFound),
    title: TITLES.notFound,
  },
];

/** The watchlists' page, with the watchlist's ID as `id` when the URL names one. */
export function watchlistMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length > 1) {
    return null;
  }
  return {
    consumed: segments,
    posParams: segments.length === 1 ? { id: segments[0] } : {},
  };
}
