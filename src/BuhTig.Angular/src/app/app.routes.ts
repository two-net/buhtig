import { Routes } from '@angular/router';
import { Dashboard } from './dashboard/dashboard';
import { Home } from './home/home';

export const routes: Routes = [
  { path: '', component: Home, title: 'BuhTig' },
  { path: ':owner/:repo', component: Dashboard },
  { path: ':org', component: Dashboard },
];
