import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { About } from './about/about';
import { Dashboard } from './dashboard/dashboard';
import { Home } from './home/home';
import { NotFound } from './not-found/not-found';
import { Privacy } from './privacy/privacy';
import { Settings } from './settings/settings';
import { SignInFailed } from './sign-in/failed';
import { NotAllowed } from './sign-in/not-allowed';

export const routes: Routes = [
  { path: '', component: Home, title: 'BuhTig' },
  // BuhTig's own pages. No account name starts with a hyphen, so none is a dashboard's
  // (FR-NAV-03).
  {
    path: '-',
    children: [
      { path: 'about', component: About, title: 'About · BuhTig' },
      { path: 'privacy', component: Privacy, title: 'Privacy · BuhTig' },
      { path: 'settings', component: Settings, title: 'Settings · BuhTig' },
      // Where sign-in ends when it does not sign the user in (FR-AUTH-08).
      { path: 'not-allowed', component: NotAllowed, title: 'Not allowed · BuhTig' },
      { path: 'sign-in-failed', component: SignInFailed, title: 'Sign-in failed · BuhTig' },
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
