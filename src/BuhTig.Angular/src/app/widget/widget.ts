import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  TemplateRef,
  afterNextRender,
  computed,
  contentChild,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { ENTRANCE_MS, Entrance, Entrances } from '../motion/entrance';
import { Motion } from '../motion/motion';
import { signInUrl } from '../session/session';
import { Failure, Loader } from './load';
import { COMPUTING, FAILED, HELD, LOADED, LOADING, UNAVAILABLE } from './messages';

/**
 * A widget's content, as `<ng-template [appLoaded]="loader" let-data>`, given the data once it
 * has loaded. Until then the widget shows its other states, and the content does not exist.
 */
@Directive({ selector: 'ng-template[appLoaded]' })
export class Loaded<T> {
  readonly loader = input.required<Loader<T>>({ alias: 'appLoaded' });
  readonly template = inject<TemplateRef<{ $implicit: T }>>(TemplateRef);

  static ngTemplateContextGuard<T>(_: Loaded<T>, context: unknown): context is { $implicit: T } {
    return true;
  }
}

let count = 0;

/**
 * One of a dashboard's widgets, in its grid (UI-05): a heading, then its content, or a
 * placeholder while it loads, a message when there is nothing to show, or a message and "Try
 * again" when loading failed (FR-REPO-09). While GitHub is still computing its data, it says so
 * over the placeholder (FR-REPO-10).
 *
 * The message of a failure says why, and what the user can do (NFR-UX-06): try again, or sign in
 * once the server asks GitHub for no more for visitors (FR-DATA-10). "Try again" goes as it is
 * pressed, so focus goes to the widget, which then announces what it came to (NFR-UX-03).
 *
 * The placeholder shimmers (FR-ANIM-04). The content makes its entrance as it is first shown in
 * view on the page, while the widget has the class `entering`, for what it shows to enter by
 * (FR-ANIM-07). The entrance ends at once if motion turns off on its way (FR-ANIM-10).
 */
@Component({
  selector: 'app-widget',
  imports: [NgTemplateOutlet],
  templateUrl: './widget.html',
  styleUrl: './widget.css',
  providers: [Entrance],
  host: { '[class.wide]': 'wide()', '[class.entering]': 'entrance.playing()' },
})
export class Widget {
  readonly heading = input.required<string>();
  /** What the widget says when there is nothing to show, such as "No releases yet." */
  readonly empty = input.required<string>();
  /** Whether it spans the grid's columns, as a row of stat cards does. */
  readonly wide = input(false);
  /**
   * Whether its heading is for assistive technology alone, as for a row of stat cards, whose
   * labels say what they are.
   */
  readonly hideHeading = input(false);

  private readonly entrances = inject(Entrances);
  private readonly motion = inject(Motion);
  protected readonly entrance = inject(Entrance);
  /** Whether the widget is in view, as far as the browser tells. */
  private readonly inView = signal(false);

  protected readonly content = contentChild.required(Loaded);
  protected readonly state = computed(() => this.content().loader().state());
  protected readonly busy = computed(() => {
    const status = this.state().status;
    return status === 'loading' || status === 'computing';
  });
  protected readonly data = computed(() => {
    const state = this.state();
    return state.status === 'ready' ? state.data : undefined;
  });
  protected readonly id = `widget-${count++}`;
  protected readonly loading = LOADING;
  protected readonly computing = COMPUTING;

  private readonly failure = computed(() => {
    const state = this.state();
    return state.status === 'error' ? state.failure : undefined;
  });
  protected readonly failed = computed(() => FAILURES[this.failure() ?? 'github']);
  protected readonly held = computed(() => this.failure() === 'held');
  private readonly router = inject(Router);

  private readonly section = viewChild.required<ElementRef<HTMLElement>>('section');
  /** Whether "Try again" has been pressed, after which the widget says what it came to. */
  private readonly retried = signal(false);
  protected readonly outcome = computed(() => {
    if (!this.retried()) {
      return '';
    }
    switch (this.state().status) {
      case 'loading':
        return '';
      case 'computing':
        return COMPUTING;
      case 'empty':
        return this.empty();
      case 'error':
        return this.failed();
      case 'ready':
        return LOADED;
    }
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    // Not every environment can tell what is in view; the tests' jsdom cannot. There, nothing
    // makes an entrance.
    afterNextRender(() => {
      if (typeof IntersectionObserver !== 'function') {
        return;
      }
      const observer = new IntersectionObserver((entries) =>
        this.inView.set(entries[entries.length - 1].isIntersecting),
      );
      observer.observe(host);
      destroyRef.onDestroy(() => observer.disconnect());
    });

    // Content shown out of view enters once it scrolls into view.
    let ending: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      if (this.state().status !== 'ready' || !this.inView()) {
        return;
      }
      untracked(() => {
        if (this.entrances.claim(this.heading())) {
          this.entrance.playing.set(true);
          // Then what it shows anew, such as another page of a table, comes in at once.
          ending = setTimeout(() => this.entrance.playing.set(false), ENTRANCE_MS);
        }
      });
    });
    destroyRef.onDestroy(() => clearTimeout(ending));

    // The browser may ask for reduced motion while the page is open, even as the content enters.
    // Then what it shows is there at once, with its figures at their values (FR-ANIM-10).
    effect(() => {
      if (!this.motion.full()) {
        this.entrance.playing.set(false);
      }
    });
  }

  /** Where signing in starts, to come back to the dashboard (FR-AUTH-05). */
  protected signIn(): string {
    return signInUrl(this.router.url);
  }

  protected retry(): void {
    this.retried.set(true);
    this.content().loader().retry();
    this.section().nativeElement.focus();
  }
}

/** What a widget says of each failure (NFR-UX-06). */
const FAILURES: Record<Failure, string> = {
  held: HELD,
  unavailable: UNAVAILABLE,
  github: FAILED,
};
