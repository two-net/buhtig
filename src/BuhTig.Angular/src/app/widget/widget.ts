import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChild,
  inject,
  input,
} from '@angular/core';
import { Loader } from './load';
import { FAILED, LOADING } from './messages';

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
 * again" when loading failed (FR-REPO-09).
 */
@Component({
  selector: 'app-widget',
  imports: [NgTemplateOutlet],
  templateUrl: './widget.html',
  styleUrl: './widget.css',
  host: { '[class.wide]': 'wide()' },
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

  protected readonly content = contentChild.required(Loaded);
  protected readonly state = computed(() => this.content().loader().state());
  protected readonly data = computed(() => {
    const state = this.state();
    return state.status === 'ready' ? state.data : undefined;
  });
  protected readonly id = `widget-${count++}`;
  protected readonly loading = LOADING;
  protected readonly failed = FAILED;

  protected retry(): void {
    this.content().loader().retry();
  }
}
