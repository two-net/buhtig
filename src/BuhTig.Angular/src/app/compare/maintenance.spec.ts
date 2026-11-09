import { IssueAge, MergeVelocity, ReleaseCadence, WorkflowRuns } from '../dashboard/resources';
import { duration, percent, percentagePoints, signedCompactNumber } from '../format/format';
import {
  NO_MERGES,
  NO_PASS_RATE,
  ONE_RELEASE,
  andPrereleases,
  mergeVelocityDescription,
  mergedAndClosed,
  noRuns,
  ofMerged,
  ofOpenIssues,
} from '../repository/messages';
import { shareDelta, spanDelta } from './cards';
import {
  ISSUE_AGE_SECTION,
  MERGE_VELOCITY_SECTION,
  RELEASE_CADENCE_SECTION,
  WORKFLOW_RUNS_SECTION,
  cadenceCards,
  issueAgeCards,
  velocityCards,
  workflowCards,
} from './maintenance';
import {
  NONE_COMPLETED,
  NONE_ENDED,
  NONE_MERGED,
  NO_OPEN_ISSUES_SHORT,
  NO_RELEASES_EITHER,
  NO_RELEASES_SHORT,
  NO_RUNS_EITHER,
  NO_RUNS_SHORT,
  RUNS_HIDDEN_EITHER,
  RUNS_HIDDEN_SHORT,
  higherThan,
  longer,
  longerThan,
  moreThan,
  pointsHigher,
  runsHidden,
  sameMeasure,
} from './messages';

const NAMES = ['acme/widget', 'umbrella/gadget'] as const;
const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const VELOCITY: MergeVelocity = {
  sampled: 100,
  merged: 61,
  closed: 9,
  medianTimeToMerge: 2 * DAY,
  truncated: true,
};
const RUNS: WorkflowRuns = {
  branch: 'main',
  sampled: 50,
  passed: 45,
  failed: 3,
  averageDuration: 252,
  latest: undefined,
  hidden: false,
};
const NO_RUNS: WorkflowRuns = {
  ...RUNS,
  sampled: 0,
  passed: 0,
  failed: 0,
  averageDuration: undefined,
};
const CADENCE: ReleaseCadence = {
  sampled: 12,
  stable: 10,
  prereleases: 2,
  averageInterval: 12 * DAY,
  assets: 0,
  downloads: 0,
  truncated: false,
};
const NO_RELEASES: ReleaseCadence = {
  sampled: 0,
  stable: 0,
  prereleases: 0,
  averageInterval: undefined,
  assets: 0,
  downloads: 0,
  truncated: false,
};

describe('maintenance comparison (FR-CMP-06)', () => {
  describe('differences', () => {
    it('marks the longer span by how much longer, with its unit, and says so', () => {
      expect(spanDelta('timeToMerge', 2 * DAY, 3 * HOUR, NAMES)).toEqual({
        ahead: 0,
        wide: true,
        shown: longer(duration(2 * DAY - 3 * HOUR)),
        said: longerThan(
          'timeToMerge',
          'acme/widget',
          duration(2 * DAY - 3 * HOUR),
          'umbrella/gadget',
        ),
      });
      expect(spanDelta('issueAge', HOUR, DAY, NAMES)).toMatchObject({ ahead: 1 });
    });

    it('takes spans that show the same for the same, rather than tell a difference not shown', () => {
      expect(duration(HOUR)).toBe(duration(HOUR + 1));
      expect(spanDelta('runDuration', HOUR, HOUR + 1, NAMES)).toEqual({
        ahead: 'same',
        said: sameMeasure('runDuration', 'acme/widget', 'umbrella/gadget'),
      });
    });

    it('marks the higher share by how many percentage points, of the shares shown', () => {
      const points = percentagePoints(0.625, 0.5);
      expect(shareDelta('passRate', 0.5, 0.625, NAMES)).toEqual({
        ahead: 1,
        wide: true,
        shown: pointsHigher(points),
        said: higherThan('passRate', 'umbrella/gadget', points, 'acme/widget'),
      });
      expect(shareDelta('mergeRatio', 0.5, 0.5004, NAMES)).toMatchObject({ ahead: 'same' });
      // No share is no share of 0.
      expect(shareDelta('mergeRatio', 0, 0, NAMES)).toMatchObject({ ahead: 'same' });
    });

    it('tells no difference unless both have a figure', () => {
      expect(spanDelta('issueAge', undefined, DAY, NAMES)).toBeUndefined();
      expect(shareDelta('passRate', 0.5, undefined, NAMES)).toBeUndefined();
    });
  });

  describe('merge velocity', () => {
    it('shows the median time to merge and the merge ratio of both, with what each is of', () => {
      const other = { ...VELOCITY, sampled: 6, merged: 4, closed: 1, medianTimeToMerge: 3 * HOUR };
      const [time, ratio] = velocityCards([VELOCITY, other], NAMES);
      expect(time.values).toEqual([
        { kind: 'figure', text: duration(2 * DAY), sub: ofMerged(61) },
        { kind: 'figure', text: duration(3 * HOUR), sub: ofMerged(4) },
      ]);
      expect(ratio.values).toEqual([
        { kind: 'figure', text: percent(61 / 70), sub: mergedAndClosed(61, 9) },
        { kind: 'figure', text: percent(4 / 5), sub: mergedAndClosed(4, 1) },
      ]);
      expect(ratio.delta).toMatchObject({ ahead: 0 });
    });

    it('takes a ratio of none merged for a figure, and none ended for none', () => {
      const unmerged = { ...VELOCITY, merged: 0, closed: 3, medianTimeToMerge: undefined };
      const open = { ...VELOCITY, merged: 0, closed: 0, medianTimeToMerge: undefined };
      const [time, ratio] = velocityCards([unmerged, open], NAMES);
      expect(time.values).toEqual([
        { kind: 'missing', reason: NONE_MERGED },
        { kind: 'missing', reason: NONE_ENDED },
      ]);
      expect(ratio.values).toEqual([
        { kind: 'figure', text: percent(0), sub: mergedAndClosed(0, 3) },
        { kind: 'missing', reason: NONE_ENDED },
      ]);
      expect([time.delta, ratio.delta]).toEqual([undefined, undefined]);
      // The real 0% against another's real figure is a difference.
      const [, real] = velocityCards([unmerged, VELOCITY], NAMES);
      expect(real.delta).toMatchObject({
        ahead: 1,
        shown: pointsHigher(percentagePoints(0, 61 / 70)),
      });
    });

    it("says each one's sample as its dashboard does, or that it has nothing to measure", () => {
      const open = { ...VELOCITY, merged: 0, closed: 0, medianTimeToMerge: undefined };
      expect(MERGE_VELOCITY_SECTION.note(VELOCITY, 'acme/widget')).toBe(
        mergeVelocityDescription(VELOCITY),
      );
      expect(MERGE_VELOCITY_SECTION.note(open, 'acme/widget')).toBe(NO_MERGES);
      expect(MERGE_VELOCITY_SECTION.neither([open, VELOCITY])).toBeUndefined();
      expect(MERGE_VELOCITY_SECTION.neither([open, open])?.icon).toBe('merged');
    });
  });

  describe('open issue age', () => {
    it('shows the median age of both, or why one has none', () => {
      const age: IssueAge = { sampled: 37, medianAge: 60 * DAY, truncated: true };
      const none: IssueAge = { sampled: 0, medianAge: undefined, truncated: false };
      const [card] = issueAgeCards([age, none], NAMES);
      expect(card.values).toEqual([
        { kind: 'figure', text: duration(60 * DAY), sub: ofOpenIssues(37) },
        { kind: 'missing', reason: NO_OPEN_ISSUES_SHORT },
      ]);
      expect(card.delta).toBeUndefined();
      expect(ISSUE_AGE_SECTION.neither([none, none])?.icon).toBe('issue');
    });
  });

  describe('workflow runs', () => {
    it('says runs that GitHub hides are hidden, rather than none passed', () => {
      const hidden = { ...NO_RUNS, hidden: true };
      const [rate, average] = workflowCards([RUNS, hidden], NAMES);
      expect(rate.values[1]).toEqual({ kind: 'missing', reason: RUNS_HIDDEN_SHORT });
      expect(average.values[1]).toEqual({ kind: 'missing', reason: RUNS_HIDDEN_SHORT });
      expect([rate.delta, average.delta]).toEqual([undefined, undefined]);
      expect(WORKFLOW_RUNS_SECTION.note(hidden, 'umbrella/gadget')).toBe(
        runsHidden('umbrella/gadget'),
      );
    });

    it('tells runs that neither passed nor failed, nor completed, from none', () => {
      const cancelled = { ...RUNS, sampled: 2, passed: 0, failed: 0, averageDuration: undefined };
      const [rate, average] = workflowCards([cancelled, NO_RUNS], NAMES);
      expect(rate.values).toEqual([
        { kind: 'missing', reason: NO_PASS_RATE },
        { kind: 'missing', reason: NO_RUNS_SHORT },
      ]);
      expect(average.values).toEqual([
        { kind: 'missing', reason: NONE_COMPLETED },
        { kind: 'missing', reason: NO_RUNS_SHORT },
      ]);
      expect(WORKFLOW_RUNS_SECTION.note({ ...NO_RUNS, branch: 'trunk' }, 'a/b')).toBe(
        noRuns('trunk'),
      );
    });

    it('says so once when neither has runs to tell of for the same reason', () => {
      const hidden = { ...NO_RUNS, hidden: true };
      expect(WORKFLOW_RUNS_SECTION.neither([NO_RUNS, NO_RUNS])).toEqual({
        text: NO_RUNS_EITHER,
        icon: 'pulse',
      });
      expect(WORKFLOW_RUNS_SECTION.neither([hidden, hidden])).toEqual({
        text: RUNS_HIDDEN_EITHER,
        icon: 'lock',
      });
      // Each side then says why it has none.
      expect(WORKFLOW_RUNS_SECTION.neither([hidden, NO_RUNS])).toBeUndefined();
      expect(WORKFLOW_RUNS_SECTION.neither([RUNS, NO_RUNS])).toBeUndefined();
    });
  });

  describe('release cadence', () => {
    it('shows the time between releases and the stable ones of both', () => {
      const other = { ...CADENCE, stable: 0, prereleases: 3, sampled: 3, averageInterval: DAY };
      const [every, stable] = cadenceCards([CADENCE, other], NAMES);
      expect(every.delta).toMatchObject({ ahead: 0, shown: longer(duration(11 * DAY)) });
      // No stable release among those read is a count of none.
      expect(stable.values).toEqual([
        { kind: 'count', value: 10, sub: andPrereleases(2) },
        { kind: 'count', value: 0, sub: andPrereleases(3) },
      ]);
      expect(stable.delta).toEqual({
        ahead: 0,
        shown: signedCompactNumber(10),
        said: moreThan('stableReleases', 'acme/widget', 10, 'umbrella/gadget'),
      });
    });

    it('says no releases, or only one, rather than show a zero', () => {
      const one = { ...CADENCE, sampled: 1, stable: 1, prereleases: 0, averageInterval: undefined };
      const [every, stable] = cadenceCards([one, NO_RELEASES], NAMES);
      expect(every.values).toEqual([
        { kind: 'missing', reason: ONE_RELEASE },
        { kind: 'missing', reason: NO_RELEASES_SHORT },
      ]);
      expect(stable.values[1]).toEqual({ kind: 'missing', reason: NO_RELEASES_SHORT });
      expect([every.delta, stable.delta]).toEqual([undefined, undefined]);
      expect(RELEASE_CADENCE_SECTION.neither([NO_RELEASES, NO_RELEASES])?.text).toBe(
        NO_RELEASES_EITHER,
      );
    });
  });
});
