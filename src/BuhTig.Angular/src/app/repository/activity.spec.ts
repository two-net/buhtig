import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { exactNumber, monthLabel, weekDate } from '../format/format';
import { RepositoryActivity } from './activity';

@Component({
  imports: [RepositoryActivity],
  template: `<app-repository-activity [owner]="owner()" [repo]="repo()" />`,
})
class Host {
  readonly owner = signal('acme');
  readonly repo = signal('widget');
}

/** 52 weeks from Sunday 2025-10-26, each with as many commits as weeks before it. */
const WEEKS = Array.from({ length: 52 }, (_, week) => ({
  week: new Date(Date.UTC(2025, 9, 26 + 7 * week)).toISOString().slice(0, 10),
  commits: week,
}));

/** The commits of all the weeks: 0 + 1 + … + 51. */
const TOTAL = (51 * 52) / 2;

describe('RepositoryActivity', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const svg = () => element().querySelector('svg')!;
  const caption = () => element().querySelector('.caption')?.textContent?.trim();
  const bars = () => [...element().querySelectorAll('rect.bar')];
  const columns = () => [...element().querySelectorAll('rect.column')];

  async function answer(weeks: { week: string; commits: number }[]): Promise<void> {
    http.expectOne('/-/api/repositories/acme/widget/commit-activity').flush({ weeks });
    await fixture.whenStable();
  }

  it('charts the commits of each week, scaled to the busiest week (FR-REPO-03)', async () => {
    await answer(WEEKS);
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Commit activity');
    expect(columns()).toHaveLength(52);
    // The first week has no commits, and so no bar.
    expect(bars()).toHaveLength(51);
    expect(bars().at(-1)!.getAttribute('height')).toBe('100');
    expect(bars().at(-1)!.getAttribute('y')).toBe('0');
    // However few beside the busiest week's, a week's commits show.
    expect(bars()[0].getAttribute('height')).toBe('2');
    expect(caption()).toBe(`${exactNumber(TOTAL)} commits in the last year`);
  });

  it("says what it shows in a sentence, and each week's commits in a table (NFR-UX-04)", async () => {
    await answer(WEEKS);
    expect(svg().getAttribute('role')).toBe('img');
    expect(svg().getAttribute('aria-label')).toBe('Commits per week');
    expect(element().querySelector('.summary')?.textContent?.trim()).toBe(
      `${exactNumber(TOTAL)} commits in the last year. The busiest week was that of ` +
        `${weekDate(new Date('2026-10-18'))}, with 51 commits.`,
    );
    const rows = [...element().querySelectorAll('tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent?.trim()),
    );
    expect(rows).toHaveLength(53);
    expect(rows[0]).toEqual(['Week of', 'Commits']);
    expect(rows[1]).toEqual([weekDate(new Date('2025-10-26')), '0']);
    expect(rows[52]).toEqual([weekDate(new Date('2026-10-18')), '51']);
  });

  it('tells the commits of each week by keyboard too (NFR-UX-03)', async () => {
    await answer(WEEKS);
    svg().focus();
    await fixture.whenStable();
    expect(caption()).toBe(`Week of ${weekDate(new Date('2026-10-18'))}: 51 commits`);
    svg().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    await fixture.whenStable();
    expect(caption()).toBe(`Week of ${weekDate(new Date('2025-10-26'))}: 0 commits`);
  });

  it('tells the commits of the week pointed at, and the total again after', async () => {
    await answer(WEEKS);
    columns()[1].dispatchEvent(new Event('pointerenter'));
    await fixture.whenStable();
    expect(caption()).toBe(`Week of ${weekDate(new Date('2025-11-02'))}: 1 commit`);
    expect(bars()[0].classList.contains('pointed')).toBe(true);
    expect(bars().filter((bar) => bar.classList.contains('pointed'))).toHaveLength(1);

    // A week without commits too.
    columns()[0].dispatchEvent(new Event('pointerenter'));
    await fixture.whenStable();
    expect(caption()).toBe(`Week of ${weekDate(new Date('2025-10-26'))}: 0 commits`);

    svg().dispatchEvent(new Event('pointerleave'));
    await fixture.whenStable();
    expect(caption()).toBe(`${exactNumber(TOTAL)} commits in the last year`);
  });

  it('labels each month where it starts, within the chart', async () => {
    await answer(WEEKS);
    const months = [...element().querySelectorAll<HTMLElement>('.months span')];
    // From November 2025, on Sunday the 2nd, to October 2026, on Sunday the 4th, three weeks
    // before the chart ends.
    expect(months.map((month) => month.textContent)).toEqual(
      [10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((month) =>
        monthLabel(new Date(Date.UTC(2025, month, 15))),
      ),
    );
    expect(months[0].style.left).toBe(`${(1 / 52) * 100}%`);
    expect(element().querySelector('.months')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('says when there were no commits in the last year (FR-REPO-11)', async () => {
    await answer([]);
    expect(element().querySelector('.message')?.textContent?.trim()).toBe(
      'No commits in the last year.',
    );
    expect(element().querySelector('svg, button')).toBeNull();

    fixture.componentInstance.repo.set('gadget');
    await fixture.whenStable();
    http
      .expectOne('/-/api/repositories/acme/gadget/commit-activity')
      .flush({ weeks: WEEKS.map(({ week }) => ({ week, commits: 0 })) });
    await fixture.whenStable();
    expect(element().querySelector('.message')?.textContent?.trim()).toBe(
      'No commits in the last year.',
    );
  });
});
