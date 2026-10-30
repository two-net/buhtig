import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { Commit } from '../dashboard/resources';
import { Clock } from '../format/clock';
import { relativeTime } from '../format/format';
import { Load } from '../widget/load';
import { FAILED } from '../widget/messages';
import { RepositoryCommits } from './commits';
import { NO_COMMITS, NO_MESSAGE, SEE_ACTIVITY } from './messages';

@Component({
  imports: [RepositoryCommits],
  template: `<app-repository-commits [limit]="limit()" [footer]="footer()" />`,
})
class Host {
  readonly limit = signal(10);
  readonly footer = signal(false);
}

/** The latest commits of `acme/widget`, newest first. */
const COMMITS: Commit[] = [
  {
    sha: 'abc1234def5678',
    message: 'Steady the widgets',
    author: 'alice',
    authorAvatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
    committedAt: new Date('2026-10-21T08:00:00Z'),
    url: 'https://github.com/acme/widget/commit/abc1234def5678',
  },
  {
    sha: 'def5678abc1234',
    message: undefined,
    author: 'Bob Builder',
    authorAvatarUrl: undefined,
    committedAt: undefined,
    url: undefined,
  },
  {
    sha: '0123456789abcd',
    message: 'Paint the widgets',
    author: undefined,
    authorAvatarUrl: undefined,
    committedAt: new Date('2026-10-01T08:00:00Z'),
    url: 'https://github.com/acme/widget/commit/0123456789abcd',
  },
];

describe('RepositoryCommits', () => {
  const now = new Date('2026-10-22T12:00:00Z').getTime();
  const commits = signal<Load<Commit[]>>({ status: 'loading' });
  const retry = vi.fn();
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    commits.set({ status: 'loading' });
    retry.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Clock, useValue: { now: signal(now) } },
        {
          provide: RepositoryData,
          useValue: { name: signal('acme/widget'), commits: () => ({ state: commits, retry }) },
        },
      ],
    });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...element().querySelectorAll('ul.rows > li')];
  const message = () => element().querySelector('.w-state span')?.textContent?.trim();
  const ago = (time: Date) => relativeTime(time, now);

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  async function answer(data: Commit[]): Promise<void> {
    commits.set({ status: 'ready', data });
    await fixture.whenStable();
  }

  it('lists the latest commits with their message, author, age and short SHA (FR-REPO-07)', async () => {
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Recent commits');
    expect(element().querySelector('.skel-row')).not.toBeNull();
    await answer(COMMITS);
    expect(
      rows().map((row) => [
        row.querySelector('.ttl')?.textContent,
        row.querySelector('.who')?.textContent?.trim(),
        row.querySelector('.m > span:not(.who)') &&
          shown(row.querySelector('.m > span:not(.who)')!),
        row.querySelector('.sha')?.textContent,
      ]),
    ).toEqual([
      ['Steady the widgets', 'alice', `committed ${ago(COMMITS[0].committedAt!)}`, 'abc1234'],
      // GitHub left out the message, and when.
      [NO_MESSAGE, 'Bob Builder', null, 'def5678'],
      ['Paint the widgets', undefined, `committed ${ago(COMMITS[2].committedAt!)}`, '0123456'],
    ]);
  });

  it('links each to the commit on GitHub, when GitHub says where (FR-REPO-12)', async () => {
    await answer(COMMITS);
    expect(
      rows().map((row) => [
        row.querySelector('a.ttl')?.getAttribute('href'),
        row.querySelector('a.sha')?.getAttribute('href'),
        row.querySelector('a.sha')?.getAttribute('aria-label'),
      ]),
    ).toEqual([
      [COMMITS[0].url, COMMITS[0].url, 'Commit abc1234'],
      [undefined, undefined, undefined],
      [COMMITS[2].url, COMMITS[2].url, 'Commit 0123456'],
    ]);
  });

  it("shows the author's avatar, or one drawn from their name", async () => {
    await answer(COMMITS);
    expect(rows()[0].querySelector('.who img')?.getAttribute('src')).toBe(
      COMMITS[0].authorAvatarUrl,
    );
    expect(rows()[1].querySelector('.who img')).toBeNull();
    expect(rows()[1].querySelector('.who svg.av')).not.toBeNull();
  });

  it('lists as many as it is asked to, and links to the Activity tab below them', async () => {
    fixture.componentInstance.limit.set(2);
    fixture.componentInstance.footer.set(true);
    await answer(COMMITS);
    expect(rows()).toHaveLength(2);
    const link = element().querySelector('.Box-footer a')!;
    expect([link.textContent, link.getAttribute('href')]).toEqual([
      SEE_ACTIVITY,
      '/acme/widget/activity',
    ]);
  });

  it('has no link below them unless asked', async () => {
    await answer(COMMITS);
    expect(element().querySelector('.Box-footer')).toBeNull();
  });

  it('says when there are no commits (FR-REPO-11)', async () => {
    fixture.componentInstance.footer.set(true);
    await answer([]);
    expect(message()).toBe(NO_COMMITS);
    expect(element().querySelector('ul, button, .Box-footer')).toBeNull();
  });

  it('says when they failed to load, and tries again (FR-REPO-09)', async () => {
    commits.set({ status: 'error', failure: 'github' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    element().querySelector('button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
