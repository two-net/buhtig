import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { Contributors, Repository } from '../dashboard/resources';
import { compactNumber } from '../format/format';
import { Load } from '../widget/load';
import { FAILED } from '../widget/messages';
import { RepositoryContributorsTab } from './contributors';
import {
  CONTRIBUTORS_HEADERS,
  NO_CONTRIBUTORS,
  TOO_MANY_CONTRIBUTORS,
  contributorsDescription,
} from './messages';

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
          useValue: { repository, contributors: () => ({ state: contributors, retry }) },
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

  it("says GitHub doesn't list the contributors of repositories this large", async () => {
    await answer({ contributors: [], tooLarge: true, count: undefined });
    expect(element().querySelector('.w-body p.w-state')?.textContent?.trim()).toBe(
      TOO_MANY_CONTRIBUTORS,
    );
    expect(element().querySelector('.hbars, .w-sub, .w-head button')).toBeNull();
  });

  it('says when there are none (FR-REPO-11)', async () => {
    await answer({ contributors: [], tooLarge: false, count: 0 });
    expect(message()).toBe(NO_CONTRIBUTORS);
    expect(element().querySelector('.hbars, button')).toBeNull();
  });

  it('says when they failed to load, and tries again (FR-REPO-09)', async () => {
    contributors.set({ status: 'error', failure: 'github' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    element().querySelector('button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
