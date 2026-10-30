import { DOCUMENT, Injector, afterNextRender, inject } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { dashboardOf } from '../dashboard/tabs';

/**
 * Moves focus to the heading of each page the app navigates to, as a browser that loads a new
 * page starts from its top, so that assistive technology says where the user now is (WCAG 2.4.3).
 * Not on the page as served, which the browser has just loaded, nor when the URL only changes in
 * place, as when a dashboard moves to its canonical URL (FR-NAV-04).
 *
 * Focus stays where the new page puts it, as the home page does in the search box (FR-SRCH-07).
 * It moves when what had it is gone, or still has it from the page before, as the search box in a
 * dashboard's header does after a search. Moving to another tab of the same dashboard is no new
 * page: focus stays on the tab.
 */
export function focusPageOnNavigation(): void {
  const document = inject(DOCUMENT);
  const injector = inject(Injector);
  const router = inject(Router);
  /** What had focus as the navigation started. */
  let before: Element | null = null;
  /** Whether the navigation changes the URL in place, or stays on the same dashboard. */
  let inPlace = false;
  let first = true;
  router.events.subscribe((event) => {
    if (event instanceof NavigationStart) {
      before = document.activeElement;
      const from = dashboardOf(router.url);
      inPlace =
        router.currentNavigation()?.extras.replaceUrl === true ||
        (from !== undefined && from === dashboardOf(event.url));
      return;
    }
    if (!(event instanceof NavigationEnd)) {
      return;
    }
    if (first || inPlace) {
      first = false;
      return;
    }
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active !== null && active !== document.body && active !== before) {
          return;
        }
        const heading = document.querySelector<HTMLElement>('h1') ?? document.querySelector('main');
        if (heading === null) {
          return;
        }
        if (!heading.hasAttribute('tabindex')) {
          heading.setAttribute('tabindex', '-1');
        }
        heading.focus();
      },
      { injector },
    );
  });
}
