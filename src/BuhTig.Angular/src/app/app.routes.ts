import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { Home } from './home/home';
import {
  ORGANIZATION_TABS,
  REPOSITORY_TABS,
  organizationMatcher,
  repositoryMatcher,
} from './dashboard/tabs';
import { TITLES, dashboardTitle } from './messages';

/**
 * A dashboard: most of the app, and none of the home page's, so that the home page comes quickly
 * (NFR-PERF-01). Each page loads it ahead of need once it has settled, so that it opens at once
 * (NFR-PERF-04), from the search box as from a link.
 */
const repository = () =>
  import('./dashboard/repository').then((module) => module.RepositoryDashboard);
const organization = () =>
  import('./dashboard/organization').then((module) => module.OrganizationDashboard);

const notFound = () => import('./not-found/not-found').then((module) => module.NotFound);

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
      // Where private mode sends visitors, to sign in and come back (FR-ACC-03).
      {
        path: 'sign-in',
        loadComponent: () => import('./sign-in/sign-in').then((module) => module.SignIn),
        title: TITLES.signIn,
      },
      // Where sign-in ends when it does not sign the user in (FR-AUTH-08).
      {
        path: 'not-allowed',
        loadComponent: () => import('./sign-in/not-allowed').then((module) => module.NotAllowed),
        title: TITLES.notAllowed,
      },
      {
        path: 'sign-in-failed',
        loadComponent: () => import('./sign-in/failed').then((module) => module.SignInFailed),
        title: TITLES.signInFailed,
      },
      { path: '**', loadComponent: notFound, title: TITLES.notFound },
    ],
  },
  // A dashboard and its tabs, at the paths of the matching pages on GitHub (FR-NAV-01). Moving
  // between tabs keeps the dashboard, and what it has loaded.
  {
    matcher: organizationMatcher,
    loadComponent: organization,
    title: organizationTitle,
    data: { preload: true },
  },
  {
    matcher: repositoryMatcher,
    loadComponent: repository,
    title: repositoryTitle,
    data: { preload: true },
  },
  // Other paths below a dashboard are the server's to redirect, before the app loads.
  { path: '**', loadComponent: notFound, title: TITLES.notFound },
];

/**
 * "{owner}/{repo} · BuhTig", after the tab's name unless it is the overview, such as "Issues ·
 * owner/repo · BuhTig" (UI-04), with the names as GitHub spells them once the dashboard has
 * moved to its canonical URL (FR-NAV-04).
 */
function repositoryTitle(route: ActivatedRouteSnapshot): string {
  const params = route.paramMap;
  const tab = REPOSITORY_TABS.find(({ tab }) => tab === params.get('tab'));
  return dashboardTitle(`${params.get('owner')}/${params.get('repo')}`, tab?.label);
}

/** "{org} · BuhTig", after the tab's name unless it is the overview (UI-04). */
function organizationTitle(route: ActivatedRouteSnapshot): string {
  const params = route.paramMap;
  const tab = ORGANIZATION_TABS.find(({ tab }) => tab === params.get('tab'));
  return dashboardTitle(params.get('org') ?? '', tab?.label);
}
