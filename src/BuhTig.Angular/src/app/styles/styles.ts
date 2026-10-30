import { Component, ViewEncapsulation } from '@angular/core';

// The styles that only some pages need, as classes for the whole page, apart from those of
// src/styles.css, so that they come with those pages' code rather than with the home page's
// (NFR-PERF-01). Each page that needs them shows one of these, which shows nothing else.

/** The styles of dashboards: their layout, boxes, widgets, stat cards, charts and lists. */
@Component({
  selector: 'app-dashboard-styles',
  template: '',
  styleUrls: [
    './dashboard.css',
    './notice.css',
    './stats.css',
    './charts.css',
    './lists.css',
    './sidebar.css',
  ],
  encapsulation: ViewEncapsulation.None,
})
export class DashboardStyles {}

/** The styles of the signed-in home page. */
@Component({
  selector: 'app-home-styles',
  template: '',
  styleUrls: ['./home.css'],
  encapsulation: ViewEncapsulation.None,
})
export class HomeStyles {}

/** The styles of Settings, its dialog, and the pages of prose. */
@Component({
  selector: 'app-page-styles',
  template: '',
  styleUrls: ['./pages.css', './notice.css'],
  encapsulation: ViewEncapsulation.None,
})
export class PageStyles {}
