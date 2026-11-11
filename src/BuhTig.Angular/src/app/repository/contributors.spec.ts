import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { Contributors, Dated, Repository } from '../dashboard/resources';
import { compactNumber } from '../format/format';
import { Load } from '../widget/load';
import { FAILED } from '../widget/messages';
import { Widget } from '../widget/widget';
import { RepositoryContributorsTab } from './contributors';
import {
  CONTRIBUTORS_HEADERS,
  NO_CONTRIBUTORS,
  TOO_MANY_CONTRIBUTORS,
  commitShareDescription,
  contributorsDescription,
} from './messages';
import { commitShare } from './metrics';

/** The top contributors of `acme/widget`. */
const CONTRIBUTORS: Contributors = {
  contributors: [
    {
      login: 'alice',
      avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
      url: 'https://github.com/alice',
      commits: 12_345,
    },
    { login: 'dependabot[bot]', avatarUrl: undefined, url: undefined, commits: 1 },
  ],
  tooLarge: false,
  count: 345,
};

describe('RepositoryContributorsTab', () => {
  const contributors = signal<Load<Contributors>>({ status: 'loading' });
  const repository = signal<Partial<Repository> | undefined>(undefined);
  const retry = vi.fn();
  let fixture: ComponentFixture<RepositoryContributorsTab>;

  beforeEach(async () => {
    contributors.set({ status: 'loading' });
    repository.set(undefined);
    retry.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RepositoryData,
          useValue: {
            name: signal('acme/widget'),
            repository,
            contributors: () => ({ state: contributors, retry }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(RepositoryContributorsTab);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const bars = () => [...element().querySelectorAll('.hbar')];
  const summary = () => element().querySelector('.w-sub')?.textContent?.trim();
  const message = () => element().querySelector('.w-state span')?.textContent;
  const reading = () => element().querySelector('.reading')?.textContent?.trim();
  /** Contributors who made `commits` each, most first. */
  const made = (...commits: number[]): Contributors => ({
    contributors: commits.map((count, index) => ({
      login: `author-${index + 1}`,
      avatarUrl: undefined,
      url: undefined,
      commits: count,
    })),
    tooLarge: false,
    count: commits.length,
  });
  /** The CSV file that the widget downloads, if it offers one. */
  const csv = () =>
    (fixture.debugElement.query(By.directive(Widget)).componentInstance as Widget).table()?.csv;

  async function answer(data: Contributors): Promise<void> {
    contributors.set({ status: 'ready', data });
    await fixture.whenStable();
  }

  it('charts the top contributors by commits, most first (FR-REPO-05)', async () => {
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Contributors');
    expect(element().querySelector('.skel.bar')).not.toBeNull();
    await answer(CONTRIBUTORS);
    expect(
      bars().map((bar) => [
        bar.querySelector('.lab')?.textContent?.trim(),
        bar.querySelector('b')?.textContent,
      ]),
    ).toEqual([
      ['alice', compactNumber(12_345)],
      ['dependabot[bot]', '1'],
    ]);
  });

  it('links each to their profile on GitHub, with their avatar (FR-REPO-12)', async () => {
    await answer(CONTRIBUTORS);
    expect(bars().map((bar) => bar.getAttribute('href'))).toEqual([
      'https://github.com/alice',
      null,
    ]);
    expect(bars()[0].querySelector('img')?.getAttribute('src')).toBe(
      CONTRIBUTORS.contributors[0].avatarUrl,
    );
    expect(bars()[1].querySelector('svg.av')).not.toBeNull();
  });

  it('says what it shows, to the default branch, and lists it as a table (NFR-UX-04)', async () => {
    await answer(CONTRIBUTORS);
    expect(summary()).toBe(contributorsDescription(2, undefined));
    repository.set({ defaultBranch: 'main' });
    await fixture.whenStable();
    expect(summary()).toBe(contributorsDescription(2, 'main'));
    expect(element().querySelector('.hbars')?.getAttribute('aria-label')).toBe(summary());

    element().querySelector<HTMLButtonElement>('.w-head button')!.click();
    await fixture.whenStable();
    expect(
      [...element().querySelectorAll('tr')].map((row) =>
        [...row.children].map((cell) => cell.textContent?.trim()),
      ),
    ).toEqual([[...CONTRIBUTORS_HEADERS], ['@alice', '12,345'], ['@dependabot[bot]', '1']]);
  });

  it('downloads its table as a CSV file, with how many there are and when fetched (FR-EXP-02)', async () => {
    const fetchedAt = new Date('2026-11-09T10:00:00.000Z');
    repository.set({ defaultBranch: 'main' });
    const dated: Dated<Contributors> = { ...CONTRIBUTORS, fetchedAt, stale: 'held' };
    await answer(dated);
    expect(csv()).toEqual({
      name: 'acme-widget-contributors',
      columns: [
        'rank',
        'login',
        'commits',
        'profile_url',
        'contributors_total',
        'repository',
        'default_branch',
        'fetched_at',
        'stale',
      ],
      // As its table lists them, with their commits exact, and a profile only where GitHub has one.
      rows: [
        [
          1,
          'alice',
          12_345,
          'https://github.com/alice',
          345,
          'acme/widget',
          'main',
          fetchedAt,
          'held',
        ],
        [2, 'dependabot[bot]', 1, undefined, 345, 'acme/widget', 'main', fetchedAt, 'held'],
      ],
    });
    // How many there are in all is left empty where GitHub does not say, never 0.
    await answer({ ...CONTRIBUTORS, count: undefined });
    expect(csv()!.rows.map((row) => row[4])).toEqual([undefined, undefined]);
  });

  it('says how few of those listed made at least half their commits (FR-REPO-05)', async () => {
    await answer(made(390, 250, 60, 40, 20, 15, 10, 8, 5, 2));
    expect(reading()).toBe('2 of the 10 listed authors made 640 of these 800 commits.');
    expect(reading()).toBe(
      commitShareDescription(
        commitShare(made(390, 250, 60, 40, 20, 15, 10, 8, 5, 2).contributors)!,
      ),
    );
  });

  it('says one of two made half the commits when they share them evenly (FR-REPO-05)', async () => {
    await answer(made(150, 150));
    expect(reading()).toBe('1 of the 2 listed authors made 150 of these 300 commits.');
  });

  it('says so when one of them made at least half the commits (FR-REPO-05)', async () => {
    await answer(CONTRIBUTORS);
    expect(reading()).toBe('1 of the 2 listed authors made 12,345 of these 12,346 commits.');
  });

  it('says nothing of their share when only one is listed (FR-REPO-05)', async () => {
    await answer(made(1_000));
    expect(bars()).toHaveLength(1);
    expect(reading()).toBeUndefined();
  });

  it("says GitHub doesn't list the contributors of repositories this large", async () => {
    await answer({ contributors: [], tooLarge: true, count: undefined });
    expect(element().querySelector('.w-body p.w-state')?.textContent?.trim()).toBe(
      TOO_MANY_CONTRIBUTORS,
    );
    expect(element().querySelector('.hbars, .w-sub, .w-head button, .reading')).toBeNull();
  });

  it('says when there are none (FR-REPO-11)', async () => {
    await answer({ contributors: [], tooLarge: false, count: 0 });
    expect(message()).toBe(NO_CONTRIBUTORS);
    expect(element().querySelector('.hbars, button, .reading')).toBeNull();
  });

  it('says when they failed to load, and tries again (FR-REPO-09)', async () => {
    contributors.set({ status: 'error', failure: 'github' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    element().querySelector('button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
