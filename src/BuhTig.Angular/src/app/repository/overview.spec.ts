import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { Commit } from '../dashboard/resources';
import { RepositoryOverview } from './overview';

describe('RepositoryOverview', () => {
  it('shows the stat cards, commit activity, 5 latest commits and recent issues, beside the sidebar', async () => {
    const commits: Commit[] = Array.from({ length: 10 }, (_, index) => ({
      sha: `${index}`.padStart(7, '0'),
      message: `Commit ${index}`,
      author: undefined,
      authorAvatarUrl: undefined,
      committedAt: undefined,
      url: undefined,
    }));
    const ready =
      <T>(data: T) =>
      () => ({
        state: signal({ status: 'ready' as const, data }),
        retry: () => {},
      });
    // Each part loading, but the commits.
    const loading = () => ({ state: signal({ status: 'loading' as const }), retry: () => {} });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RepositoryData,
          useValue: {
            name: signal('acme/widget'),
            repository: signal(undefined),
            stats: loading,
            activity: loading,
            languages: loading,
            contributors: loading,
            issues: loading,
            releases: loading,
            commits: ready(commits),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(RepositoryOverview);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      [...element.querySelectorAll('.layout > *, .layout > .stack-v > *')].map((child) =>
        child.tagName.toLowerCase(),
      ),
    ).toEqual([
      'div',
      'app-repository-pulse',
      'app-repository-activity',
      'app-repository-commits',
      'app-repository-recent-issues',
      'app-repository-sidebar',
    ]);
    expect(element.querySelectorAll('app-repository-commits li')).toHaveLength(5);
    expect(
      element.querySelector('app-repository-commits .Box-footer a')?.getAttribute('href'),
    ).toBe('/acme/widget/activity');
  });
});
