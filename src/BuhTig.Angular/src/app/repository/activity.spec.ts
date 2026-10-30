import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { niceMax } from '../chart/columns';
import { RepositoryData } from '../dashboard/data';
import { Commit, CommitActivity, Repository } from '../dashboard/resources';
import { exactNumber, monthLabel, weekDate } from '../format/format';
import { Load } from '../widget/load';
import { RepositoryActivity } from './activity';
import { RepositoryActivityTab } from './activity-tab';
import { RepositoryCommits } from './commits';
import {
  ACTIVITY_HEADERS,
  NO_RECENT_COMMITS,
  NO_RECENT_COMMITS_ARCHIVED,
  activityDescription,
} from './messages';

@Component({
  imports: [RepositoryActivity],
  template: `<app-repository-activity />`,
})
class Host {}

/** 52 weeks from Sunday 2025-10-26, each with as many commits as weeks before it. */
const WEEKS = Array.from({ length: 52 }, (_, week) => ({
  start: new Date(Date.UTC(2025, 9, 26 + 7 * week)),
  commits: week,
}));

/** The commits of all the weeks: 0 + 1 + … + 51. */
const ACTIVITY: CommitActivity = { weeks: WEEKS, total: (51 * 52) / 2 };

describe('RepositoryActivity', () => {
  const activity = signal<Load<CommitActivity>>({ status: 'loading' });
  const repository = signal<Partial<Repository> | undefined>(undefined);
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    activity.set({ status: 'loading' });
    repository.set(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RepositoryData,
          useValue: { repository, activity: () => ({ state: activity, retry: () => {} }) },
        },
      ],
    });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const summary = () => element().querySelector('.w-sub')?.textContent?.trim();
  const message = () => element().querySelector('.w-state')?.textContent?.trim();

  async function answer(data: CommitActivity): Promise<void> {
    activity.set({ status: 'ready', data });
    await fixture.whenStable();
  }

  it('charts the commits of each week, scaled to the busiest (FR-REPO-03)', async () => {
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Commit activity');
    expect(element().querySelector('.colchart')).toBeNull();
    await answer(ACTIVITY);
    const columns = [...element().querySelectorAll<HTMLElement>('.col')];
    expect(columns).toHaveLength(52);
    // Against a round figure at least as high as the busiest week's 51.
    const heights = columns.map((column) => column.style.getPropertyValue('--h'));
    expect([heights[0], heights[51]]).toEqual([
      '0.00%',
      `${((51 / niceMax(51)) * 100).toFixed(2)}%`,
    ]);
  });

  it('labels each month where it starts, all but the quarters minor', async () => {
    await answer(ACTIVITY);
    const months = [...element().querySelectorAll('.xaxis span')];
    // From November 2025, on Sunday the 2nd, to October 2026, on Sunday the 4th.
    expect(months.map((month) => month.textContent)).toEqual(
      [10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((month) =>
        monthLabel(new Date(Date.UTC(2025, month, 15))),
      ),
    );
    expect(months.map((month) => month.classList.contains('minor'))).toEqual([
      true,
      true,
      false,
      true,
      true,
      false,
      true,
      true,
      false,
      true,
      true,
      false,
    ]);
  });

  it('says what it shows in a sentence, to the default branch once known (NFR-UX-04)', async () => {
    await answer(ACTIVITY);
    expect(summary()).toBe(activityDescription(ACTIVITY, undefined));
    expect(summary()).toBe(
      `${exactNumber(ACTIVITY.total)} commits in the last 52 weeks. The busiest week was that ` +
        `of ${weekDate(WEEKS[51].start)}, with 51 commits.`,
    );
    repository.set({ defaultBranch: 'main' });
    await fixture.whenStable();
    expect(summary()).toBe(activityDescription(ACTIVITY, 'main'));
    expect(element().querySelector('.plot')?.getAttribute('aria-label')).toContain(summary());
  });

  it("shows each week's commits in a table on request, newest first", async () => {
    await answer(ACTIVITY);
    element().querySelector<HTMLButtonElement>('.w-head button')!.click();
    await fixture.whenStable();
    const rows = [...element().querySelectorAll('tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent?.trim()),
    );
    expect(rows).toHaveLength(53);
    expect(rows[0]).toEqual([...ACTIVITY_HEADERS]);
    expect(rows[1]).toEqual([weekDate(WEEKS[51].start), '51']);
    expect(rows[52]).toEqual([weekDate(WEEKS[0].start), '0']);
    expect(element().querySelector('.colchart')).toBeNull();
  });

  it('says when there were no commits in the last year, and why if archived (FR-REPO-11)', async () => {
    await answer({ weeks: WEEKS.map(({ start }) => ({ start, commits: 0 })), total: 0 });
    expect(message()).toBe(NO_RECENT_COMMITS);
    expect(element().querySelector('.colchart, button')).toBeNull();
    repository.set({ archived: true });
    await fixture.whenStable();
    expect(message()).toBe(NO_RECENT_COMMITS_ARCHIVED);
  });
});

describe('RepositoryActivityTab', () => {
  it('shows the commit activity, taller, and the 10 latest commits', async () => {
    const commits: Commit[] = Array.from({ length: 12 }, (_, index) => ({
      sha: `${index}`.padStart(7, '0'),
      message: `Commit ${index}`,
      author: undefined,
      authorAvatarUrl: undefined,
      committedAt: undefined,
      url: undefined,
    }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RepositoryData,
          useValue: {
            name: signal('acme/widget'),
            repository: signal(undefined),
            activity: () => ({
              state: signal({ status: 'ready', data: ACTIVITY }),
              retry: () => {},
            }),
            commits: () => ({ state: signal({ status: 'ready', data: commits }), retry: () => {} }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(RepositoryActivityTab);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      fixture.debugElement.query(By.directive(RepositoryActivity)).componentInstance.height(),
    ).toBe(240);
    expect(fixture.debugElement.query(By.directive(RepositoryCommits))).not.toBeNull();
    expect(element.querySelectorAll('app-repository-commits li')).toHaveLength(10);
    expect(element.querySelector('app-repository-commits .Box-footer')).toBeNull();
  });
});
