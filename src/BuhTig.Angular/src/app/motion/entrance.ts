import {
  DestroyRef,
  Directive,
  ElementRef,
  Injectable,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { dashboardOf } from '../dashboard/tabs';
import { Motion } from './motion';

/** How long an entrance takes at most: as long as a stat card's count-up (FR-ANIM-05). */
export const ENTRANCE_MS = 1_000;

/**
 * Which widgets have made their entrance on the page the user is on: as their content was first
 * shown in view, once per page (FR-ANIM-07). A refresh is no navigation, so the widgets it makes
 * anew do not enter again, and neither do those of another tab of the same dashboard, which is
 * the same page. Another navigation, even back to the same dashboard, opens another page, on
 * which they enter again.
 */
@Injectable({ providedIn: 'root' })
export class Entrances {
  private readonly motion = inject(Motion);

  /** The page each widget, by its name, made its entrance on. */
  private readonly entered = new Map<string, number>();
  /** The page the user is on, counted from the first, and which dashboard it is of, if any. */
  private page = 0;
  private dashboard: string | undefined;

  constructor() {
    const router = inject(Router);
    // Made once a page needs it, after the navigation that opened that page.
    this.dashboard = dashboardOf(router.url);
    router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const dashboard = dashboardOf(event.urlAfterRedirects);
        if (dashboard === undefined || dashboard !== this.dashboard) {
          this.page++;
        }
        this.dashboard = dashboard;
      });
  }

  /**
   * Whether the widget named `name` is to make its entrance now, which it then has: not if it
   * has on this page already, nor while motion is off (FR-ANIM-10).
   */
  claim(name: string): boolean {
    if (!this.motion.full() || this.entered.get(name) === this.page) {
      return false;
    }
    this.entered.set(name, this.page);
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

/**
 * Plays the entrance of `host`, named `name`, as what it shows is first `ready` in view on the
 * page (FR-ANIM-07): `entrance` plays for `ENTRANCE_MS`, unless motion turns off on its way
 * (FR-ANIM-10). Called where `inject` works, as in a constructor.
 */
export function enterInView(
  host: HTMLElement,
  name: () => string,
  ready: () => boolean,
  entrance: Entrance,
): void {
  const entrances = inject(Entrances);
  const motion = inject(Motion);
  const destroyRef = inject(DestroyRef);
  /** Whether the host is in view, as far as the browser tells. */
  const inView = signal(false);

  // Not every environment can tell what is in view; the tests' jsdom cannot. There, nothing
  // makes an entrance.
  afterNextRender(() => {
    if (typeof IntersectionObserver !== 'function') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => inView.set(entries[entries.length - 1].isIntersecting),
      { threshold: 0.12 },
    );
    observer.observe(host);
    destroyRef.onDestroy(() => observer.disconnect());
  });

  // Content shown out of view enters once it scrolls into view.
  let ending: ReturnType<typeof setTimeout> | undefined;
  effect(() => {
    if (!ready() || !inView()) {
      return;
    }
    untracked(() => {
      if (entrances.claim(name())) {
        entrance.playing.set(true);
        // Then what it shows anew, such as another page of a list, comes in at once.
        ending = setTimeout(() => entrance.playing.set(false), ENTRANCE_MS);
      }
    });
  });
  destroyRef.onDestroy(() => clearTimeout(ending));

  // The browser may ask for reduced motion while the page is open, even as the content enters.
  // Then what it shows is there at once, with its figures at their values (FR-ANIM-10).
  effect(() => {
    if (!motion.full()) {
      entrance.playing.set(false);
    }
  });
}

/**
 * Makes the entrance of what it is on, named `appEnter`, such as a box of stat cards, as a
 * widget makes its own, while it has the class `entering`.
 */
@Directive({
  selector: '[appEnter]',
  providers: [Entrance],
  host: { '[class.entering]': 'entrance.playing()' },
})
export class Enter {
  readonly name = input.required<string>({ alias: 'appEnter' });
  /** Whether what it shows is there to enter, as it is unless it says not. */
  readonly ready = input(true, { alias: 'appEnterReady' });

  protected readonly entrance = inject(Entrance);

  constructor() {
    enterInView(
      inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
      this.name,
      this.ready,
      this.entrance,
    );
  }
}
