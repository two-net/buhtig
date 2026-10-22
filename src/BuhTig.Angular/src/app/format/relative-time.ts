import { Component, computed, inject, input } from '@angular/core';
import { Clock } from './clock';
import { Exact } from './exact';
import { exactTime, relativeTime } from './format';

/**
 * A time relative to now, such as "3 days ago", kept up to date as time passes, with the exact
 * time on hover and focus (UI-06).
 */
@Component({
  selector: 'app-relative-time',
  imports: [Exact],
  templateUrl: './relative-time.html',
})
export class RelativeTime {
  private readonly clock = inject(Clock);

  readonly value = input.required<Date>();

  protected readonly iso = computed(() => this.value().toISOString());
  protected readonly relative = computed(() => relativeTime(this.value(), this.clock.now()));
  protected readonly exact = computed(() => exactTime(this.value()));
}
