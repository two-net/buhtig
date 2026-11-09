import { Component, computed, input, output } from '@angular/core';
import { exactNumber } from '../format/format';
import { Icon } from '../icon/icon';

/**
 * The pages that the pager offers, from 0, around the page at `index` of `count`: the first and
 * the last, and those next to it, with `gap` where pages are left out between.
 */
export function pagesAround(index: number, count: number): (number | 'gap')[] {
  const pages: (number | 'gap')[] = [];
  for (let page = 0; page < count; page++) {
    if (page === 0 || page === count - 1 || Math.abs(page - index) <= 1) {
      pages.push(page);
    } else if (pages[pages.length - 1] !== 'gap') {
      pages.push('gap');
    }
  }
  return pages;
}

/**
 * The pages of a list, as a repository list (FR-ORG-03) and an issue list (FR-REPO-06) offer them,
 * when there is more than one: Previous and Next, and the first page, the last, and those next to
 * the page shown, which is marked as current, with gaps for the eye alone between. Choosing one
 * says which, from 0, for the list to show it.
 */
@Component({
  selector: 'app-pager',
  imports: [Icon],
  template: `
    @if (count() > 1) {
      <nav class="pager" aria-label="Pages">
        <button type="button" [disabled]="index() === 0" (click)="go.emit(index() - 1)">
          <app-icon name="chevl" />Previous
        </button>
        @for (item of pages(); track $index) {
          @if (item === 'gap') {
            <span class="gap" aria-hidden="true">…</span>
          } @else {
            <button
              type="button"
              [attr.aria-current]="item === index() ? 'page' : null"
              [attr.aria-label]="'Page ' + page1(item)"
              (click)="go.emit(item)"
            >
              {{ page1(item) }}
            </button>
          }
        }
        <button type="button" [disabled]="index() >= count() - 1" (click)="go.emit(index() + 1)">
          Next<app-icon name="chevr" />
        </button>
      </nav>
    }
  `,
  styles: ':host { display: block; }',
})
export class Pager {
  /** The page shown, from 0. */
  readonly index = input.required<number>();
  /** How many pages there are. */
  readonly count = input.required<number>();
  /** The page chosen, from 0. */
  readonly go = output<number>();

  protected readonly pages = computed(() => pagesAround(this.index(), this.count()));
  protected readonly page1 = (index: number) => exactNumber(index + 1);
}
