import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Motion } from './motion';

/** How long a widget's entrance takes at most: as long as a stat card's count-up (FR-ANIM-05). */
export const ENTRANCE_MS = 1_000;

/**
 * Which widgets have made their entrance on the page that the last navigation opened: as their
 * content was first shown in view, once per page (FR-ANIM-07). A refresh is no navigation, so
 * the widgets it makes anew do not enter again. Another navigation, even to the same dashboard,
 * opens another page, on which they enter again.
 */
@Injectable({ providedIn: 'root' })
export class Entrances {
  private readonly router = inject(Router);
  private readonly motion = inject(Motion);

  /** The navigation on whose page each widget, by its heading, made its entrance. */
  private readonly entered = new Map<string, number | undefined>();

  /**
   * Whether the widget headed `heading` is to make its entrance now, which it then has: not if
   * it has on this page already, nor while motion is off (FR-ANIM-10).
   */
  claim(heading: string): boolean {
    const navigation = this.router.lastSuccessfulNavigation()?.id;
    if (
      !this.motion.full() ||
      (this.entered.has(heading) && this.entered.get(heading) === navigation)
    ) {
      return false;
    }
    this.entered.set(heading, navigation);
    return true;
  }
}

/**
 * One widget's entrance, which what it shows enters by: its bars grow, its figures count up and
 * its lists come in one item after another (FR-ANIM-05 to FR-ANIM-08).
 */
@Injectable()
export class Entrance {
  /** Whether the widget is making its entrance now. */
  readonly playing = signal(false);
}
