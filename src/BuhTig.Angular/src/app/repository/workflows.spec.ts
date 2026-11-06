import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { WorkflowRun, WorkflowRuns } from '../dashboard/resources';
import { Clock } from '../format/clock';
import { duration, percent, relativeTime } from '../format/format';
import { Load } from '../widget/load';
import { FAILED } from '../widget/messages';
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
  workflowRunsDescription,
} from './messages';
import { RepositoryWorkflows, runBadge } from './workflows';

const now = new Date('2026-10-22T12:00:00Z').getTime();

/** The latest workflow run on `acme/widget`'s default branch, which passed. */
const LATEST: WorkflowRun = {
  name: 'CI',
  status: 'completed',
  conclusion: 'success',
  startedAt: new Date('2026-10-22T10:00:00Z'),
  url: 'https://github.com/acme/widget/actions/runs/7',
};

/** How the 50 latest workflow runs on `acme/widget`'s default branch fared. */
const RUNS: WorkflowRuns = {
  branch: 'main',
  sampled: 50,
  passed: 45,
  failed: 3,
  averageDuration: 252,
  latest: LATEST,
  hidden: false,
};

describe('RepositoryWorkflows', () => {
  const runs = signal<Load<WorkflowRuns>>({ status: 'loading' });
  const retry = vi.fn();
  let fixture: ComponentFixture<RepositoryWorkflows>;

  beforeEach(async () => {
    runs.set({ status: 'loading' });
    retry.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Clock, useValue: { now: signal(now) } },
        {
          provide: RepositoryData,
          useValue: { workflowRuns: () => ({ state: runs, retry }) },
        },
      ],
    });
    fixture = TestBed.createComponent(RepositoryWorkflows);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const message = () => element().querySelector('.w-state span')?.textContent;
  /** Each figure's name, then what it shows, without the tooltips of exact times. */
  const figures = () =>
    [...element().querySelectorAll('.stat')].map((card) =>
      [...card.children].map((part) => {
        const copy = part.cloneNode(true) as Element;
        copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
        return copy.textContent?.replace(/\s+/g, ' ').trim();
      }),
    );
  const badge = () => element().querySelector('.label.run');

  async function answer(data: WorkflowRuns): Promise<void> {
    runs.set({ status: 'ready', data });
    await fixture.whenStable();
  }

  it('tells the pass rate, the latest run and the average duration (FR-REPO-14)', async () => {
    expect(element().querySelector('h2')?.textContent).toBe(WORKFLOW_RUNS);
    expect(element().querySelector('.figures-skel')).not.toBeNull();
    await answer(RUNS);
    expect(figures()).toEqual([
      [PASS_RATE, percent(45 / 48), '45 of 48 runs'],
      [LATEST_RUN, RUN_STATES.passing, `CI · ${relativeTime(LATEST.startedAt!, now)}`],
      [AVERAGE_DURATION, duration(252), PER_COMPLETED_RUN],
    ]);
    expect(element().querySelector('.w-sub')?.textContent?.trim()).toBe(
      workflowRunsDescription(RUNS),
    );
  });

  it('says the state of the latest run in words and with an icon, not by color alone (NFR-UX-05)', async () => {
    await answer({ ...RUNS, latest: { ...LATEST, conclusion: 'failure' } });
    expect(badge()?.textContent?.trim()).toBe(RUN_STATES.failing);
    expect(badge()?.classList).toContain('danger');
    expect(badge()?.querySelector('app-icon')).not.toBeNull();
  });

  it('links the latest run to its page on GitHub, when GitHub says where (FR-REPO-12)', async () => {
    await answer(RUNS);
    const link = element().querySelector('.stat a');
    expect([link?.textContent, link?.getAttribute('href')]).toEqual(['CI', LATEST.url]);
    await answer({ ...RUNS, latest: { ...LATEST, url: undefined } });
    expect(element().querySelector('.stat a')).toBeNull();
    expect(figures()[1][2]).toBe(`CI · ${relativeTime(LATEST.startedAt!, now)}`);
  });

  it('tells no pass rate when no run passed or failed, nor a duration when none completed', async () => {
    await answer({
      ...RUNS,
      passed: 0,
      failed: 0,
      averageDuration: undefined,
      latest: { ...LATEST, status: 'in_progress', conclusion: undefined },
    });
    expect(figures()).toEqual([
      [PASS_RATE, NO_FIGURE, NO_PASS_RATE],
      [LATEST_RUN, RUN_STATES.running, `CI · ${relativeTime(LATEST.startedAt!, now)}`],
      [AVERAGE_DURATION, NO_FIGURE, PER_COMPLETED_RUN],
    ]);
  });

  it('says when there are no runs on the default branch (FR-REPO-11)', async () => {
    await answer({ ...RUNS, sampled: 0, passed: 0, failed: 0, latest: undefined });
    expect(message()).toBe(noRuns('main'));
    await answer({ ...RUNS, branch: undefined, sampled: 0, latest: undefined });
    expect(message()).toBe(noRuns(undefined));
  });

  it("says what the viewer's token needs when GitHub will not list the runs to it (NFR-UX-06)", async () => {
    await answer({ ...RUNS, sampled: 0, latest: undefined, hidden: true });
    expect(message()).toBe(RUNS_HIDDEN);
    expect(element().querySelector('dl')).toBeNull();
  });

  it('says when they failed to load, and tries again (FR-REPO-09)', async () => {
    runs.set({ status: 'error', failure: 'github' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    element().querySelector('button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('runBadge', () => {
  const run = (status: string | undefined, conclusion?: string): WorkflowRun => ({
    ...LATEST,
    status,
    conclusion,
  });

  it("names each state of a run, in a tone and with an icon, as GitHub's status and conclusion tell", () => {
    expect(
      [
        run('completed', 'success'),
        run('completed', 'failure'),
        run('completed', 'timed_out'),
        run('completed', 'startup_failure'),
        run('completed', 'cancelled'),
        run('completed', 'action_required'),
        run('completed', 'skipped'),
        run('completed', 'neutral'),
        run('completed', 'stale'),
        run('completed', 'new'),
        run('completed'),
        run('in_progress'),
        run('queued'),
        run('waiting'),
        run('pending'),
        run('requested'),
        run(undefined),
      ].map((run) => {
        const { label, icon, tone } = runBadge(run);
        return `${label}, ${icon}, ${tone || 'plain'}`;
      }),
    ).toEqual([
      'Passing, check, success',
      'Failing, x, danger',
      'Failing, x, danger',
      'Failing, x, danger',
      'Cancelled, alert, plain',
      'Action required, alert, attention',
      'Skipped, info, plain',
      'Neutral, info, plain',
      'Stale, info, plain',
      'Unknown, question, plain',
      'Unknown, question, plain',
      'In progress, clock, attention',
      'Queued, clock, plain',
      'Queued, clock, plain',
      'Queued, clock, plain',
      'Queued, clock, plain',
      'Unknown, question, plain',
    ]);
  });
});
