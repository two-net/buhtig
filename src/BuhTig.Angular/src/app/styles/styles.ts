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
    './diverging.css',
    './trends.css',
    './lists.css',
    './sidebar.css',
    './dialog.css',
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
  styleUrls: ['./pages.css', './notice.css', './dialog.css'],
  encapsulation: ViewEncapsulation.None,
})
export class PageStyles {}

/**
 * The styles of a user's watchlists (FR-PERS-08), beside Settings': each repository's row, with its
 * placeholders and sparkline, as a dashboard draws them.
 */
@Component({
  selector: 'app-watchlist-styles',
  template: '',
  styleUrls: ['./dashboard.css', './charts.css', './watchlists.css'],
  encapsulation: ViewEncapsulation.None,
})
export class WatchlistStyles {}

/** The styles of a comparison of two repositories or two accounts, beside a dashboard's. */
@Component({
  selector: 'app-compare-styles',
  template: '',
  styleUrls: ['./compare.css'],
  encapsulation: ViewEncapsulation.None,
})
export class CompareStyles {}
