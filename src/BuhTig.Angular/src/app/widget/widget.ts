import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  Directive,
  ElementRef,
  TemplateRef,
  computed,
  contentChild,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { DataTable, ChartTable } from '../chart/table';
import { SHOW_CHART, SHOW_TABLE } from '../chart/messages';
import { Icon, IconName } from '../icon/icon';
import { Entrance, enterInView } from '../motion/entrance';
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

/** The shape of a widget's placeholder, after its content's. */
export type Skeleton = 'list' | 'bars' | 'stack' | 'chart';

let count = 0;

/**
 * One of a dashboard's widgets: a heading, then its content, or a placeholder while it loads, a
 * message when there is nothing to show, or a message and "Try again" when loading failed
 * (FR-REPO-09). While GitHub is still computing its data, it says so (FR-REPO-10). Once its
 * content shows, a sentence below the heading may say what it shows, and "Show table" shows its
 * data as a table in place of its chart (NFR-UX-04). What is marked `footer`, such as a link to
 * see more, goes below it then.
 *
 * The message of a failure says why, and what the user can do (NFR-UX-06): try again, or sign in
 * once the server asks GitHub for no more for visitors (FR-DATA-10). "Try again" goes as it is
 * pressed, so focus goes to the widget, which then announces what it came to (NFR-UX-03).
 *
 * The placeholder shimmers (FR-ANIM-04). The content makes its entrance as it is first shown in
 * view on the page, while the widget has the class `entering` (FR-ANIM-07).
 */
@Component({
  selector: 'app-widget',
  imports: [DataTable, Icon, NgTemplateOutlet],
  templateUrl: './widget.html',
  styles: ':host { display: block; min-width: 0; }',
  providers: [Entrance],
  host: { '[class.entering]': 'entrance.playing()' },
})
export class Widget {
  readonly heading = input.required<string>();
  /** What the widget says when there is nothing to show, such as "No releases yet." */
  readonly empty = input.required<string>();
  readonly emptyIcon = input<IconName>('info');
  readonly skeleton = input<Skeleton>('chart');
  /** What the content shows, in a sentence, once it shows, if it needs saying. */
  readonly summary = input<string | undefined>(undefined);
  /** The content's data as a table, if it is a chart's. */
  readonly table = input<ChartTable | undefined>(undefined);
  /** Whether the content goes up to the widget's edges, as a list of rows does. */
  readonly flush = input(false);

  protected readonly entrance = inject(Entrance);

  protected readonly content = contentChild.required(Loaded);
  protected readonly state = computed(() => this.content().loader().state());
  protected readonly ready = computed(() => this.state().status === 'ready');
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

  /** Whether the table shows in place of the chart, until the data changes. */
  protected readonly tabled = linkedSignal({ source: this.table, computation: () => false });
  protected readonly toggle = computed(() => (this.tabled() ? SHOW_CHART : SHOW_TABLE));

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

  /** The widths of the placeholder's lines, after a list's rows or a chart's bars. */
  protected readonly rows = [72, 55, 82, 64, 48];
  protected readonly bars = [88, 71, 60, 47, 36, 28];
  protected readonly legend = [62, 44, 54, 38];

  constructor() {
    enterInView(
      inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
      this.heading,
      this.ready,
      this.entrance,
    );
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
