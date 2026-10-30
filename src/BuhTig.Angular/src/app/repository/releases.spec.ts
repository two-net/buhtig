import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { Releases, Stats } from '../dashboard/resources';
import { exactDay, exactTime } from '../format/format';
import { Load } from '../widget/load';
import { FAILED, UNAVAILABLE } from '../widget/messages';
import { LATEST, NO_RELEASES, PRERELEASE } from './messages';
import { RepositoryReleasesTab } from './releases';

/** The latest releases of `acme/widget`, the latest first. */
const RELEASES: Releases = {
  releases: [
    {
      tag: 'v3.0.0-rc.1',
      name: undefined,
      publishedAt: new Date('2026-10-11T12:00:00Z'),
      prerelease: true,
      url: 'https://github.com/acme/widget/releases/tag/v3.0.0-rc.1',
      target: 'main',
    },
    {
      tag: 'v2.1.0',
      name: 'Widget 2.1',
      publishedAt: new Date('2026-10-01T12:00:00Z'),
      prerelease: false,
      url: 'https://github.com/acme/widget/releases/tag/v2.1.0',
      target: undefined,
    },
    {
      tag: 'v1',
      name: 'One',
      publishedAt: undefined,
      prerelease: false,
      url: undefined,
      target: 'release/1.x',
    },
  ],
  count: 42,
};

/** The stat cards of `acme/widget`, of which GitHub marks `latest` as the latest release. */
const stats = (latest: string | undefined): Stats => ({
  stars: 0,
  forks: 0,
  watchers: 0,
  openIssues: 0,
  openPullRequests: 0,
  latestRelease:
    latest === undefined ? undefined : { tag: latest, publishedAt: undefined, url: undefined },
});

describe('RepositoryReleasesTab', () => {
  const releases = signal<Load<Releases>>({ status: 'loading' });
  const statsState = signal<Load<Stats>>({ status: 'loading' });
  const retry = vi.fn();
  let fixture: ComponentFixture<RepositoryReleasesTab>;

  beforeEach(async () => {
    releases.set({ status: 'loading' });
    statsState.set({ status: 'loading' });
    retry.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RepositoryData,
          useValue: {
            releases: () => ({ state: releases, retry }),
            stats: () => ({ state: statsState, retry: () => {} }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(RepositoryReleasesTab);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...element().querySelectorAll('li.release')];
  const labels = () =>
    rows().map((row) => [...row.querySelectorAll('h3 .label')].map((label) => label.textContent));
  const message = () => element().querySelector('.w-state span')?.textContent;
  /** The tag that `row` heads with, without its labels. */
  const tag = (row: Element) => {
    const heading = row.querySelector('h3')!.cloneNode(true) as Element;
    heading.querySelectorAll('.label').forEach((label) => label.remove());
    return heading.textContent?.trim();
  };

  async function answer(data: Releases): Promise<void> {
    releases.set({ status: 'ready', data });
    await fixture.whenStable();
  }

  it('lists the latest releases with their tag, name, date and what each was made from (FR-REPO-08)', async () => {
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Releases');
    await answer(RELEASES);
    expect(
      rows().map((row) => [
        tag(row),
        row.querySelector('.rel-name')?.textContent,
        [...row.querySelectorAll('.m > span')].map((part) => part.textContent?.trim()),
      ]),
    ).toEqual([
      // Its name only repeated its tag.
      [
        'v3.0.0-rc.1',
        undefined,
        [exactDay(RELEASES.releases[0].publishedAt!), 'v3.0.0-rc.1', 'main'],
      ],
      ['v2.1.0', 'Widget 2.1', [exactDay(RELEASES.releases[1].publishedAt!), 'v2.1.0']],
      ['v1', 'One', ['v1', 'release/1.x']],
    ]);
    const time = rows()[0].querySelector('time')!;
    expect([time.getAttribute('datetime'), time.getAttribute('title')]).toEqual([
      '2026-10-11T12:00:00.000Z',
      exactTime(RELEASES.releases[0].publishedAt!),
    ]);
  });

  it('links each tag to its page on GitHub, when GitHub says where (FR-REPO-12)', async () => {
    await answer(RELEASES);
    expect(rows().map((row) => row.querySelector('h3 a')?.getAttribute('href'))).toEqual([
      RELEASES.releases[0].url,
      RELEASES.releases[1].url,
      undefined,
    ]);
  });

  it('marks pre-releases, and the release GitHub marks as the latest once known', async () => {
    await answer(RELEASES);
    expect(labels()).toEqual([[PRERELEASE], [], []]);
    statsState.set({ status: 'ready', data: stats('v2.1.0') });
    await fixture.whenStable();
    expect(labels()).toEqual([[PRERELEASE], [LATEST], []]);
    statsState.set({ status: 'ready', data: stats(undefined) });
    await fixture.whenStable();
    expect(labels()).toEqual([[PRERELEASE], [], []]);
  });

  it('says when there are no releases (FR-REPO-11)', async () => {
    await answer({ releases: [], count: 0 });
    expect(message()).toBe(NO_RELEASES);
    expect(element().querySelector('ul, button')).toBeNull();
  });

  it('says when they failed to load, and tries again (FR-REPO-09)', async () => {
    releases.set({ status: 'error', failure: 'unavailable' });
    await fixture.whenStable();
    expect(message()).toBe(UNAVAILABLE);
    element().querySelector('button')!.click();
    expect(retry).toHaveBeenCalledOnce();
    releases.set({ status: 'error', failure: 'github' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
  });
});
