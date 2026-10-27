import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Motion } from './motion';

/**
 * The search box's way from the middle of the home page into a dashboard's header, as the one
 * page gives way to the other (FR-ANIM-03).
 */
@Injectable({ providedIn: 'root' })
export class Glide {
  private readonly router = inject(Router);
  private readonly motion = inject(Motion);

  /** Where the home page's search box was as a navigation away from it started. */
  private left: { navigation: number; from: DOMRect } | undefined;

  /** Notes that the search box was at `from` as `navigation` left the home page. */
  leave(navigation: number, from: DOMRect): void {
    this.left = { navigation, from };
  }

  /**
   * Where the search box is to glide from, once: where it was on the home page, if the
   * navigation in progress leaves it, and motion is on. Read as the dashboard is made, while that
   * navigation is still in progress.
   */
  take(): DOMRect | undefined {
    const left = this.left;
    this.left = undefined;
    if (
      left === undefined ||
      left.navigation !== this.router.currentNavigation()?.id ||
      !this.motion.full() ||
      left.from.width === 0 ||
      left.from.height === 0
    ) {
      return undefined;
    }
    return left.from;
  }
}
