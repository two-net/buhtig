import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RepositoryData } from '../dashboard/data';
import { Contributors, Languages, Releases, Repository, Stats } from '../dashboard/resources';
import { Clock } from '../format/clock';
import { compactNumber, exactDay, exactTime, percent, relativeTime } from '../format/format';
import { Load } from '../widget/load';
import {
  LATEST,
  NO_CODE,
  NO_DESCRIPTION,
  OTHER,
  TOO_MANY_CONTRIBUTORS,
  languagesDescription,
} from './messages';
import { RepositorySidebar } from './sidebar';

/** A repository of which GitHub says all that the sidebar shows. */
const WIDGET: Repository = {
  name: 'acme/widget',
  ownerAvatarUrl: undefined,
  description: 'Widgets for everyone',
  visibility: 'public',
  archived: false,
  template: false,
  fork: false,
  parent: undefined,
  topics: ['widgets', 'rust'],
  license: 'MIT License',
  defaultBranch: 'main',
  homepage: 'https://widget.example/docs/',
  createdAt: new Date('2015-03-01T10:00:00Z'),
  pushedAt: new Date('2026-10-20T08:30:00Z'),
};

const STATS: Stats = {
  stars: 12_345,
  forks: 678,
  watchers: 90,
  openIssues: 0,
  openPullRequests: 0,
  latestRelease: { tag: 'v2.1.0', publishedAt: new Date('2026-10-01T12:00:00Z'), url: undefined },
};

const RELEASES: Releases = {
  releases: [
    {
      tag: 'v3.0.0-rc.1',
      name: undefined,
      publishedAt: new Date('2026-10-11T12:00:00Z'),
      prerelease: true,
      url: undefined,
      target: undefined,
    },
  ],
  count: 42,
};

const CONTRIBUTORS: Contributors = {
  contributors: [
    {
      login: 'alice',
      avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
      url: 'https://github.com/alice',
      commits: 12,
    },
    { login: 'dependabot[bot]', avatarUrl: undefined, url: undefined, commits: 1 },
  ],
  tooLarge: false,
  count: 345,
};

const LANGUAGES: Languages = {
  languages: [
    { name: 'Rust', bytes: 600 },
    { name: 'Shell', bytes: 300 },
  ],
  other: 100,
  total: 1_000,
};

describe('RepositorySidebar', () => {
  const now = new Date('2026-10-22T12:00:00Z').getTime();
  const repository = signal<Repository | undefined>(undefined);
  const stats = signal<Load<Stats>>({ status: 'loading' });
  const releases = signal<Load<Releases>>({ status: 'loading' });
  const contributors = signal<Load<Contributors>>({ status: 'loading' });
  const languages = signal<Load<Languages>>({ status: 'loading' });
  let fixture: ComponentFixture<RepositorySidebar>;

  beforeEach(async () => {
    repository.set(undefined);
    for (const part of [stats, releases, contributors, languages]) {
      part.set({ status: 'loading' });
    }
    const loader =
      <T>(state: ReturnType<typeof signal<Load<T>>>) =>
      () => ({
        state,
        retry: () => {},
      });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Clock, useValue: { now: signal(now) } },
        {
          provide: RepositoryData,
          useValue: {
            name: signal('acme/widget'),
            repository,
            stats: loader(stats),
            releases: loader(releases),
            contributors: loader(contributors),
            languages: loader(languages),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(RepositorySidebar);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const section = (heading: string) =>
    element().querySelector(`[aria-labelledby="${heading}-heading"]`)!;
  const counter = (heading: string) => words(section(heading).querySelector('h2 .counter'));

  /**
   * The words that `element` shows, apart, without the tooltips that hover and focus show, nor
   * what only assistive technology reads.
   */
  function words(element: Element | null): string | undefined {
    if (element === null) {
      return undefined;
    }
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"], .sr').forEach((hidden) => hidden.remove());
    const texts: string[] = [];
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.replace(/\s+/g, ' ').trim();
      if (text) {
        texts.push(text);
      }
    }
    return texts.join(' ');
  }

  async function ready(): Promise<void> {
    repository.set(WIDGET);
    stats.set({ status: 'ready', data: STATS });
    releases.set({ status: 'ready', data: RELEASES });
    contributors.set({ status: 'ready', data: CONTRIBUTORS });
    languages.set({ status: 'ready', data: LANGUAGES });
    await fixture.whenStable();
  }

  it('shows placeholders until the repository is known', () => {
    expect(section('about').querySelectorAll('.skel')).toHaveLength(3);
    expect(section('about').querySelector('.about, .side-list')).toBeNull();
  });

  it('says what the repository is about, with its homepage and topics (FR-REPO-01)', async () => {
    await ready();
    expect(section('about').querySelector('.about')?.textContent).toBe('Widgets for everyone');
    const homepage = section('about').querySelector('a.homelink')!;
    // Without its scheme, as GitHub shows it.
    expect([words(homepage), homepage.getAttribute('href')]).toEqual([
      'widget.example/docs',
      'https://widget.example/docs/',
    ]);
    expect([...section('about').querySelectorAll('.topics li')].map(words)).toEqual([
      'widgets',
      'rust',
    ]);
  });

  it('lists its license, figures, default branch, and when it was created and last pushed to', async () => {
    await ready();
    expect([...section('about').querySelectorAll('.side-list li')].map(words)).toEqual([
      'MIT License',
      `${compactNumber(12_345)} stars`,
      '90 watching',
      '678 forks',
      'Default branch main',
      `Created ${exactDay(WIDGET.createdAt!)}`,
      `Last push ${relativeTime(WIDGET.pushedAt!, now)}`,
    ]);
    const created = section('about').querySelector('.side-list time')!;
    expect([created.getAttribute('datetime'), created.getAttribute('title')]).toEqual([
      '2015-03-01T10:00:00.000Z',
      exactTime(WIDGET.createdAt!),
    ]);
  });

  it('says so when it has no description, and leaves out what GitHub does not say', async () => {
    repository.set({
      ...WIDGET,
      description: undefined,
      homepage: undefined,
      topics: [],
      license: undefined,
      defaultBranch: undefined,
      createdAt: undefined,
      pushedAt: undefined,
    });
    await fixture.whenStable();
    expect(section('about').querySelector('.about')?.textContent).toBe(NO_DESCRIPTION);
    expect(section('about').querySelector('.homelink, .topics, .side-list li')).toBeNull();
  });

  it('shows the latest release, and links to the others (FR-REPO-08)', async () => {
    await ready();
    const heading = section('releases').querySelector('h2 a')!;
    expect([heading.textContent, heading.getAttribute('href')]).toEqual([
      'Releases',
      '/acme/widget/releases',
    ]);
    expect(counter('releases')).toBe('42');
    // The one GitHub marks as the latest, rather than the newest.
    expect(words(section('releases').querySelector('.side-release'))).toBe(
      `v2.1.0 ${LATEST} ${exactDay(STATS.latestRelease!.publishedAt!)}`,
    );
    const more = section('releases').querySelector('a.small-link')!;
    expect([more.textContent, more.getAttribute('href')]).toEqual([
      '+ 41 releases',
      '/acme/widget/releases',
    ]);
  });

  it('shows the newest release when GitHub marks none as the latest', async () => {
    await ready();
    stats.set({ status: 'ready', data: { ...STATS, latestRelease: undefined } });
    releases.set({ status: 'ready', data: { ...RELEASES, count: 2 } });
    await fixture.whenStable();
    expect(words(section('releases').querySelector('.side-release'))).toBe(
      `v3.0.0-rc.1 ${exactDay(RELEASES.releases[0].publishedAt!)}`,
    );
    expect(section('releases').querySelector('a.small-link')?.textContent).toBe('+ 1 release');
  });

  it('says when no release is published', async () => {
    await ready();
    stats.set({ status: 'ready', data: { ...STATS, latestRelease: undefined } });
    releases.set({ status: 'ready', data: { releases: [], count: 0 } });
    await fixture.whenStable();
    expect(words(section('releases').querySelector('p'))).toBe('No releases published');
    expect(section('releases').querySelector('.side-release, .small-link')).toBeNull();
  });

  it("shows the contributors' avatars, linking to their profiles, and how many there are (FR-REPO-05)", async () => {
    await ready();
    expect(section('contributors').querySelector('h2 a')?.getAttribute('href')).toBe(
      '/acme/widget/graphs/contributors',
    );
    expect(counter('contributors')).toBe('345');
    const people = [...section('contributors').querySelectorAll('.people a')];
    expect(
      people.map((person) => [person.getAttribute('href'), person.getAttribute('aria-label')]),
    ).toEqual([
      ['https://github.com/alice', '@alice'],
      // Their profile, by their login, when GitHub does not say where.
      ['https://github.com/dependabot[bot]', '@dependabot[bot]'],
    ]);
    expect(people[0].querySelector('img')?.getAttribute('src')).toBe(
      CONTRIBUTORS.contributors[0].avatarUrl,
    );
  });

  it("says GitHub doesn't list the contributors of repositories this large, or that there are none", async () => {
    await ready();
    contributors.set({
      status: 'ready',
      data: { contributors: [], tooLarge: true, count: undefined },
    });
    await fixture.whenStable();
    expect(words(section('contributors').querySelector('p'))).toBe(TOO_MANY_CONTRIBUTORS);
    expect(counter('contributors')).toBeUndefined();

    contributors.set({ status: 'ready', data: { contributors: [], tooLarge: false, count: 0 } });
    await fixture.whenStable();
    expect(words(section('contributors').querySelector('p'))).toBe('No contributors yet');
  });

  it('shows its languages as a split bar, each with its share, Other last (FR-REPO-04)', async () => {
    await ready();
    const bar = section('languages').querySelector('app-split-bar')!;
    expect(
      [...bar.querySelectorAll('.legend li')].map((item) => [
        item.querySelector('.nm')?.textContent,
        item.querySelector('.pc')?.textContent,
        item.querySelector<HTMLElement>('.sw')?.style.background,
      ]),
    ).toEqual([
      ['Rust', percent(0.6), 'var(--s1)'],
      ['Shell', percent(0.3), 'var(--s2)'],
      [OTHER, percent(0.1), 'var(--s-other)'],
    ]);
    expect(bar.querySelector('.stack')?.getAttribute('aria-label')).toBe(
      languagesDescription([
        { name: 'Rust', share: 0.6 },
        { name: 'Shell', share: 0.3 },
      ]),
    );
  });

  it('says when there is no code', async () => {
    await ready();
    languages.set({ status: 'ready', data: { languages: [], other: 0, total: 0 } });
    await fixture.whenStable();
    expect(section('languages').querySelector('app-split-bar')).toBeNull();
    expect(section('languages').querySelector('p')?.textContent).toBe(NO_CODE);
  });
});
