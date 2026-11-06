import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { TITLES } from '../messages';
import { Comparison } from './compare';
import { comparisonTitle } from './messages';
import { compareMatcher } from './route';

/**
 * The routes below `/-/compare/`, which come with the comparison's code as it is first opened,
 * rather than with the home page's (NFR-PERF-01): two repositories, or two accounts, side by side
 * (FR-CMP-01). Any other path below it is no page.
 */
export const COMPARE_ROUTES: Routes = [
  { matcher: compareMatcher, component: Comparison, title: compareTitle },
  {
    path: '**',
    loadComponent: () => import('../not-found/not-found').then((module) => module.NotFound),
    title: TITLES.notFound,
  },
];

/**
 * "{first} vs {second} · BuhTig" (UI-04), with the names as GitHub spells them once the
 * comparison has moved to its canonical URL (FR-CMP-01).
 */
function compareTitle(route: ActivatedRouteSnapshot): string {
  return comparisonTitle(route.paramMap.get('first') ?? '', route.paramMap.get('second') ?? '');
}
