import { Component, computed, inject } from '@angular/core';
import { RepositoryData } from '../dashboard/data';
import { WorkflowRun, WorkflowRuns } from '../dashboard/resources';
import { duration, percent } from '../format/format';
import { RelativeTime } from '../format/relative-time';
import { Icon, IconName } from '../icon/icon';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import {
  AVERAGE_DURATION,
  LATEST_RUN,
  NO_FIGURE,
  NO_PASS_RATE,
  PASS_RATE,
  PER_COMPLETED_RUN,
  RUNS_HIDDEN,
  RUN_STATES,
  WORKFLOW_RUNS,
  noRuns,
  passedOf,
  workflowRunsDescription,
} from './messages';

/** How the badge of a workflow run's state shows it: in words, with an icon, in a tone. */
export interface RunBadge {
  label: string;
  icon: IconName;
  /** The label's tone, such as `success`, or none. */
  tone: string;
}

/**
 * How a repository's latest GitHub Actions workflow runs for pushes to its default branch fared,
 * on its Activity tab (FR-REPO-14): the pass rate of those that passed or failed, the latest run's
 * state as a badge, with its workflow, linking to the run on GitHub (FR-REPO-12), and when it
 * started, and how long completed runs took on average. The badge says the state in words, with
 * an icon, besides its color (NFR-UX-05).
 *
 * Without runs, it says so. When GitHub will not list them to the viewer's personal access
 * token, it says what to give the token (NFR-UX-06).
 */
@Component({
  selector: 'app-repository-workflows',
  imports: [Icon, Loaded, RelativeTime, Widget],
  template: `
    <app-widget
      [heading]="WORKFLOW_RUNS"
      [empty]="empty()"
      [emptyIcon]="hidden() ? 'lock' : 'pulse'"
      skeleton="figures"
      [flush]="true"
      [summary]="summary()"
    >
      <ng-template [appLoaded]="runs" let-runs>
        <dl class="stats few" [style.--n]="3">
          <div class="stat">
            <dt><app-icon name="check" />{{ PASS_RATE }}</dt>
            @if (runs.passed + runs.failed > 0) {
              <dd class="val">{{ rate(runs) }}</dd>
              <dd class="sub">{{ passedOf(runs.passed, runs.failed) }}</dd>
            } @else {
              <dd class="val">{{ NO_FIGURE }}</dd>
              <dd class="sub">{{ NO_PASS_RATE }}</dd>
            }
          </div>
          <div class="stat">
            <dt><app-icon name="pulse" />{{ LATEST_RUN }}</dt>
            @if (runs.latest; as latest) {
              @let badge = badgeOf(latest);
              <dd class="val">
                <span class="label run" [class]="badge.tone"
                  ><app-icon [name]="badge.icon" />{{ badge.label }}</span
                >
              </dd>
              <dd class="sub">
                @if (latest.url; as url) {
                  <a [href]="url">{{ latest.name ?? LATEST_RUN }}</a>
                } @else if (latest.name) {
                  {{ latest.name }}
                }
                @if (latest.startedAt; as startedAt) {
                  · <app-relative-time [value]="startedAt" />
                }
              </dd>
            }
          </div>
          <div class="stat">
            <dt><app-icon name="clock" />{{ AVERAGE_DURATION }}</dt>
            <dd class="val">{{ average(runs) }}</dd>
            <dd class="sub">{{ PER_COMPLETED_RUN }}</dd>
          </div>
        </dl>
      </ng-template>
    </app-widget>
  `,
})
export class RepositoryWorkflows {
  private readonly data = inject(RepositoryData);
  private readonly loader = this.data.workflowRuns();

  protected readonly runs = emptyWhen(this.loader, (runs) => runs.hidden || runs.sampled === 0);

  /** What the loader has, before it is found empty, for what the widget says of nothing. */
  private readonly loaded = computed(() => {
    const state = this.loader.state();
    return state.status === 'ready' ? state.data : undefined;
  });

  protected readonly hidden = computed(() => this.loaded()?.hidden === true);

  protected readonly empty = computed(() =>
    this.hidden() ? RUNS_HIDDEN : noRuns(this.loaded()?.branch),
  );

  protected readonly summary = computed(() => {
    const state = this.runs.state();
    return state.status === 'ready' ? workflowRunsDescription(state.data) : '';
  });

  protected rate({ passed, failed }: WorkflowRuns): string {
    return percent(passed / (passed + failed));
  }

  protected average({ averageDuration }: WorkflowRuns): string {
    return averageDuration === undefined ? NO_FIGURE : duration(averageDuration);
  }

  protected readonly badgeOf = runBadge;
  protected readonly passedOf = passedOf;
  protected readonly WORKFLOW_RUNS = WORKFLOW_RUNS;
  protected readonly PASS_RATE = PASS_RATE;
  protected readonly LATEST_RUN = LATEST_RUN;
  protected readonly AVERAGE_DURATION = AVERAGE_DURATION;
  protected readonly NO_FIGURE = NO_FIGURE;
  protected readonly NO_PASS_RATE = NO_PASS_RATE;
  protected readonly PER_COMPLETED_RUN = PER_COMPLETED_RUN;
}

/** The badge of a workflow run's state, as GitHub tells its status and its conclusion. */
export function runBadge({ status, conclusion }: WorkflowRun): RunBadge {
  switch (status) {
    case 'in_progress':
      return { label: RUN_STATES.running, icon: 'clock', tone: 'attention' };
    case 'queued':
    case 'waiting':
    case 'requested':
    case 'pending':
      return { label: RUN_STATES.queued, icon: 'clock', tone: '' };
    case 'completed':
      break;
    default:
      return { label: RUN_STATES.unknown, icon: 'question', tone: '' };
  }
  switch (conclusion) {
    case 'success':
      return { label: RUN_STATES.passing, icon: 'check', tone: 'success' };
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return { label: RUN_STATES.failing, icon: 'x', tone: 'danger' };
    case 'cancelled':
      return { label: RUN_STATES.cancelled, icon: 'alert', tone: '' };
    case 'action_required':
      return { label: RUN_STATES.waiting, icon: 'alert', tone: 'attention' };
    case 'skipped':
      return { label: RUN_STATES.skipped, icon: 'info', tone: '' };
    case 'neutral':
      return { label: RUN_STATES.neutral, icon: 'info', tone: '' };
    case 'stale':
      return { label: RUN_STATES.stale, icon: 'info', tone: '' };
    default:
      return { label: RUN_STATES.unknown, icon: 'question', tone: '' };
  }
}
