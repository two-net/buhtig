import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { IssueAge, MergeVelocity } from '../dashboard/resources';
import { duration, percent } from '../format/format';
import { Load } from '../widget/load';
import { FAILED } from '../widget/messages';
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
} from './messages';
import { RepositoryIssueAge, RepositoryMergeVelocity } from './velocity';

/** How the 100 pull requests of `acme/widget` updated last came to an end. */
const VELOCITY: MergeVelocity = {
  sampled: 100,
  merged: 61,
  closed: 9,
  medianTimeToMerge: 2 * 24 * 60 * 60,
  truncated: true,
};

/** How long the open issues of `acme/widget` updated last have been open. */
const AGE: IssueAge = { sampled: 37, medianAge: 66 * 24 * 60 * 60, truncated: true };

/** The stat cards' names and figures in `element`, each a list. */
function figures(element: HTMLElement): string[][] {
  return [...element.querySelectorAll('.stat')].map((card) =>
    [...card.children].map((part) => part.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
  );
}

describe('RepositoryMergeVelocity', () => {
  const velocity = signal<Load<MergeVelocity>>({ status: 'loading' });
  const retry = vi.fn();
  let fixture: ComponentFixture<RepositoryMergeVelocity>;

  beforeEach(async () => {
    velocity.set({ status: 'loading' });
    retry.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RepositoryData,
          useValue: { mergeVelocity: () => ({ state: velocity, retry }) },
        },
      ],
    });
    fixture = TestBed.createComponent(RepositoryMergeVelocity);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const message = () => element().querySelector('.w-state span')?.textContent;

  async function answer(data: MergeVelocity): Promise<void> {
    velocity.set({ status: 'ready', data });
    await fixture.whenStable();
  }

  it('shows a placeholder the size of its figures until they load', () => {
    expect(element().querySelector('h2')?.textContent).toBe(MERGE_VELOCITY);
    expect(element().querySelector('.figures-skel')).not.toBeNull();
  });

  it('tells the median time to merge and the merge ratio, and what they are of (FR-REPO-13)', async () => {
    await answer(VELOCITY);
    expect(figures(element())).toEqual([
      [MEDIAN_TIME_TO_MERGE, duration(VELOCITY.medianTimeToMerge!), 'of 61 merged'],
      [MERGE_RATIO, percent(61 / 70), '61 merged, 9 closed'],
    ]);
    expect(element().querySelector('.w-sub')?.textContent?.trim()).toBe(
      mergeVelocityDescription(VELOCITY),
    );
    // Whatever the list of pull requests below shows.
    expect(element().querySelector('.Box-footer')?.textContent?.trim()).toBe(MERGE_VELOCITY_SAMPLE);
  });

  it('tells no time to merge when none were merged, and a ratio of none', async () => {
    await answer({ ...VELOCITY, merged: 0, closed: 3, medianTimeToMerge: undefined });
    expect(figures(element())).toEqual([
      [MEDIAN_TIME_TO_MERGE, NO_FIGURE, 'of 0 merged'],
      [MERGE_RATIO, percent(0), '0 merged, 3 closed'],
    ]);
  });

  it('says when no pull request has been merged or closed, as when there are none (FR-REPO-11)', async () => {
    await answer({ ...VELOCITY, sampled: 2, merged: 0, closed: 0, medianTimeToMerge: undefined });
    expect(message()).toBe(NO_MERGES);
    expect(element().querySelector('dl')).toBeNull();
  });

  it('says when they failed to load, and tries again (FR-REPO-09)', async () => {
    velocity.set({ status: 'error', failure: 'github' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    element().querySelector('button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('RepositoryIssueAge', () => {
  const age = signal<Load<IssueAge>>({ status: 'loading' });
  let fixture: ComponentFixture<RepositoryIssueAge>;

  beforeEach(async () => {
    age.set({ status: 'loading' });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RepositoryData,
          useValue: { issueAge: () => ({ state: age, retry: () => {} }) },
        },
      ],
    });
    fixture = TestBed.createComponent(RepositoryIssueAge);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;

  async function answer(data: IssueAge): Promise<void> {
    age.set({ status: 'ready', data });
    await fixture.whenStable();
  }

  it('tells the median age of the open issues, and what it is of (FR-REPO-13)', async () => {
    expect(element().querySelector('h2')?.textContent).toBe(ISSUE_AGE);
    await answer(AGE);
    expect(figures(element())).toEqual([
      [MEDIAN_AGE, duration(AGE.medianAge!), 'of 37 open issues'],
    ]);
    expect(element().querySelector('.w-sub')?.textContent?.trim()).toBe(issueAgeDescription(AGE));
    // Whatever the list of issues below shows.
    expect(element().querySelector('.Box-footer')?.textContent?.trim()).toBe(ISSUE_AGE_SAMPLE);
  });

  it('says when there are no open issues to measure (FR-REPO-11)', async () => {
    await answer({ sampled: 0, medianAge: undefined, truncated: false });
    expect(element().querySelector('.w-state span')?.textContent).toBe(NO_OPEN_ISSUES);
  });
});
