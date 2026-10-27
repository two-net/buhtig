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
} from '@angular/core';
import { ENTRANCE_MS, Entrance, Entrances } from '../motion/entrance';
import { Loader } from './load';
import { COMPUTING, FAILED, LOADING } from './messages';

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
 * The placeholder shimmers (FR-ANIM-04). The content makes its entrance as it is first shown in
 * view on the page, while the widget has the class `entering`, for what it shows to enter by
 * (FR-ANIM-07).
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
  protected readonly failed = FAILED;

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
  }

  protected retry(): void {
    this.content().loader().retry();
  }
}
