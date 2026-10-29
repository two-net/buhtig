import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { About } from './about/about';
import { Dashboard } from './dashboard/dashboard';
import { Home } from './home/home';
import { NotFound } from './not-found/not-found';
import { Privacy } from './privacy/privacy';
import { Settings } from './settings/settings';
import { SignInFailed } from './sign-in/failed';
import { NotAllowed } from './sign-in/not-allowed';
import { SignIn } from './sign-in/sign-in';
import { TITLES, dashboardTitle } from './messages';

export const routes: Routes = [
  { path: '', component: Home, title: TITLES.home },
  // BuhTig's own pages. No account name starts with a hyphen, so none is a dashboard's
  // (FR-NAV-03).
  {
    path: '-',
    children: [
      { path: 'about', component: About, title: TITLES.about },
      { path: 'privacy', component: Privacy, title: TITLES.privacy },
      { path: 'settings', component: Settings, title: TITLES.settings },
      // Where private mode sends visitors, to sign in and come back (FR-ACC-03).
      { path: 'sign-in', component: SignIn, title: TITLES.signIn },
      // Where sign-in ends when it does not sign the user in (FR-AUTH-08).
      { path: 'not-allowed', component: NotAllowed, title: TITLES.notAllowed },
      { path: 'sign-in-failed', component: SignInFailed, title: TITLES.signInFailed },
      { path: '**', component: NotFound, title: TITLES.notFound },
    ],
  },
  { path: ':owner/:repo', component: Dashboard, title: titleOf },
  { path: ':org', component: Dashboard, title: titleOf },
];

/**
 * "{owner}/{repo} · BuhTig" or "{org} · BuhTig" (UI-04), with the names as GitHub spells them
 * once the dashboard has moved to its canonical URL (FR-NAV-04).
 */
function titleOf(route: ActivatedRouteSnapshot): string {
  const params = route.paramMap;
  return dashboardTitle(params.get('org') ?? `${params.get('owner')}/${params.get('repo')}`);
}
