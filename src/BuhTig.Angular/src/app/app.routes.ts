import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { Home } from './home/home';
import { NotFound } from './not-found/not-found';
import { SignInFailed } from './sign-in/failed';
import { NotAllowed } from './sign-in/not-allowed';
import { SignIn } from './sign-in/sign-in';
import { TITLES, dashboardTitle } from './messages';

/**
 * A dashboard: most of the app, and none of the home page's, so that the home page comes quickly
 * (NFR-PERF-01). Each page loads it ahead of need once it has settled, so that it opens at once
 * (NFR-PERF-04), from the search box as from a link.
 */
const dashboard = () => import('./dashboard/dashboard').then((module) => module.Dashboard);

export const routes: Routes = [
  { path: '', component: Home, title: TITLES.home },
  // BuhTig's own pages. No account name starts with a hyphen, so none is a dashboard's
  // (FR-NAV-03). Those that the home page links to come as they are opened.
  {
    path: '-',
    children: [
      {
        path: 'about',
        loadComponent: () => import('./about/about').then((module) => module.About),
        title: TITLES.about,
      },
      {
        path: 'privacy',
        loadComponent: () => import('./privacy/privacy').then((module) => module.Privacy),
        title: TITLES.privacy,
      },
      {
        path: 'settings',
        loadComponent: () => import('./settings/settings').then((module) => module.Settings),
        title: TITLES.settings,
      },
      // Where private mode sends visitors, to sign in and come back (FR-ACC-03). Sign-in ends
      // on these pages with a page load of its own, so they come with the app.
      { path: 'sign-in', component: SignIn, title: TITLES.signIn },
      // Where sign-in ends when it does not sign the user in (FR-AUTH-08).
      { path: 'not-allowed', component: NotAllowed, title: TITLES.notAllowed },
      { path: 'sign-in-failed', component: SignInFailed, title: TITLES.signInFailed },
      { path: '**', component: NotFound, title: TITLES.notFound },
    ],
  },
  { path: ':owner/:repo', loadComponent: dashboard, title: titleOf, data: { preload: true } },
  { path: ':org', loadComponent: dashboard, title: titleOf, data: { preload: true } },
];

/**
 * "{owner}/{repo} · BuhTig" or "{org} · BuhTig" (UI-04), with the names as GitHub spells them
 * once the dashboard has moved to its canonical URL (FR-NAV-04).
 */
function titleOf(route: ActivatedRouteSnapshot): string {
  const params = route.paramMap;
  return dashboardTitle(params.get('org') ?? `${params.get('owner')}/${params.get('repo')}`);
}
