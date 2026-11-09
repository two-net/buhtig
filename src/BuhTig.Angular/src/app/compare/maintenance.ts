import { Component, computed, inject, input } from '@angular/core';
import {
  Dated,
  Freshness,
  IssueAge,
  MergeVelocity,
  ReleaseCadence,
  WorkflowRuns,
} from '../dashboard/resources';
import { duration, percent } from '../format/format';
import { IconName } from '../icon/icon';
import {
  mergeRatio,
  nothingMerged,
  nothingOpen,
  nothingReleased,
  nothingRun,
  passRate,
} from '../repository/metrics';
import {
  AVERAGE_DURATION,
  ISSUE_AGE,
  MEDIAN_AGE,
  MEDIAN_TIME_TO_MERGE,
  MERGE_RATIO,
  MERGE_VELOCITY,
  NO_MERGES,
  NO_OPEN_ISSUES,
  NO_PASS_RATE,
  NO_RELEASES,
  ONE_RELEASE,
  PASS_RATE,
  PER_COMPLETED_RUN,
  RELEASED_EVERY,
  RELEASE_CADENCE,
  STABLE,
  WORKFLOW_RUNS,
  andPrereleases,
  issueAgeDescription,
  mergeVelocityDescription,
  mergedAndClosed,
  noRuns,
  ofMerged,
  ofOpenIssues,
  onAverageOf,
  passedOf,
  releaseCadenceDescription,
  workflowRunsDescription,
} from '../repository/messages';
import { Load, Loader } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import {
  Card,
  CompareCards,
  CompareFresh,
  Value,
  cardsOf,
  countDelta,
  shareDelta,
  spanDelta,
} from './cards';
import { ComparisonData } from './data';
import {
  ISSUES_SAMPLED,
  MERGES_SAMPLED,
  NONE_COMPLETED,
  NONE_ENDED,
  NONE_MERGED,
  NO_MERGES_EITHER,
  NO_OPEN_ISSUES_EITHER,
  NO_OPEN_ISSUES_SHORT,
  NO_RELEASES_EITHER,
  NO_RELEASES_SHORT,
  NO_RUNS_EITHER,
  NO_RUNS_SHORT,
  RELEASES_SAMPLED,
  RUNS_HIDDEN_EITHER,
  RUNS_HIDDEN_SHORT,
  RUNS_SAMPLED,
  runsHidden,
} from './messages';

type Names = readonly [string, string];

/**
 * A section of maintenance figures of two repositories (FR-CMP-06), made from the same part of
 * each one's dashboard, the first on the left as their heads are.
 */
export interface Section<T> {
  heading: string;
  /** What its figures are of: samples of each one's latest items, not a period of time. */
  sampled: string;
  /** What it says when neither has anything to measure, and with what icon, if neither has. */
  neither(pair: [T, T]): { text: string; icon: IconName } | undefined;
  /** Its cards, each with both sides' figures, and how they differ. */
  cards(pair: [T, T], names: Names): Card[];
  /**
   * What one side's figures are of, as its dashboard says it, or why it has none, and what to
   * do about it.
   */
  note(side: T, name: string): string;
}

/** A figure of one side, with what it is of. */
function figure(text: string, sub: string): Value {
  return { kind: 'figure', text, sub };
}

/** No figure for one side, and why. */
function missing(reason: string): Value {
  return { kind: 'missing', reason };
}

/**
 * FR-CMP-06, FR-REPO-13: how the 100 pull requests updated last of each came to an end: the
 * median time to merge those merged, and the merge ratio.
 */
export const MERGE_VELOCITY_SECTION: Section<MergeVelocity> = {
  heading: MERGE_VELOCITY,
  sampled: MERGES_SAMPLED,
  neither: ([a, b]) =>
    nothingMerged(a) && nothingMerged(b) ? { text: NO_MERGES_EITHER, icon: 'merged' } : undefined,
  cards: velocityCards,
  note: (velocity) => (nothingMerged(velocity) ? NO_MERGES : mergeVelocityDescription(velocity)),
};

/** The cards of merge velocity of two repositories, named `names`. */
export function velocityCards([a, b]: [MergeVelocity, MergeVelocity], names: Names): Card[] {
  const time = (velocity: MergeVelocity): Value => {
    if (velocity.medianTimeToMerge !== undefined) {
      return figure(duration(velocity.medianTimeToMerge), ofMerged(velocity.merged));
    }
    return missing(nothingMerged(velocity) ? NONE_ENDED : NONE_MERGED);
  };
  const ratio = (velocity: MergeVelocity): Value => {
    const share = mergeRatio(velocity);
    return share === undefined
      ? missing(NONE_ENDED)
      : figure(percent(share), mergedAndClosed(velocity.merged, velocity.closed));
  };
  return [
    {
      label: MEDIAN_TIME_TO_MERGE,
      icon: 'clock',
      values: [time(a), time(b)],
      delta: spanDelta('timeToMerge', a.medianTimeToMerge, b.medianTimeToMerge, names),
    },
    {
      label: MERGE_RATIO,
      icon: 'merged',
      values: [ratio(a), ratio(b)],
      delta: shareDelta('mergeRatio', mergeRatio(a), mergeRatio(b), names),
    },
  ];
}

/**
 * FR-CMP-06, FR-REPO-13: how long the open issues among the 100 open issues and pull requests
 * updated last of each have been open.
 */
export const ISSUE_AGE_SECTION: Section<IssueAge> = {
  heading: ISSUE_AGE,
  sampled: ISSUES_SAMPLED,
  neither: ([a, b]) =>
    nothingOpen(a) && nothingOpen(b) ? { text: NO_OPEN_ISSUES_EITHER, icon: 'issue' } : undefined,
  cards: issueAgeCards,
  note: (age) => (nothingOpen(age) ? NO_OPEN_ISSUES : issueAgeDescription(age)),
};

/** The card of the open issues' age of two repositories, named `names`. */
export function issueAgeCards([a, b]: [IssueAge, IssueAge], names: Names): Card[] {
  const median = (age: IssueAge): Value =>
    age.medianAge === undefined
      ? missing(NO_OPEN_ISSUES_SHORT)
      : figure(duration(age.medianAge), ofOpenIssues(age.sampled));
  return [
    {
      label: MEDIAN_AGE,
      icon: 'clock',
      values: [median(a), median(b)],
      delta: spanDelta('issueAge', a.medianAge, b.medianAge, names),
    },
  ];
}

/**
 * FR-CMP-06, FR-REPO-14: how the 50 latest workflow runs for pushes to the default branch of
 * each fared: their pass rate, and how long they took on average. When GitHub will not list one's
 * runs to the viewer's token, it says what the token needs.
 */
export const WORKFLOW_RUNS_SECTION: Section<WorkflowRuns> = {
  heading: WORKFLOW_RUNS,
  sampled: RUNS_SAMPLED,
  neither: ([a, b]) => {
    // Without runs to tell of on either side for the same reason, there is one thing to say.
    if (!nothingRun(a) || !nothingRun(b) || a.hidden !== b.hidden) {
      return undefined;
    }
    return a.hidden
      ? { text: RUNS_HIDDEN_EITHER, icon: 'lock' }
      : { text: NO_RUNS_EITHER, icon: 'pulse' };
  },
  cards: workflowCards,
  note: (runs, name) =>
    runs.hidden
      ? runsHidden(name)
      : runs.sampled === 0
        ? noRuns(runs.branch)
        : workflowRunsDescription(runs),
};

/** The cards of the workflow runs of two repositories, named `names`. */
export function workflowCards([a, b]: [WorkflowRuns, WorkflowRuns], names: Names): Card[] {
  /** Why there are no runs to tell of, if there are none. */
  const unseen = (runs: WorkflowRuns): string | undefined =>
    runs.hidden ? RUNS_HIDDEN_SHORT : runs.sampled === 0 ? NO_RUNS_SHORT : undefined;
  const rate = (runs: WorkflowRuns): Value => {
    const share = passRate(runs);
    const why = unseen(runs) ?? NO_PASS_RATE;
    return share === undefined
      ? missing(why)
      : figure(percent(share), passedOf(runs.passed, runs.failed));
  };
  const average = (runs: WorkflowRuns): Value => {
    const why = unseen(runs) ?? NONE_COMPLETED;
    return runs.averageDuration === undefined
      ? missing(why)
      : figure(duration(runs.averageDuration), PER_COMPLETED_RUN);
  };
  return [
    {
      label: PASS_RATE,
      icon: 'check',
      values: [rate(a), rate(b)],
      delta: shareDelta('passRate', passRate(a), passRate(b), names),
    },
    {
      label: AVERAGE_DURATION,
      icon: 'clock',
      values: [average(a), average(b)],
      delta: spanDelta('runDuration', a.averageDuration, b.averageDuration, names),
    },
  ];
}

/**
 * FR-CMP-06, FR-REPO-16: how often each was released over its 100 latest releases, and how many
 * of them are stable.
 */
export const RELEASE_CADENCE_SECTION: Section<ReleaseCadence> = {
  heading: RELEASE_CADENCE,
  sampled: RELEASES_SAMPLED,
  neither: ([a, b]) =>
    nothingReleased(a) && nothingReleased(b)
      ? { text: NO_RELEASES_EITHER, icon: 'tag' }
      : undefined,
  cards: cadenceCards,
  note: (cadence) => (nothingReleased(cadence) ? NO_RELEASES : releaseCadenceDescription(cadence)),
};

/** The cards of the release cadence of two repositories, named `names`. */
export function cadenceCards([a, b]: [ReleaseCadence, ReleaseCadence], names: Names): Card[] {
  const every = (cadence: ReleaseCadence): Value => {
    if (nothingReleased(cadence)) {
      return missing(NO_RELEASES_SHORT);
    }
    return cadence.averageInterval === undefined
      ? missing(ONE_RELEASE)
      : figure(duration(cadence.averageInterval), onAverageOf(cadence));
  };
  const stable = (cadence: ReleaseCadence): Value =>
    nothingReleased(cadence)
      ? missing(NO_RELEASES_SHORT)
      : { kind: 'count', value: cadence.stable, sub: andPrereleases(cadence.prereleases) };
  const released = !nothingReleased(a) && !nothingReleased(b);
  return [
    {
      label: RELEASED_EVERY,
      icon: 'calendar',
      values: [every(a), every(b)],
      delta: spanDelta('releaseInterval', a.averageInterval, b.averageInterval, names),
    },
    {
      label: STABLE,
      icon: 'tag',
      values: [stable(a), stable(b)],
      delta: released ? countDelta('stableReleases', a.stable, b.stable, names) : undefined,
    },
  ];
}

/**
 * A section of maintenance figures of two repositories (FR-CMP-06): its cards, each with both
 * sides' figures and how they differ, with units and in words that rank neither (NFR-UX-05).
 * Above them, what the figures are of, samples of each one's latest items; below them, what each
 * side's are of, as its dashboard says it, with the branch they are of, and when they were
 * fetched, or that they are saved data (FR-DATA-05, FR-DATA-06). A side without a figure says
 * why, rather than show a zero. When neither has anything to measure, it says so. When either
 * side fails, this section alone says so, and trying again asks again for what failed.
 */
@Component({
  selector: 'app-compare-measures',
  imports: [CompareCards, CompareFresh, Loaded, Widget],
  template: `
    <app-widget
      [heading]="section().heading"
      [empty]="neither()?.text ?? ''"
      [emptyIcon]="neither()?.icon ?? 'info'"
      skeleton="figures"
      [flush]="true"
      [summary]="section().sampled"
    >
      <ng-template [appLoaded]="cards" let-cards>
        <app-compare-cards [cards]="cards" [names]="names()" [measures]="true" />
      </ng-template>
      <div class="Box-footer cmp-notes" footer>
        @for (note of notes(); track $index) {
          <p class="cmp-note">
            <span class="cmp-note-name">{{ names()[$index] }}</span>
            {{ note.text }}
            <app-compare-fresh [freshness]="note.freshness" />
          </p>
        }
      </div>
    </app-widget>
  `,
  styles: ':host { display: block; min-width: 0; }',
})
export class CompareMeasures<T> {
  private readonly data = inject(ComparisonData);

  /** Both sides' part, from which the section is made, with when each was fetched. */
  readonly loader = input.required<Loader<[Dated<T>, Dated<T>]>>();
  readonly section = input.required<Section<T>>();

  protected readonly names = this.data.names;

  /** Both sides' part, once loaded, if it is. */
  private readonly loaded = computed(() => {
    const state = this.loader().state();
    return state.status === 'ready' ? state.data : undefined;
  });

  /** What to say when neither has anything to measure, if neither has. */
  protected readonly neither = computed(() => {
    const pair = this.loaded();
    return pair && this.section().neither(pair);
  });

  /** Both sides' part, empty when neither has anything to measure. */
  private readonly measured: Loader<[Dated<T>, Dated<T>]> = {
    state: computed((): Load<[Dated<T>, Dated<T>]> =>
      this.neither() ? { status: 'empty' } : this.loader().state(),
    ),
    retry: () => this.loader().retry(),
  };

  protected readonly cards = cardsOf(this.measured, (pair) =>
    this.section().cards(pair, this.names()),
  );

  /** What each side's figures are of, and when they were fetched. */
  protected readonly notes = computed(() => {
    const pair = this.loaded();
    const names = this.names();
    return (pair ?? []).map((side, index) => ({
      text: this.section().note(side, names[index]),
      freshness: { fetchedAt: side.fetchedAt, stale: side.stale } satisfies Freshness,
    }));
  });
}

/** FR-CMP-06: the merge velocity of two repositories. */
@Component({
  selector: 'app-compare-merge-velocity',
  imports: [CompareMeasures],
  template: `<app-compare-measures [loader]="loader" [section]="section" />`,
})
export class CompareMergeVelocity {
  protected readonly loader = inject(ComparisonData).mergeVelocity();
  protected readonly section = MERGE_VELOCITY_SECTION;
}

/** FR-CMP-06: the open issues' age of two repositories. */
@Component({
  selector: 'app-compare-issue-age',
  imports: [CompareMeasures],
  template: `<app-compare-measures [loader]="loader" [section]="section" />`,
})
export class CompareIssueAge {
  protected readonly loader = inject(ComparisonData).issueAge();
  protected readonly section = ISSUE_AGE_SECTION;
}

/** FR-CMP-06: the workflow runs of two repositories. */
@Component({
  selector: 'app-compare-workflow-runs',
  imports: [CompareMeasures],
  template: `<app-compare-measures [loader]="loader" [section]="section" />`,
})
export class CompareWorkflowRuns {
  protected readonly loader = inject(ComparisonData).workflowRuns();
  protected readonly section = WORKFLOW_RUNS_SECTION;
}

/** FR-CMP-06: the release cadence of two repositories. */
@Component({
  selector: 'app-compare-release-cadence',
  imports: [CompareMeasures],
  template: `<app-compare-measures [loader]="loader" [section]="section" />`,
})
export class CompareReleaseCadence {
  protected readonly loader = inject(ComparisonData).releaseCadence();
  protected readonly section = RELEASE_CADENCE_SECTION;
}
