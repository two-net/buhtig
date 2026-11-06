import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { ReleaseCadence } from '../dashboard/resources';
import { compactNumber, duration, exactNumber } from '../format/format';
import { Load } from '../widget/load';
import { FAILED } from '../widget/messages';
import { RepositoryReleaseCadence } from './cadence';
import {
  DOWNLOADS,
  NO_FIGURE,
  NO_FILES,
  NO_RELEASES,
  OF_ALL_FILES,
  ON_AVERAGE,
  ONE_RELEASE,
  RELEASED_EVERY,
  RELEASE_CADENCE,
  STABLE,
  releaseCadenceDescription,
} from './messages';

/** How often `acme/widget` was released, over its 100 latest releases. */
const CADENCE: ReleaseCadence = {
  sampled: 100,
  stable: 80,
  prereleases: 20,
  averageInterval: 12 * 24 * 60 * 60,
  assets: 240,
  downloads: 123_456,
  truncated: true,
};

describe('RepositoryReleaseCadence', () => {
  const cadence = signal<Load<ReleaseCadence>>({ status: 'loading' });
  const retry = vi.fn();
  let fixture: ComponentFixture<RepositoryReleaseCadence>;

  beforeEach(async () => {
    cadence.set({ status: 'loading' });
    retry.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RepositoryData,
          useValue: { releaseCadence: () => ({ state: cadence, retry }) },
        },
      ],
    });
    fixture = TestBed.createComponent(RepositoryReleaseCadence);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const message = () => element().querySelector('.w-state span')?.textContent;
  /** Each figure's name, then what it shows, without the tooltips of its exact value. */
  const figures = () =>
    [...element().querySelectorAll('.stat')].map((card) =>
      [...card.children].map((part) => {
        const copy = part.cloneNode(true) as Element;
        copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
        return copy.textContent?.replace(/\s+/g, ' ').trim();
      }),
    );

  async function answer(data: ReleaseCadence): Promise<void> {
    cadence.set({ status: 'ready', data });
    await fixture.whenStable();
  }

  it('tells how often it is released, how many are stable, and the downloads (FR-REPO-16)', async () => {
    expect(element().querySelector('h2')?.textContent).toBe(RELEASE_CADENCE);
    expect(element().querySelector('.figures-skel')).not.toBeNull();
    await answer(CADENCE);
    expect(figures()).toEqual([
      [RELEASED_EVERY, duration(CADENCE.averageInterval!), `${ON_AVERAGE}, of the 100 latest`],
      [STABLE, '80', 'and 20 pre-releases'],
      [DOWNLOADS, compactNumber(123_456), OF_ALL_FILES],
    ]);
    // The exact figure on hover and focus (UI-06).
    expect(element().querySelector('.stat [role="tooltip"]')?.textContent).toBe(
      exactNumber(123_456),
    );
    expect(element().querySelector('.w-sub')?.textContent?.trim()).toBe(
      releaseCadenceDescription(CADENCE),
    );
  });

  it('says what all the releases come to, when there are no more than it read', async () => {
    await answer({ ...CADENCE, sampled: 3, stable: 2, prereleases: 1, truncated: false });
    expect(figures()[0][2]).toBe(`${ON_AVERAGE}, of all releases`);
    expect(figures()[1][2]).toBe('and 1 pre-release');
  });

  it('tells no downloads of releases without files, rather than that none was downloaded', async () => {
    await answer({ ...CADENCE, assets: 0, downloads: 0 });
    expect(figures()[2]).toEqual([DOWNLOADS, NO_FIGURE, NO_FILES]);
  });

  it('tells no cadence of a single release', async () => {
    await answer({ ...CADENCE, sampled: 1, stable: 1, prereleases: 0, averageInterval: undefined });
    expect(figures()[0]).toEqual([RELEASED_EVERY, NO_FIGURE, ONE_RELEASE]);
  });

  it('says when there are no releases (FR-REPO-11)', async () => {
    await answer({ ...CADENCE, sampled: 0, stable: 0, prereleases: 0, averageInterval: undefined });
    expect(message()).toBe(NO_RELEASES);
  });

  it('says when it failed to load, and tries again (FR-REPO-09)', async () => {
    cadence.set({ status: 'error', failure: 'github' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    element().querySelector('button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
