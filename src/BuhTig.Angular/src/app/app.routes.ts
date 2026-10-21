import { Routes } from '@angular/router';
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
  { path: ':owner/:repo', component: Dashboard },
  { path: ':org', component: Dashboard },
];
