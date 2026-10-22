import { DOCUMENT, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, skip, take } from 'rxjs';

/** The link-preview tags that the server writes into a dashboard's page (FR-NAV-06). */
const TAGS = 'meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]';

/**
 * Removes the link-preview tags from the page once the app navigates away from the page the server
 * served, since they describe that page alone. Chat tools read the page as served, without running
 * the app, so they still find them.
 */
export function dropPreviewOnNavigation(): void {
  const document = inject(DOCUMENT);
  inject(Router)
    .events.pipe(
      filter((event) => event instanceof NavigationEnd),
      // The first is to the page as served.
      skip(1),
      take(1),
    )
    .subscribe(() => document.head.querySelectorAll(TAGS).forEach((tag) => tag.remove()));
}
