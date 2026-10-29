import { Component, computed, inject, input } from '@angular/core';
import { LastPush, Resources } from '../dashboard/resources';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { OrganizationBars } from './bars';
import { LAST_PUSH, LAST_PUSH_HEADERS, lastPushDescription, repositoriesLabel } from './messages';

/** The periods of the chart, the most recent first. */
const PERIODS: (keyof LastPush)[] = ['last7Days', 'last30Days', 'last12Months', 'older'];

/**
 * How many of an organization's repositories were last pushed to in each period (FR-ORG-06):
 * the last 7 days, the last 30 days, the last 12 months, and before. Each repository counts in
 * one period alone, the most recent it was pushed to within.
 */
@Component({
  selector: 'app-organization-last-push',
  imports: [Loaded, OrganizationBars, Widget],
  templateUrl: './last-push.html',
  styleUrl: './last-push.css',
})
export class OrganizationLastPush {
  private readonly resources = inject(Resources);

  /** The organization's login, as the URL has it. */
  readonly org = input.required<string>();

  protected readonly pushes = load(
    () => this.resources.lastPush(this.org()),
    (pushes) => PERIODS.every((period) => pushes[period] === 0),
  );

  protected readonly bars = computed(() => {
    const state = this.pushes.state();
    return state.status === 'ready'
      ? PERIODS.map((period) => ({ label: LAST_PUSH[period], value: state.data[period] }))
      : [];
  });

  protected readonly summary = computed(() => {
    const state = this.pushes.state();
    return state.status === 'ready' ? lastPushDescription(state.data) : '';
  });

  protected readonly unit = repositoriesLabel;
  protected readonly headers = LAST_PUSH_HEADERS;
}
