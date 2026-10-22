import { Component, computed, input } from '@angular/core';
import { Exact } from './exact';
import { compactNumber, exactNumber } from './format';

/**
 * A number in short, such as "12.3K", with the exact number on hover and focus (UI-06). A
 * number that is short already, such as "42", is shown as it is, and takes no focus.
 */
@Component({
  selector: 'app-compact-number',
  imports: [Exact],
  templateUrl: './compact-number.html',
})
export class CompactNumber {
  readonly value = input.required<number>();

  protected readonly compact = computed(() => compactNumber(this.value()));
  protected readonly exact = computed(() => exactNumber(this.value()));
}
