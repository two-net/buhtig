import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { About } from './about/about';
import { Dashboard } from './dashboard/dashboard';
import { Home } from './home/home';
import { NotFound } from './not-found/not-found';
import { Privacy } from './privacy/privacy';

export const routes: Routes = [
  { path: '', component: Home, title: 'BuhTig' },
  // BuhTig's own pages. No account name starts with a hyphen, so none is a dashboard's
  // (FR-NAV-03).
  {
    path: '-',
    children: [
      { path: 'about', component: About, title: 'About · BuhTig' },
      { path: 'privacy', component: Privacy, title: 'Privacy · BuhTig' },
      { path: '**', component: NotFound, title: 'Page not found · BuhTig' },
    ],
  },
  { path: ':owner/:repo', component: Dashboard, title: dashboardTitle },
  { path: ':org', component: Dashboard, title: dashboardTitle },
];

/**
 * "{owner}/{repo} · BuhTig" or "{org} · BuhTig" (UI-04), with the names as GitHub spells them
 * once the dashboard has moved to its canonical URL (FR-NAV-04).
 */
function dashboardTitle(route: ActivatedRouteSnapshot): string {
  const params = route.paramMap;
  return `${params.get('org') ?? `${params.get('owner')}/${params.get('repo')}`} · BuhTig`;
}
