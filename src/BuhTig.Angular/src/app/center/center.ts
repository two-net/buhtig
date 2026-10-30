import { Component, ViewEncapsulation, input } from '@angular/core';
import { Icon, IconName } from '../icon/icon';

/**
 * A page of one message in the middle, such as "Not found or private": an icon, a heading, what
 * happened, and below, rows of what the user can do, each marked `row`.
 */
@Component({
  selector: 'app-center',
  imports: [Icon],
  template: `
    <div class="center">
      <div class="big-icon"><app-icon [name]="icon()" /></div>
      <h1 tabindex="-1">{{ heading() }}</h1>
      <p>{{ text() }}</p>
      <ng-content />
    </div>
  `,
  styleUrl: './center.css',
  // For what the page puts in it, such as its rows of links, too.
  encapsulation: ViewEncapsulation.None,
})
export class Center {
  readonly icon = input.required<IconName>();
  readonly heading = input.required<string>();
  readonly text = input.required<string>();
}
