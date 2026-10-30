import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Mock } from 'vitest';
import { OrganizationData } from '../dashboard/data';
import {
  LanguageCounts,
  LastPush,
  ListedRepository,
  Members,
  OrganizationStats,
  TopRepository,
  YearCount,
} from '../dashboard/resources';
import { compactNumber } from '../format/format';
import { FAILED } from '../widget/messages';
import { Load, Loader } from '../widget/load';
import {
  ALL_REPOSITORIES,
  NO_DESCRIPTION,
  NO_LANGUAGES,
  NO_REPOSITORIES,
  NO_STARRED,
  PUBLIC_ONLY,
  VISIBLE_TO_YOU,
  createdDescription,
  hiddenCount,
  languagesDescription,
  pushedLast,
  repositoryCount,
  topRepositoriesDescription,
  truncated,
} from './messages';
import { OrganizationOverview } from './overview';

/** A loader whose state each test sets, as the dashboard's would come to. */
interface Stub<T> extends Loader<T> {
  readonly state: WritableSignal<Load<T>>;
  readonly retry: Mock<() => void>;
}

function stub<T>(): Stub<T> {
  return { state: signal<Load<T>>({ status: 'loading' }), retry: vi.fn() };
}

/** What the organization's dashboard would know of `acme`, part by part. */
class Data {
  readonly login = signal('acme');
  readonly displayName = signal('Acme Corp');
  readonly loaders = {
    stats: stub<OrganizationStats>(),
    repositories: stub<ListedRepository[]>(),
    languages: stub<LanguageCounts>(),
    topRepositories: stub<TopRepository[]>(),
    lastPush: stub<LastPush>(),
    createdPerYear: stub<YearCount[]>(),
    members: stub<Members>(),
  };
  readonly stats = () => this.loaders.stats;
  readonly repositories = () => this.loaders.repositories;
  readonly languages = () => this.loaders.languages;
  readonly topRepositories = () => this.loaders.topRepositories;
  readonly lastPush = () => this.loaders.lastPush;
  readonly createdPerYear = () => this.loaders.createdPerYear;
  readonly members = () => this.loaders.members;
  readonly languageColor = signal((language: string) =>
    language === 'TypeScript' ? 'var(--s1)' : language === 'Rust' ? 'var(--s2)' : 'var(--s-other)',
  );
}

const STATS: OrganizationStats = {
  repositories: 312,
  private: 0,
  internal: 0,
  stars: 98_765,
  forks: 410,
  openIssuesAndPullRequests: 57,
  topLanguage: 'TypeScript',
  truncated: false,
};

/** A repository of `acme` named `name`, with `details` in place of the plainest. */
function repository(name: string, details: Partial<ListedRepository> = {}): ListedRepository {
  return {
    name,
    path: `/acme/${name}`,
    description: undefined,
    language: undefined,
    stars: 0,
    forks: 0,
    openIssuesAndPullRequests: 0,
    pushedAt: undefined,
    fork: false,
    archived: false,
    visibility: 'public',
    topics: [],
    ...details,
  };
}

/** What stands in for the browser's IntersectionObserver, which sees nothing come into view. */
class Unseeing {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

describe('OrganizationOverview', () => {
  let fixture: ComponentFixture<OrganizationOverview>;
  let http: HttpTestingController;
  let data: Data;

  beforeEach(async () => {
    // So that the rows' sparklines load nothing, which `repository-row.spec.ts` tests.
    vi.stubGlobal('IntersectionObserver', Unseeing);
    data = new Data();
    TestBed.configureTestingModule({
      imports: [OrganizationOverview],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OrganizationData, useValue: data },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OrganizationOverview);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  /** The text that `element` shows, without what only assistive technology or hover reads. */
  const shown = (element: Element | null) => {
    if (element === null) {
      return undefined;
    }
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"], .sr').forEach((hidden) => hidden.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  };
  const pulse = () => element().querySelector('app-organization-pulse section')!;
  /** The stat cards, as what each is of, its figure, and what it says below, if anything. */
  const stats = () =>
    [...pulse().querySelectorAll('.stat')].map((stat) => [
      shown(stat.querySelector('dt')),
      shown(stat.querySelector('.val')),
      shown(stat.querySelector('.sub')),
    ]);
  /** The widget headed `heading`. */
  const widget = (heading: string) =>
    [...element().querySelectorAll('app-widget')].find(
      (widget) => widget.querySelector('h2')?.textContent?.trim() === heading,
    )!;
  /** The bars of the chart in `within`, as their labels and figures. */
  const bars = (within: Element) =>
    [...within.querySelectorAll('.hbars li')].map((bar) => [
      bar.querySelector('.lab')!.textContent?.trim(),
      bar.querySelector('b')!.textContent?.trim(),
    ]);
  const notice = () => element().querySelector('.notice[role="status"]');
  const side = () => element().querySelector('aside')!;
  const section = (heading: string) =>
    element().querySelector(`section[aria-labelledby="${heading}"]`);

  /** Has the part `part` loaded with `data`. */
  async function ready<K extends keyof Data['loaders']>(
    part: K,
    value: Data['loaders'][K] extends Stub<infer T> ? T : never,
  ): Promise<void> {
    (data.loaders[part].state as WritableSignal<Load<unknown>>).set({
      status: 'ready',
      data: value,
    });
    await fixture.whenStable();
  }

  async function failed(part: keyof Data['loaders']): Promise<void> {
    (data.loaders[part].state as WritableSignal<Load<unknown>>).set({
      status: 'error',
      failure: 'github',
    });
    await fixture.whenStable();
  }

  describe('stat cards', () => {
    it('stand in their place until the figures are there', () => {
      expect(pulse().querySelector('.pulse-skel')).not.toBeNull();
      expect(pulse().querySelector('dl')).toBeNull();
      expect(pulse().querySelector('h2')!.textContent).toBe('Overview');
    });

    it("show the organization's figures, over the repositories the viewer may see (FR-ORG-02)", async () => {
      await ready('stats', STATS);
      expect(pulse().querySelector('.Box-header .muted')!.textContent?.trim()).toBe(
        ALL_REPOSITORIES,
      );
      expect(stats()).toEqual([
        ['Repositories', '312', PUBLIC_ONLY],
        ['Total stars', compactNumber(98_765), undefined],
        ['Total forks', '410', undefined],
        ['Open issues and PRs', '57', undefined],
        ['Top language', 'TypeScript', undefined],
        ['Members', '–', undefined],
      ]);
      // The figure in full, on hover and for assistive technology.
      expect(
        pulse().querySelectorAll('.stat')[1].querySelector('[role="tooltip"]')!.textContent,
      ).toBe('98,765');
    });

    it('say how many of the repositories are private or internal (FR-ORG-09)', async () => {
      await ready('stats', { ...STATS, private: 3, internal: 2 });
      expect(stats()[0]).toEqual(['Repositories', '312', hiddenCount(5)]);
      expect(hiddenCount(5)).toBe('5 private or internal');
    });

    it('say how many repositories have the top language, once the languages are there', async () => {
      await ready('stats', STATS);
      await ready('languages', {
        languages: [
          { name: 'TypeScript', repositories: 42 },
          { name: 'Rust', repositories: 7 },
        ],
        other: 3,
      });
      expect(stats()[4]).toEqual(['Top language', 'TypeScript', repositoryCount(42)]);
      expect(repositoryCount(42)).toBe('42 repositories');
    });

    it('say when no repository has a primary language', async () => {
      await ready('stats', { ...STATS, topLanguage: undefined });
      await ready('languages', { languages: [], other: 0 });
      expect(stats()[4]).toEqual(['Top language', 'None', undefined]);
    });

    it('count the members the viewer may see, once they are there', async () => {
      await ready('stats', STATS);
      await ready('members', { count: 24, members: [] });
      expect(stats()[5]).toEqual(['Members', '24', VISIBLE_TO_YOU]);
    });

    it('say when their figures are of the repositories pushed to last (FR-ORG-08)', async () => {
      await ready('stats', { ...STATS, repositories: 1_000, truncated: true });
      expect(pulse().querySelector('.Box-header .muted')!.textContent?.trim()).toBe(
        pushedLast(1_000),
      );
      expect(pushedLast(1_000)).toBe('Most recently pushed 1,000');
    });

    it('say when their figures could not be loaded, and try again', async () => {
      await failed('stats');
      expect(pulse().querySelector('dl')).toBeNull();
      expect(pulse().querySelector('.w-state')!.textContent).toContain(FAILED);
      const button = pulse().querySelector('button')!;
      expect(button.textContent?.trim()).toBe('Try again');
      button.click();
      expect(data.loaders.stats.retry).toHaveBeenCalledOnce();
    });
  });

  it('says when the organization has more repositories than BuhTig reads (FR-ORG-08)', async () => {
    await ready('stats', STATS);
    expect(notice()).toBeNull();
    await ready('stats', { ...STATS, repositories: 1_000, truncated: true });
    expect(notice()!.textContent?.trim()).toBe(truncated('Acme Corp', 1_000));
    expect(truncated('Acme Corp', 1_000)).toBe(
      'Acme Corp has more than 1,000 repositories. Figures cover the 1,000 most recently pushed.',
    );
    // Above the figures it is of.
    expect(notice()!.nextElementSibling!.tagName.toLowerCase()).toBe('app-organization-pulse');
  });

  describe('popular repositories', () => {
    const cards = () =>
      [...element().querySelectorAll('app-repository-card')].map(
        (card) => card.querySelector('.c-head a')!.textContent,
      );

    it('show the 6 with the most stars, as cards, those with as many by name (FR-ORG-05)', async () => {
      await ready('repositories', [
        repository('a', { stars: 5 }),
        repository('b', { stars: 50 }),
        repository('c', { stars: 10 }),
        repository('d', { stars: 10 }),
        repository('e', { stars: 1 }),
        repository('f', { stars: 70 }),
        repository('g', { stars: 0 }),
        repository('h', { stars: 9 }),
      ]);
      expect(element().querySelector('#popular-heading')!.textContent).toBe('Popular repositories');
      expect(cards()).toEqual(['f', 'b', 'c', 'd', 'h', 'a']);
      expect(element().querySelector('app-repository-card p')!.textContent?.trim()).toBe(
        NO_DESCRIPTION,
      );
    });

    it('are not there while there are none', async () => {
      expect(section('popular-heading')).toBeNull();
      await ready('repositories', []);
      expect(section('popular-heading')).toBeNull();
    });
  });

  describe('most-starred repositories', () => {
    it('show as bars, each leading to its dashboard (FR-ORG-05)', async () => {
      await ready('topRepositories', [
        { name: 'rocket', path: '/acme/rocket', stars: 12_345 },
        { name: 'widget', path: '/acme/widget', stars: 678 },
      ]);
      const chart = widget('Most-starred repositories');
      expect(bars(chart)).toEqual([
        ['rocket', compactNumber(12_345)],
        ['widget', '678'],
      ]);
      expect(
        [...chart.querySelectorAll('.hbars a')].map((link) => link.getAttribute('href')),
      ).toEqual(['/acme/rocket', '/acme/widget']);
      expect(chart.querySelector('.w-sub')!.textContent?.trim()).toBe(
        topRepositoriesDescription('rocket', 12_345),
      );
      expect(topRepositoriesDescription('rocket', 12_345)).toBe(
        'rocket has the most stars, 12,345.',
      );
      expect(chart.querySelector('.hbars')!.getAttribute('aria-label')).toBe(
        topRepositoriesDescription('rocket', 12_345),
      );
    });

    it('say when none has stars', async () => {
      await ready('topRepositories', []);
      expect(widget('Most-starred repositories').textContent).toContain(NO_STARRED);
    });

    it('show as a table on request (NFR-UX-04)', async () => {
      await ready('topRepositories', [{ name: 'rocket', path: '/acme/rocket', stars: 12_345 }]);
      const chart = widget('Most-starred repositories');
      const toggle = chart.querySelector<HTMLButtonElement>('.w-head button')!;
      toggle.click();
      await fixture.whenStable();
      expect(
        [...chart.querySelectorAll('tbody tr')].map((row) =>
          [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.trim()),
        ),
      ).toEqual([['rocket', '12,345']]);
    });
  });

  describe('last push', () => {
    it('shows how many repositories were last pushed to in each period (FR-ORG-06)', async () => {
      await ready('lastPush', { last7Days: 12, last30Days: 30, last12Months: 100, older: 170 });
      expect(bars(widget('Last push'))).toEqual([
        ['Last 7 days', '12'],
        ['Last 30 days', '30'],
        ['Last 12 months', '100'],
        ['Older', '170'],
      ]);
    });

    it('says when there are no repositories', async () => {
      await ready('lastPush', { last7Days: 0, last30Days: 0, last12Months: 0, older: 0 });
      expect(widget('Last push').textContent).toContain(NO_REPOSITORIES);
      expect(widget('Last push').querySelector('.hbars')).toBeNull();
    });
  });

  describe('repositories created per year', () => {
    const chart = () => widget('Repositories created per year');
    const ticks = () =>
      [...chart().querySelectorAll('.xaxis span')].map((tick) => [
        tick.textContent?.trim(),
        tick.classList.contains('minor'),
      ]);

    it('shows a column for each year, with its figure on top (FR-ORG-06)', async () => {
      const years = [
        { year: 2019, repositories: 4 },
        { year: 2020, repositories: 12 },
        { year: 2021, repositories: 7 },
      ];
      await ready('createdPerYear', years);
      expect(chart().querySelectorAll('.col')).toHaveLength(3);
      expect([...chart().querySelectorAll('.col b')].map((cap) => cap.textContent)).toEqual([
        '4',
        '12',
        '7',
      ]);
      expect(ticks()).toEqual([
        ['2019', false],
        ['2020', false],
        ['2021', false],
      ]);
      expect(chart().querySelector('.w-sub')!.textContent?.trim()).toBe(createdDescription(years));
      expect(createdDescription(years)).toBe(
        '23 repositories created since 2019. The busiest year was 2020, with 12 repositories.',
      );
    });

    it('shortens the years when there are many, and makes every other one minor when more', async () => {
      await ready(
        'createdPerYear',
        Array.from({ length: 9 }, (_, i) => ({ year: 2010 + i, repositories: i })),
      );
      expect(ticks().slice(0, 3)).toEqual([
        ['’10', false],
        ['’11', true],
        ['’12', false],
      ]);
      await ready(
        'createdPerYear',
        Array.from({ length: 7 }, (_, i) => ({ year: 2010 + i, repositories: i })),
      );
      expect(ticks().slice(0, 2)).toEqual([
        ['’10', false],
        ['’11', false],
      ]);
    });

    it('says when there are no repositories', async () => {
      await ready('createdPerYear', []);
      expect(chart().textContent).toContain(NO_REPOSITORIES);
    });
  });

  describe('recently pushed', () => {
    const box = () => section('recent-heading')!;
    const rows = () =>
      [...box().querySelectorAll('app-repository-row')].map(
        (row) => row.querySelector('h3 a')!.textContent,
      );

    it('lists the 5 repositories pushed to last, as the server lists them', async () => {
      expect(box().querySelector('.skel')).not.toBeNull();
      await ready(
        'repositories',
        ['f', 'e', 'd', 'c', 'b', 'a'].map((name) => repository(name)),
      );
      expect(box().querySelector('h2')!.textContent).toBe('Recently pushed');
      expect(rows()).toEqual(['f', 'e', 'd', 'c', 'b']);
      expect(box().querySelector('.skel')).toBeNull();
    });

    it('leads to all of the repositories', () => {
      const link = box().querySelector('.Box-header a')!;
      expect([link.textContent?.trim(), link.getAttribute('href')]).toEqual([
        'View all repositories',
        '/orgs/acme/repositories',
      ]);
    });

    it('says when there are none, and shows nothing when they could not be loaded', async () => {
      await ready('repositories', []);
      expect(box().querySelector('p')!.textContent?.trim()).toBe(NO_REPOSITORIES);
      await failed('repositories');
      expect(box().querySelector('p, ul, .skel')).toBeNull();
    });
  });

  describe('people', () => {
    const people = () => section('people-heading')!;
    const members = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        login: `member-${i}`,
        avatarUrl: `https://avatars.githubusercontent.com/u/${i}`,
        url: i === 0 ? undefined : `https://github.com/member-${i}?tab=profile`,
      }));

    it('shows up to 18 of the members, each leading to their profile (FR-ORG-07)', async () => {
      const heading = people().querySelector('h2 a')!;
      expect([heading.textContent?.trim(), heading.getAttribute('href')]).toEqual([
        'People',
        '/orgs/acme/people',
      ]);
      expect(people().querySelector('ul')).toBeNull();

      await ready('members', { count: 40, members: members(24) });
      expect(shown(people().querySelector('.counter'))).toBe('40');
      const links = [...people().querySelectorAll('.people a')];
      expect(links).toHaveLength(18);
      expect(links.slice(0, 2).map((link) => link.getAttribute('href'))).toEqual([
        'https://github.com/member-0',
        'https://github.com/member-1?tab=profile',
      ]);
      expect(links[1].getAttribute('aria-label')).toBe('@member-1');
      expect(links[1].querySelector('img')!.getAttribute('src')).toBe(
        'https://avatars.githubusercontent.com/u/1',
      );
      const all = people().querySelector('.small-link')!;
      expect([all.textContent?.trim(), all.getAttribute('href')]).toEqual([
        'View all',
        '/orgs/acme/people',
      ]);
    });
  });

  describe('top languages', () => {
    const languages = () => section('languages-heading')!;

    it("show how many repositories have each primary language, in the dashboard's colors (FR-ORG-04)", async () => {
      await ready('languages', {
        languages: [
          { name: 'TypeScript', repositories: 42 },
          { name: 'Rust', repositories: 7 },
          { name: 'Go', repositories: 2 },
        ],
        other: 3,
      });
      expect(bars(languages())).toEqual([
        ['TypeScript', '42'],
        ['Rust', '7'],
        ['Go', '2'],
        ['Other', '3'],
      ]);
      expect(
        [...languages().querySelectorAll<HTMLElement>('.track i')].map(
          (bar) => bar.style.background,
        ),
      ).toEqual(['var(--s1)', 'var(--s2)', 'var(--s-other)', 'var(--s-other)']);
      expect(languages().querySelector('.hbars')!.getAttribute('aria-label')).toBe(
        languagesDescription({ name: 'TypeScript', repositories: 42 }, 54),
      );
      expect(languagesDescription({ name: 'TypeScript', repositories: 42 }, 54)).toBe(
        'TypeScript is the most common primary language, in 42 of the 54 repositories that have one.',
      );
    });

    it('leave out "Other" when there is none', async () => {
      await ready('languages', { languages: [{ name: 'Rust', repositories: 7 }], other: 0 });
      expect(bars(languages())).toEqual([['Rust', '7']]);
    });

    it('say when no language was detected', async () => {
      expect(languages().querySelector('p, .hbars')).toBeNull();
      await ready('languages', { languages: [], other: 0 });
      expect(languages().querySelector('p')!.textContent?.trim()).toBe(NO_LANGUAGES);
    });
  });

  describe('most used topics', () => {
    const topics = () =>
      [...element().querySelectorAll('.topics .topic-tag')].map((topic) => topic.textContent);

    it('show the 8 topics of the most repositories, those of as many by name', async () => {
      await ready('repositories', [
        repository('a', { topics: ['web', 'api', 'cli'] }),
        repository('b', { topics: ['web', 'api', 'zeta'] }),
        repository('c', { topics: ['web', 'alpha', 'beta', 'gamma', 'delta', 'eta', 'theta'] }),
      ]);
      expect(section('topics-heading')!.querySelector('h2')!.textContent).toBe('Most used topics');
      expect(topics()).toEqual(['web', 'api', 'alpha', 'beta', 'cli', 'delta', 'eta', 'gamma']);
    });

    it('are not there when no repository has a topic', async () => {
      await ready('repositories', [repository('a')]);
      expect(section('topics-heading')).toBeNull();
    });
  });
});
