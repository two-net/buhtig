import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { ColumnChart } from '../chart/columns';
import { RepositoryData } from '../dashboard/data';
import { CodeFrequency, Dated, Repository } from '../dashboard/resources';
import { exactNumber, weekDate } from '../format/format';
import { Load } from '../widget/load';
import { COMPUTING } from '../widget/messages';
import { Widget } from '../widget/widget';
import { RepositoryCodeFrequency } from './code-frequency';
import {
  ADDITIONS,
  CODE_FREQUENCY,
  CODE_FREQUENCY_HEADERS,
  DELETIONS,
  LINES_ADDED,
  LINES_DELETED,
  NO_CHANGES,
  TOO_MANY_COMMITS,
  codeFrequencyDescription,
  weekOf,
} from './messages';

/** A week of changes, starting on the Sunday `day` of October 2026. */
const week = (day: number, additions: number, deletions: number) => ({
  start: new Date(Date.UTC(2026, 9, day)),
  additions,
  deletions,
});

/** The lines added and deleted on `acme/widget` in its last weeks, oldest first. */
const FREQUENCY: CodeFrequency = {
  weeks: [week(4, 1_200, 340), week(11, 0, 0), week(18, 5, 4_000), week(25, 30, 0)],
  additions: 1_235,
  deletions: 4_340,
  tooLarge: false,
};

describe('RepositoryCodeFrequency', () => {
  const frequency = signal<Load<CodeFrequency>>({ status: 'loading' });
  let fixture: ComponentFixture<RepositoryCodeFrequency>;

  beforeEach(async () => {
    frequency.set({ status: 'loading' });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RepositoryData,
          useValue: {
            name: signal('acme/widget'),
            repository: signal<Partial<Repository>>({ defaultBranch: 'main' }),
            codeFrequency: () => ({ state: frequency, retry: () => {} }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(RepositoryCodeFrequency);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const message = () => element().querySelector('.w-state span')?.textContent;
  const chart = () => fixture.debugElement.query(By.directive(ColumnChart))?.componentInstance;

  async function answer(data: CodeFrequency): Promise<void> {
    frequency.set({ status: 'ready', data });
    await fixture.whenStable();
  }

  it('charts the lines added above the baseline and those deleted below it (FR-REPO-15)', async () => {
    expect(element().querySelector('h2')?.textContent).toBe(CODE_FREQUENCY);
    await answer(FREQUENCY);
    expect(chart().columns()).toEqual(
      FREQUENCY.weeks.map((week) => ({
        value: week.additions,
        below: week.deletions,
        label: weekOf(week.start),
      })),
    );
    expect([chart().unit(), chart().belowUnit()]).toEqual([LINES_ADDED, LINES_DELETED]);
    expect(element().querySelector('.colchart.diverging')).not.toBeNull();
  });

  it('names what goes up and what goes down, with their totals, not by color alone (NFR-UX-05)', async () => {
    await answer(FREQUENCY);
    expect(
      [...element().querySelectorAll('.legend li')].map((item) =>
        [...item.children].map((part) => part.textContent?.trim()),
      ),
    ).toEqual([
      ['', ADDITIONS, exactNumber(1_235)],
      ['', DELETIONS, exactNumber(4_340)],
    ]);
    // In the colors of the bars, by class: the Content Security Policy allows no inline style
    // (NFR-SEC-06).
    expect(
      [...element().querySelectorAll('.legend .sw')].map((swatch) => swatch.className),
    ).toEqual(['sw up', 'sw down']);
    expect(element().querySelector('.legend [style]')).toBeNull();
  });

  it('says what it shows in a sentence, and shows its weeks as a table, newest first (NFR-UX-04)', async () => {
    await answer(FREQUENCY);
    expect(element().querySelector('.w-sub')?.textContent?.trim()).toBe(
      codeFrequencyDescription(FREQUENCY, 'main'),
    );
    element().querySelector<HTMLButtonElement>('.w-head button')!.click();
    await fixture.whenStable();
    expect(
      [...element().querySelectorAll('tr')].map((row) =>
        [...row.children].map((cell) => cell.textContent?.trim()),
      ),
    ).toEqual([
      [...CODE_FREQUENCY_HEADERS],
      [weekDate(FREQUENCY.weeks[3].start), '30', '0'],
      [weekDate(FREQUENCY.weeks[2].start), '5', exactNumber(4_000)],
      [weekDate(FREQUENCY.weeks[1].start), '0', '0'],
      [weekDate(FREQUENCY.weeks[0].start), exactNumber(1_200), '340'],
    ]);
  });

  it('downloads its weeks as a CSV file, as its table lists them (FR-EXP-02)', async () => {
    const fetchedAt = new Date('2026-11-09T10:00:00.000Z');
    const dated: Dated<CodeFrequency> = { ...FREQUENCY, fetchedAt, stale: undefined };
    await answer(dated);
    const widget = fixture.debugElement.query(By.directive(Widget)).componentInstance as Widget;
    const table = widget.table()!;
    expect(table.csv!.name).toBe('acme-widget-code-frequency');
    expect(table.csv!.columns).toEqual([
      'week_start',
      'additions',
      'deletions',
      'repository',
      'default_branch',
      'fetched_at',
      'stale',
    ]);
    // Newest first, as the table, with the lines exact, and a week without changes as 0.
    expect(table.csv!.rows).toEqual([
      ['2026-10-25', 30, 0, 'acme/widget', 'main', fetchedAt, undefined],
      ['2026-10-18', 5, 4_000, 'acme/widget', 'main', fetchedAt, undefined],
      ['2026-10-11', 0, 0, 'acme/widget', 'main', fetchedAt, undefined],
      ['2026-10-04', 1_200, 340, 'acme/widget', 'main', fetchedAt, undefined],
    ]);
    expect(table.rows.map((row) => row.label)).toEqual(
      table.csv!.rows.map(([day]) => weekDate(new Date(`${day}T00:00:00Z`))),
    );
  });

  it('says so while GitHub computes it (FR-REPO-10)', async () => {
    frequency.set({ status: 'computing' });
    await fixture.whenStable();
    expect(element().querySelector('.w-state.calc span')?.textContent).toBe(COMPUTING);
  });

  it('says when no lines changed in the last year, as of an empty repository (FR-REPO-11)', async () => {
    await answer({ weeks: [week(4, 0, 0)], additions: 0, deletions: 0, tooLarge: false });
    expect(message()).toBe(NO_CHANGES);
    await answer({ weeks: [], additions: 0, deletions: 0, tooLarge: false });
    expect(message()).toBe(NO_CHANGES);
  });

  it('says when GitHub does not compute it for a repository this large', async () => {
    await answer({ weeks: [], additions: 0, deletions: 0, tooLarge: true });
    expect(message()).toBe(TOO_MANY_COMMITS);
    expect(element().querySelector('app-column-chart')).toBeNull();
  });
});
