import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { IssuesAndPullRequests, Stats } from '../dashboard/resources';
import { Clock } from '../format/clock';
import { compactNumber, exactNumber, relativeTime } from '../format/format';
import { Load } from '../widget/load';
import { FAILED } from '../widget/messages';
import { issuesDescription, pullRequestsDescription } from './messages';
import { RepositoryPulse } from './pulse';

/** The stat cards of `acme/widget`. */
const STATS: Stats = {
  stars: 12_345,
  forks: 678,
  watchers: 90,
  openIssues: 12,
  openPullRequests: 3,
  latestRelease: {
    tag: 'v2.1.0',
    publishedAt: new Date('2026-10-01T12:00:00Z'),
    url: 'https://github.com/acme/widget/releases/tag/v2.1.0',
  },
};

const ISSUES: IssuesAndPullRequests = {
  issues: { open: 12, closed: 4 },
  pullRequests: { open: 3, merged: 5, closed: 1 },
  recent: [],
};

describe('RepositoryPulse', () => {
  const now = new Date('2026-10-22T12:00:00Z').getTime();
  const stats = signal<Load<Stats>>({ status: 'loading' });
  const issues = signal<Load<IssuesAndPullRequests>>({ status: 'loading' });
  const retry = vi.fn();
  let fixture: ComponentFixture<RepositoryPulse>;

  beforeEach(async () => {
    stats.set({ status: 'loading' });
    issues.set({ status: 'loading' });
    retry.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Clock, useValue: { now: signal(now) } },
        {
          provide: RepositoryData,
          useValue: {
            stats: () => ({ state: stats, retry }),
            issues: () => ({ state: issues, retry: () => {} }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(RepositoryPulse);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  /** Each stat card's name, then its figures. */
  const cards = () =>
    [...element().querySelectorAll('.stat')].map((card) => [...card.children].map(shown));
  const bars = () => [...element().querySelectorAll('app-split-bar')];

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  async function answer(data: Stats, issuesData = ISSUES): Promise<void> {
    stats.set({ status: 'ready', data });
    issues.set({ status: 'ready', data: issuesData });
    await fixture.whenStable();
  }

  it('shows a placeholder until the figures load', () => {
    expect(element().querySelector('h2')?.textContent).toBe('Overview');
    expect(element().querySelector('.pulse-skel')).not.toBeNull();
    expect(element().querySelector('dl')).toBeNull();
  });

  it('shows stars, forks, watchers, and open issues and pull requests apart (FR-REPO-02)', async () => {
    await answer(STATS);
    expect(cards().slice(0, 5)).toEqual([
      ['Stars', compactNumber(12_345)],
      ['Forks', '678'],
      ['Watching', '90'],
      ['Open issues', '12'],
      ['Open pull requests', '3'],
    ]);
    // The exact figure on hover and focus (UI-06).
    expect(element().querySelector('.stat [role="tooltip"]')?.textContent).toBe(
      exactNumber(12_345),
    );
  });

  it('links the latest release to its page on GitHub, with when it was published (FR-REPO-12)', async () => {
    await answer(STATS);
    expect(cards()[5]).toEqual([
      'Latest release',
      'v2.1.0',
      relativeTime(STATS.latestRelease!.publishedAt!, now),
    ]);
    expect(element().querySelector('.stat a')?.getAttribute('href')).toBe(STATS.latestRelease!.url);

    await answer({
      ...STATS,
      latestRelease: { tag: 'v1', publishedAt: undefined, url: undefined },
    });
    expect(cards()[5]).toEqual(['Latest release', 'v1']);
    expect(element().querySelector('.stat a')).toBeNull();
  });

  it('says when there is no release yet', async () => {
    await answer({ ...STATS, latestRelease: undefined });
    expect(cards()[5]).toEqual(['Latest release', 'None', 'No releases yet']);
  });

  it('splits issues and pull requests by state, as bars, once they load (FR-REPO-06)', async () => {
    stats.set({ status: 'ready', data: STATS });
    await fixture.whenStable();
    expect(bars()).toEqual([]);
    issues.set({ status: 'ready', data: ISSUES });
    await fixture.whenStable();
    expect(
      bars().map((bar) => [
        bar.querySelector('.sublabel')?.textContent,
        bar.querySelector('.stack')?.getAttribute('aria-label'),
        [...bar.querySelectorAll('.legend li')].map((item) =>
          [item.querySelector('.nm'), item.querySelector('.pc')].map((part) => part?.textContent),
        ),
      ]),
    ).toEqual([
      [
        'Issues',
        issuesDescription(12, 4),
        [
          ['Open', '12'],
          ['Closed', '4'],
        ],
      ],
      [
        'Pull requests',
        pullRequestsDescription(3, 5, 1),
        [
          ['Open', '3'],
          ['Merged', '5'],
          ['Closed', '1'],
        ],
      ],
    ]);
  });

  it('leaves out the bar of what the repository turned off, and both when there are none', async () => {
    await answer(STATS, { ...ISSUES, issues: undefined });
    expect(bars().map((bar) => bar.querySelector('.sublabel')?.textContent)).toEqual([
      'Pull requests',
    ]);
    await answer(STATS, {
      issues: { open: 0, closed: 0 },
      pullRequests: { open: 0, merged: 0, closed: 0 },
      recent: [],
    });
    expect(element().querySelector('.pulse-bars')).toBeNull();
  });

  it('says when the figures failed to load, and tries again (FR-REPO-09)', async () => {
    stats.set({ status: 'error', failure: 'github' });
    await fixture.whenStable();
    expect(element().querySelector('.w-state span')?.textContent).toBe(FAILED);
    element().querySelector('button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
