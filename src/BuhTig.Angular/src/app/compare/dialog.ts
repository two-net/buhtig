import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { same } from '../dashboard/summary';
import { Dialog } from '../dialog/dialog';
import { Icon } from '../icon/icon';
import { problemMessage, resourceName } from '../search/messages';
import { Known, parse } from '../search/parse';
import {
  ANOTHER_KIND,
  CANCEL,
  COMPARE,
  COMPARE_LABELS,
  COMPARE_PLACEHOLDERS,
  compareHeading,
  sameResource,
} from './messages';
import { Compared, comparePath } from './route';

let count = 0;

/**
 * Asks what to compare a dashboard's resource with, and opens the comparison (FR-CMP-02): a
 * repository with another repository, in any form of SRS Table 4-1, and an organization or a
 * user with another organization or user. What is no such resource, is of another kind, or is
 * the resource itself, it says so of beside the input, and opens nothing (NFR-UX-06).
 */
@Component({
  selector: 'app-compare-dialog',
  imports: [Dialog, Icon],
  template: `
    <app-dialog [heading]="heading()" (closed)="closed.emit()">
      <form [id]="id" class="cmp-form" novalidate (submit)="submit($event)">
        <label [for]="id + '-input'">{{ COMPARE_LABELS[kind()] }}</label>
        <input
          #input
          [id]="id + '-input'"
          class="input"
          type="text"
          name="compare"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          [placeholder]="COMPARE_PLACEHOLDERS[kind()]"
          [value]="draft()"
          [attr.aria-invalid]="problem() ? 'true' : null"
          [attr.aria-describedby]="problem() ? id + '-problem' : null"
          (input)="draft.set(input.value); problem.set('')"
        />
        @if (problem(); as problem) {
          <p [id]="id + '-problem'" class="field-msg err" role="alert">
            <app-icon name="alert" />{{ problem }}
          </p>
        }
      </form>
      <button actions type="button" class="btn" (click)="closed.emit()">{{ CANCEL }}</button>
      <button actions type="submit" class="btn primary" [attr.form]="id">{{ COMPARE }}</button>
    </app-dialog>
  `,
})
export class CompareDialog {
  private readonly router = inject(Router);

  /** The dashboard's resource, which the other is compared with. */
  readonly from = input.required<Known>();
  /** Asked for when the user closes the dialog without comparing. */
  readonly closed = output();

  protected readonly id = `compare-${count++}`;
  /** What the user has typed. */
  protected readonly draft = signal('');
  /** Why what the user typed opens no comparison, once they have tried. */
  protected readonly problem = signal('');

  /** What the resource compares with: a repository with repositories, an account with accounts. */
  protected readonly kind = computed((): Compared =>
    this.from().kind === 'repository' ? 'repository' : 'account',
  );
  protected readonly heading = computed(() => compareHeading(resourceName(this.from())));

  protected submit(event: Event): void {
    event.preventDefault();
    const parsed = parse(this.draft());
    if (!parsed.ok) {
      this.problem.set(problemMessage(parsed.problem));
      return;
    }
    const other = parsed.resource;
    if ((other.kind === 'repository' ? 'repository' : 'account') !== this.kind()) {
      this.problem.set(ANOTHER_KIND[this.kind()]);
      return;
    }
    if (same(this.from(), other)) {
      this.problem.set(sameResource(resourceName(this.from())));
      return;
    }
    void this.router.navigateByUrl(comparePath(this.from(), other));
  }

  protected readonly CANCEL = CANCEL;
  protected readonly COMPARE = COMPARE;
  protected readonly COMPARE_LABELS = COMPARE_LABELS;
  protected readonly COMPARE_PLACEHOLDERS = COMPARE_PLACEHOLDERS;
}
