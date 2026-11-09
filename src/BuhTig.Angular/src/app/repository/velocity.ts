import { Component, computed, inject } from '@angular/core';
import { RepositoryData } from '../dashboard/data';
import { IssueAge, MergeVelocity } from '../dashboard/resources';
import { duration, percent } from '../format/format';
import { Icon } from '../icon/icon';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { mergeRatio, nothingMerged, nothingOpen } from './metrics';
import {
  ISSUE_AGE,
  ISSUE_AGE_SAMPLE,
  MEDIAN_AGE,
  MEDIAN_TIME_TO_MERGE,
  MERGE_RATIO,
  MERGE_VELOCITY,
  MERGE_VELOCITY_SAMPLE,
  NO_FIGURE,
  NO_MERGES,
  NO_OPEN_ISSUES,
  issueAgeDescription,
  mergeVelocityDescription,
  mergedAndClosed,
  ofMerged,
  ofOpenIssues,
} from './messages';

/**
 * How a repository's pull requests updated last came to an end, on its Pull requests tab
 * (FR-REPO-13): the median time from opening to merging of those merged, and the merge ratio,
 * the share of those that ended that were merged. Its sentence says how many pull requests the
 * figures are of, and a note below that they are not of the list below them, whose filters do
 * not change them. Without any merged or closed, there is nothing to measure.
 */
@Component({
  selector: 'app-repository-merge-velocity',
  imports: [Icon, Loaded, Widget],
  template: `
    <app-widget
      [heading]="MERGE_VELOCITY"
      [empty]="NO_MERGES"
      emptyIcon="merged"
      skeleton="figures"
      [flush]="true"
      [summary]="summary()"
    >
      <ng-template [appLoaded]="velocity" let-velocity>
        <dl class="stats few" [style.--n]="2">
          <div class="stat">
            <dt><app-icon name="clock" />{{ MEDIAN_TIME_TO_MERGE }}</dt>
            <dd class="val">{{ time(velocity) }}</dd>
            <dd class="sub">{{ ofMerged(velocity.merged) }}</dd>
          </div>
          <div class="stat">
            <dt><app-icon name="merged" />{{ MERGE_RATIO }}</dt>
            <dd class="val">{{ ratio(velocity) }}</dd>
            <dd class="sub">{{ mergedAndClosed(velocity.merged, velocity.closed) }}</dd>
          </div>
        </dl>
      </ng-template>
      <div class="Box-footer sample" footer>{{ MERGE_VELOCITY_SAMPLE }}</div>
    </app-widget>
  `,
})
export class RepositoryMergeVelocity {
  private readonly data = inject(RepositoryData);

  protected readonly velocity = emptyWhen(this.data.mergeVelocity(), nothingMerged);

  protected readonly summary = computed(() => {
    const state = this.velocity.state();
    return state.status === 'ready' ? mergeVelocityDescription(state.data) : '';
  });

  protected time({ medianTimeToMerge }: MergeVelocity): string {
    return medianTimeToMerge === undefined ? NO_FIGURE : duration(medianTimeToMerge);
  }

  protected ratio(velocity: MergeVelocity): string {
    const ratio = mergeRatio(velocity);
    return ratio === undefined ? NO_FIGURE : percent(ratio);
  }

  protected readonly ofMerged = ofMerged;
  protected readonly mergedAndClosed = mergedAndClosed;
  protected readonly MERGE_VELOCITY = MERGE_VELOCITY;
  protected readonly MEDIAN_TIME_TO_MERGE = MEDIAN_TIME_TO_MERGE;
  protected readonly MERGE_RATIO = MERGE_RATIO;
  protected readonly NO_MERGES = NO_MERGES;
  protected readonly MERGE_VELOCITY_SAMPLE = MERGE_VELOCITY_SAMPLE;
}

/**
 * How long a repository's open issues updated last have been open, on its Issues tab
 * (FR-REPO-13): their median age, with a sentence that says how many issues it is of, and a note
 * below that it is not of the list below it, whose filters do not change it.
 */
@Component({
  selector: 'app-repository-issue-age',
  imports: [Icon, Loaded, Widget],
  template: `
    <app-widget
      [heading]="ISSUE_AGE"
      [empty]="NO_OPEN_ISSUES"
      emptyIcon="issue"
      skeleton="figures"
      [flush]="true"
      [summary]="summary()"
    >
      <ng-template [appLoaded]="age" let-age>
        <dl class="stats few" [style.--n]="1">
          <div class="stat">
            <dt><app-icon name="clock" />{{ MEDIAN_AGE }}</dt>
            <dd class="val">{{ median(age) }}</dd>
            <dd class="sub">{{ ofOpenIssues(age.sampled) }}</dd>
          </div>
        </dl>
      </ng-template>
      <div class="Box-footer sample" footer>{{ ISSUE_AGE_SAMPLE }}</div>
    </app-widget>
  `,
})
export class RepositoryIssueAge {
  private readonly data = inject(RepositoryData);

  protected readonly age = emptyWhen(this.data.issueAge(), nothingOpen);

  protected readonly summary = computed(() => {
    const state = this.age.state();
    return state.status === 'ready' ? issueAgeDescription(state.data) : '';
  });

  protected median({ medianAge }: IssueAge): string {
    return medianAge === undefined ? NO_FIGURE : duration(medianAge);
  }

  protected readonly ofOpenIssues = ofOpenIssues;
  protected readonly ISSUE_AGE = ISSUE_AGE;
  protected readonly MEDIAN_AGE = MEDIAN_AGE;
  protected readonly NO_OPEN_ISSUES = NO_OPEN_ISSUES;
  protected readonly ISSUE_AGE_SAMPLE = ISSUE_AGE_SAMPLE;
}
