import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MockInstance } from 'vitest';
import { routes } from '../app.routes';
import { TITLES } from '../messages';
import { NOT_FOUND_OR_PRIVATE, OPEN_ON_GITHUB, notFoundForVisitor } from '../dashboard/messages';
import { Clock } from '../format/clock';
import { Announcer } from '../live/announcer';
import { exactNumber, percent, signedCompactNumber, weekDate } from '../format/format';
import { truncated } from '../organization/messages';
import { Toasts } from '../toast/toasts';
import {
  IN_OTHER,
  NO_FIGURE,
  activityComparison,
  bothSides,
  comparisonLoaded,
  lastPushComparison,
  moreThan,
  sideCreated,
  sideLanguages,
} from './messages';

describe('Comparison', () => {
  const now = new Date('2026-10-22T12:04:30Z').getTime();
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let navigateByUrl: MockInstance<Router['navigateByUrl']>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(now) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    http.match('/-/api/session');
    // A comparison is no dashboard: it goes in no history, and is pinned to nothing
    // (FR-CMP-05).
    http.expectNone((request) => request.method === 'POST' && request.url.endsWith('/view'));
    http.expectNone('/-/api/shortcuts');
    http.verify();
  });

  const page = () => harness.routeNativeElement!;
  const main = () => page().querySelector('main')!;
  const title = () => TestBed.inject(Title).getTitle();
  /** Where the comparison moved itself to, in place of the URL it was at. */
  const moves = () =>
    navigateByUrl.mock.calls.filter(([, extras]) => extras?.replaceUrl).map(([url]) => `${url}`);
  /** Whether `request` is for a part of a repository or an account, such as its stats. */
  const isPart = (request: HttpRequest<unknown>) =>
    request.method === 'GET' &&
    /^\/-\/api\/(repositories\/[^/]+\/[^/]+|organizations\/[^/]+|users\/[^/]+)\/[^/]+$/.test(
      request.url,
    );

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"], .sr').forEach((hidden) => hidden.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** The widget headed `heading`. */
  function widget(heading: string): HTMLElement {
    const found = [...page().querySelectorAll<HTMLElement>('app-widget')].find(
      (widget) => widget.querySelector('h2')?.textContent?.trim() === heading,
    );
    expect(found, heading).toBeDefined();
    return found!;
  }

  /** The table of the widget headed `heading`, once "Show table" shows it, row by row. */
  async function table(heading: string): Promise<string[][]> {
    widget(heading).querySelector<HTMLButtonElement>('.w-head button')!.click();
    await harness.fixture.whenStable();
    return [...widget(heading).querySelectorAll('tr')].map((row) =>
      [...row.querySelectorAll('th, td')].map((cell) => cell.textContent!.trim()),
    );
  }

  const WIDGET = {
    name: 'acme/widget',
    fetched_at: '2026-10-22T12:00:00.000Z',
    description: 'Widgets for everyone',
    visibility: 'public',
    default_branch: 'main',
    owner_avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
  };
  const GADGET = {
    name: 'umbrella/gadget',
    fetched_at: '2026-10-22T11:00:00.000Z',
    visibility: 'private',
  };

  /** What the server says of each part of each repository, by its URL. */
  const REPOSITORY_PARTS: Record<string, object> = {
    '/-/api/repositories/acme/widget/stats': {
      stars: 12_345,
      forks: 40,
      watchers: 7,
      open_issues: 3,
      open_pull_requests: 1,
      latest_release: null,
    },
    '/-/api/repositories/umbrella/gadget/stats': {
      stars: 8_245,
      forks: 41,
      watchers: 7,
      open_issues: 0,
      open_pull_requests: 1,
      latest_release: null,
    },
    '/-/api/repositories/acme/widget/commit-activity': {
      weeks: [
        { week: '2026-10-11', commits: 4 },
        { week: '2026-10-18', commits: 6 },
      ],
    },
    '/-/api/repositories/umbrella/gadget/commit-activity': {
      weeks: [{ week: '2026-10-18', commits: 30 }],
    },
    '/-/api/repositories/acme/widget/languages': {
      languages: [{ name: 'Rust', bytes: 900 }],
      other: 100,
    },
    '/-/api/repositories/umbrella/gadget/languages': {
      languages: [
        { name: 'Go', bytes: 600 },
        { name: 'Rust', bytes: 400 },
      ],
      other: 0,
    },
  };

  /** Answers each part asked for since, from `parts`, and says which were asked for. */
  async function answerParts(parts: Record<string, object>): Promise<string[]> {
    // Not those the comparison no longer waits for, having moved to others.
    const asked = http.match(isPart).flatMap((request) => {
      if (request.cancelled) {
        return [];
      }
      const url = request.request.url;
      expect(parts[url], url).toBeDefined();
      request.flush(parts[url]);
      return [url];
    });
    await harness.fixture.whenStable();
    return asked.sort();
  }

  /** Opens `url`, and answers what the server says of the two repositories. */
  async function open(
    url: string,
    first: [string, object] = ['/-/api/repositories/acme/widget', WIDGET],
    second: [string, object] = ['/-/api/repositories/umbrella/gadget', GADGET],
  ): Promise<void> {
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
    for (const [request, answer] of [first, second]) {
      http.expectOne(request).flush(answer);
    }
    await harness.fixture.whenStable();
  }

  it('shows two repositories side by side, in a page titled after both (UI-04)', async () => {
    await harness.navigateByUrl('/-/compare/acme/widget...umbrella/gadget');
    expect(title()).toBe('acme/widget vs umbrella/gadget · BuhTig');
    expect(main().getAttribute('aria-busy')).toBe('true');
    expect(page().querySelectorAll('.cmp-head-skel')).toHaveLength(2);
    // The breadcrumb of the comparison, and the search box for any dashboard.
    expect(
      [...page().querySelectorAll('.crumbs a')].map((crumb) => [
        crumb.textContent?.trim(),
        crumb.getAttribute('href'),
      ]),
    ).toEqual([['Compare', '/-/compare/acme/widget...umbrella/gadget']]);
    expect(page().querySelector<HTMLInputElement>('header input')!.value).toBe('');

    http.expectOne('/-/api/repositories/acme/widget').flush(WIDGET);
    http.expectOne('/-/api/repositories/umbrella/gadget').flush(GADGET);
    await harness.fixture.whenStable();
    expect(main().getAttribute('aria-busy')).toBe('false');
    expect(shown(page().querySelector('h1')!)).toBe('acme/widget vs umbrella/gadget');

    const heads = [...page().querySelectorAll('app-compare-head')];
    expect(heads.map((head) => head.querySelector('section')!.getAttribute('aria-label'))).toEqual([
      'acme/widget',
      'umbrella/gadget',
    ]);
    expect(
      heads.map((head) => [
        head.querySelector('.cmp-name')!.getAttribute('href'),
        shown(head.querySelector('.label')!),
        head.querySelector('.cmp-desc')?.textContent,
      ]),
    ).toEqual([
      ['/acme/widget', 'Public', 'Widgets for everyone'],
      ['/umbrella/gadget', 'Private', undefined],
    ]);
    // When each one's data was fetched (FR-DATA-06), and its page on GitHub, but no Refresh or
    // Pin: a comparison is no dashboard (FR-CMP-05).
    expect(heads.map((head) => head.querySelector('time')?.getAttribute('datetime'))).toEqual([
      WIDGET.fetched_at,
      GADGET.fetched_at,
    ]);
    expect(
      heads.map((head) => {
        const link = head.querySelector('a.btn')!;
        return [shown(link), link.getAttribute('href')];
      }),
    ).toEqual([
      [OPEN_ON_GITHUB, 'https://github.com/acme/widget'],
      [OPEN_ON_GITHUB, 'https://github.com/umbrella/gadget'],
    ]);
    expect(page().querySelector('app-refresh, app-pin')).toBeNull();
    expect(TestBed.inject(Toasts).toasts()).toEqual([]);

    expect(await answerParts(REPOSITORY_PARTS)).toEqual(Object.keys(REPOSITORY_PARTS).sort());
  });

  it('shows each figure of both, and marks the one with more by how much (FR-CMP-03)', async () => {
    await open('/-/compare/acme/widget...umbrella/gadget');
    await answerParts(REPOSITORY_PARTS);
    const cards = [...page().querySelectorAll('.cmp-stat')];
    const card = (label: string) =>
      cards.find((card) => shown(card.querySelector('dt')!) === label)!;
    expect(cards.map((card) => shown(card.querySelector('dt')!))).toEqual([
      'Stars',
      'Forks',
      'Watching',
      'Open issues',
      'Open pull requests',
      'Latest release',
    ]);

    // The first's figure on the left, as its head is, and each said with its side's name.
    const stars = card('Stars');
    const values = [...stars.querySelectorAll('.cmp-val')];
    expect(values.map((value) => value.querySelector('.sr')!.textContent)).toEqual([
      'acme/widget: ',
      'umbrella/gadget: ',
    ]);
    // The one with more is marked with an arrow and by how much, beside its figure, and
    // assistive technology reads which, in a sentence.
    expect(values.map((value) => value.querySelector('.cmp-delta app-icon') !== null)).toEqual([
      true,
      false,
    ]);
    expect(shown(values[0].querySelector('.cmp-delta')!)).toBe(signedCompactNumber(4_100));
    expect(stars.querySelector('dd.sr')!.textContent).toBe(
      moreThan('stars', 'acme/widget', 4_100, 'umbrella/gadget'),
    );
    const forks = [...card('Forks').querySelectorAll('.cmp-val')];
    expect(forks.map((value) => value.querySelector('.cmp-delta') !== null)).toEqual([false, true]);
    // The same, as the same.
    expect(shown(card('Watching').querySelector('.cmp-delta.same')!)).toBe('Same');
    const releases = card('Latest release');
    expect([...releases.querySelectorAll('.cmp-val .val')].map((value) => shown(value))).toEqual([
      'None',
      'None',
    ]);
    // Without releases, which is newer is no question.
    expect(releases.querySelector('.cmp-delta, dd.sr')).toBeNull();
  });

  it("charts both repositories' commit activity against one scale, with a table (FR-CMP-04)", async () => {
    await open('/-/compare/acme/widget...umbrella/gadget');
    await answerParts(REPOSITORY_PARTS);
    const activity = widget('Commit activity');
    expect(activity.querySelector('.w-sub')!.textContent?.trim()).toBe(
      activityComparison('acme/widget', { weeks: [], total: 10 }, 'umbrella/gadget', {
        weeks: [],
        total: 30,
      }),
    );
    const charts = [...activity.querySelectorAll('figure')];
    expect(charts.map((chart) => shown(chart.querySelector('figcaption')!))).toEqual([
      'acme/widget 10 commits',
      'umbrella/gadget 30 commits',
    ]);
    // Both reach as high, though the first's busiest week has 6 commits.
    const tops = charts.map((chart) =>
      [...chart.querySelectorAll('.gl span')].map((line) => line.textContent?.trim()).pop(),
    );
    expect(tops).toEqual(['50', '50']);
    expect(await table('Commit activity')).toEqual([
      ['Week of', 'acme/widget', 'umbrella/gadget'],
      [weekDate(new Date('2026-10-18')), '6', '30'],
      [weekDate(new Date('2026-10-11')), '4', NO_FIGURE],
    ]);
  });

  it("shows both repositories' languages in the same colors, with a table (FR-CMP-04)", async () => {
    await open('/-/compare/acme/widget...umbrella/gadget');
    await answerParts(REPOSITORY_PARTS);
    const languages = widget('Languages');
    const bars = [...languages.querySelectorAll('app-split-bar')];
    expect(bars.map((bar) => bar.querySelector('.sublabel')!.textContent)).toEqual([
      'acme/widget',
      'umbrella/gadget',
    ]);
    const colors = (bar: Element) =>
      Object.fromEntries(
        [...bar.querySelectorAll('.legend li')].map((item) => [
          item.querySelector('.nm')!.textContent,
          item.querySelector<HTMLElement>('.sw')!.getAttribute('style'),
        ]),
      );
    expect(colors(bars[0])['Rust']).toBe(colors(bars[1])['Rust']);
    expect(colors(bars[0])['Rust']).not.toBe(colors(bars[1])['Go']);
    expect(languages.querySelector('.w-sub')!.textContent?.trim()).toBe(
      bothSides(
        sideLanguages('repository', 'acme/widget', { name: 'Rust', share: 0.9 }),
        sideLanguages('repository', 'umbrella/gadget', { name: 'Go', share: 0.6 }),
      ),
    );
    expect(await table('Languages')).toEqual([
      ['Language', 'acme/widget', 'umbrella/gadget'],
      ['Rust', percent(0.9), percent(0.4)],
      // The first counts Go in "Other", if it has any.
      ['Go', IN_OTHER, percent(0.6)],
      ['Other', percent(0.1), percent(0)],
    ]);
  });

  it('moves to the URL that spells the names as GitHub does, and asks nothing again (FR-CMP-01)', async () => {
    await open(
      '/-/compare/ACME/Widget...umbrella/GADGET',
      ['/-/api/repositories/ACME/Widget', WIDGET],
      ['/-/api/repositories/umbrella/GADGET', GADGET],
    );
    expect(moves()).toEqual(['/-/compare/acme/widget...umbrella/gadget']);
    expect(title()).toBe('acme/widget vs umbrella/gadget · BuhTig');
    http.expectNone('/-/api/repositories/acme/widget');
    http.expectNone('/-/api/repositories/umbrella/gadget');
    await answerParts(REPOSITORY_PARTS);
  });

  it('follows a repository that was renamed, and says so (FR-NAV-05)', async () => {
    await open('/-/compare/acme/old...umbrella/gadget', ['/-/api/repositories/acme/old', WIDGET]);
    expect(moves()).toEqual(['/-/compare/acme/widget...umbrella/gadget']);
    expect(
      TestBed.inject(Toasts)
        .toasts()
        .map((toast) => toast.message),
    ).toEqual(['acme/old was renamed. Showing acme/widget.']);
    // The comparison asks of the renamed repository by its new name.
    http.expectOne('/-/api/repositories/acme/widget').flush(WIDGET);
    await harness.fixture.whenStable();
    await answerParts(REPOSITORY_PARTS);
  });

  it('says once both have loaded, for assistive technology (NFR-UX-02)', async () => {
    const announce = vi.spyOn(TestBed.inject(Announcer), 'announce');
    await open('/-/compare/acme/widget...umbrella/gadget');
    expect(announce).toHaveBeenCalledExactlyOnceWith(
      comparisonLoaded('acme/widget', 'umbrella/gadget'),
    );
    await answerParts(REPOSITORY_PARTS);
    expect(announce).toHaveBeenCalledOnce();
  });

  it('shows nothing of either when GitHub says one is not there (FR-ACC-05)', async () => {
    await harness.navigateByUrl('/-/compare/acme/widget...umbrella/secret');
    http.expectOne('/-/api/session').flush({ user: null });
    http.expectOne('/-/api/repositories/acme/widget').flush(WIDGET);
    http
      .expectOne('/-/api/repositories/umbrella/secret')
      .flush(null, { status: 404, statusText: 'Not Found' });
    await harness.fixture.whenStable();
    expect(page().querySelector('h1')!.textContent?.trim()).toBe(NOT_FOUND_OR_PRIVATE);
    expect(page().textContent).toContain(notFoundForVisitor('repository', 'umbrella/secret'));
    expect(page().querySelector('app-compare-head, app-widget')).toBeNull();
    expect(moves()).toEqual([]);
    http.expectNone(isPart);
  });

  it('opens no comparison of a repository with an account (FR-CMP-01)', async () => {
    await harness.navigateByUrl('/-/compare/acme/widget...umbrella');
    // The page the router shows is BuhTig's page of no such page.
    expect(page().localName).toBe('app-not-found');
    expect(title()).toBe(TITLES.notFound);
  });

  describe('of two accounts', () => {
    const ACME = {
      name: 'acme',
      fetched_at: '2026-10-22T11:58:00Z',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      display_name: 'Acme Corp',
      description: 'We make everything',
      verified: true,
    };
    const MONA = {
      name: 'mona',
      fetched_at: '2026-10-22T11:58:00Z',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      display_name: 'Mona Lisa',
      bio: 'Paints octocats',
      followers: 1,
      following: 1,
    };
    const STATS = {
      repositories: 1_000,
      private: 0,
      internal: 0,
      stars: 900,
      forks: 40,
      open_issues_and_pull_requests: 7,
      top_language: 'TypeScript',
      truncated: true,
    };
    const ACCOUNT_PARTS: Record<string, object> = {
      '/-/api/organizations/acme/stats': STATS,
      '/-/api/users/mona/stats': { ...STATS, repositories: 12, truncated: false },
      '/-/api/organizations/acme/languages': {
        languages: [{ name: 'TypeScript', repositories: 42 }],
        other: 8,
      },
      '/-/api/users/mona/languages': { languages: [], other: 0 },
      '/-/api/organizations/acme/last-push': {
        last_7_days: 12,
        last_30_days: 1,
        last_12_months: 1,
        older: 0,
      },
      '/-/api/users/mona/last-push': {
        last_7_days: 3,
        last_30_days: 0,
        last_12_months: 0,
        older: 9,
      },
      '/-/api/organizations/acme/created-per-year': {
        years: [
          { year: 2019, repositories: 4 },
          { year: 2021, repositories: 10 },
        ],
      },
      '/-/api/users/mona/created-per-year': { years: [{ year: 2020, repositories: 12 }] },
    };

    /** Opens the comparison of `acme`, an organization, with `mona`, a user. */
    async function openAccounts(): Promise<void> {
      await harness.navigateByUrl('/-/compare/acme...mona');
      await harness.fixture.whenStable();
      // GitHub tells what kind each account is, as of a dashboard (FR-SRCH-06).
      http.expectOne('/-/api/accounts/acme').flush({ type: 'organization', login: 'acme' });
      http.expectOne('/-/api/accounts/mona').flush({ type: 'user', login: 'mona' });
      http.expectOne('/-/api/organizations/acme').flush(ACME);
      http.expectOne('/-/api/users/mona').flush(MONA);
      await harness.fixture.whenStable();
    }

    it('shows an organization and a user side by side, of their kinds', async () => {
      await openAccounts();
      expect(title()).toBe('acme vs mona · BuhTig');
      expect(moves()).toEqual([]);
      const heads = [...page().querySelectorAll('app-compare-head')];
      expect(
        heads.map((head) => [
          head.querySelector('.cmp-name')!.getAttribute('href'),
          shown(head.querySelector('.label')!),
          head.querySelector('.cmp-desc')?.textContent,
        ]),
      ).toEqual([
        ['/acme', 'Organization', 'We make everything'],
        ['/mona', 'User', 'Paints octocats'],
      ]);
      expect(await answerParts(ACCOUNT_PARTS)).toEqual(Object.keys(ACCOUNT_PARTS).sort());
      expect([...page().querySelectorAll('.cmp-stat dt')].map((label) => shown(label))).toEqual([
        'Repositories',
        'Stars',
        'Forks',
        'Open issues and pull requests',
        'Top language',
      ]);
      // Of an account with more repositories than BuhTig reads, it says so (FR-ORG-08).
      expect(shown(widget('Overview').querySelector('.Box-footer')!)).toBe(
        truncated('acme', 1_000),
      );
    });

    it('charts their languages, last pushes and years created against one scale (FR-CMP-04)', async () => {
      await openAccounts();
      await answerParts(ACCOUNT_PARTS);
      const languages = widget('Languages');
      expect(languages.querySelectorAll('app-split-bar')).toHaveLength(1);
      expect(shown(languages.querySelector('.muted')!)).toBe('No languages detected');
      expect(languages.querySelector('.w-sub')!.textContent?.trim()).toBe(
        bothSides(
          sideLanguages('account', 'acme', { name: 'TypeScript', share: 42 / 50 }),
          sideLanguages('account', 'mona', undefined),
        ),
      );

      const lastPush = widget('Last push');
      expect(lastPush.querySelector('.w-sub')!.textContent?.trim()).toBe(
        lastPushComparison(
          'acme',
          { last7Days: 12, last30Days: 1, last12Months: 1, older: 0 },
          'mona',
          { last7Days: 3, last30Days: 0, last12Months: 0, older: 9 },
        ),
      );
      // Both against the most of a period of either, acme's 12 of the last 7 days.
      expect(
        [...lastPush.querySelectorAll<HTMLElement>('.track i')].map((bar) =>
          bar.style.getPropertyValue('--w'),
        ),
      ).toEqual(['1.0000', '0.0833', '0.0833', '0.0000', '0.2500', '0.0000', '0.0000', '0.7500']);
      expect(await table('Last push')).toEqual([
        ['Last push', 'acme', 'mona'],
        ['Last 7 days', '12', '3'],
        ['Last 30 days', '1', '0'],
        ['Last 12 months', '1', '0'],
        ['Older', '0', '9'],
      ]);

      const created = widget('Repositories created per year');
      expect(created.querySelector('.w-sub')!.textContent?.trim()).toBe(
        bothSides(
          sideCreated('acme', [
            { year: 2019, repositories: 4 },
            { year: 2021, repositories: 10 },
          ]),
          sideCreated('mona', [{ year: 2020, repositories: 12 }]),
        ),
      );
      // Over the same years, every one from the first either created a repository in.
      expect(await table('Repositories created per year')).toEqual([
        ['Year', 'acme', 'mona'],
        ['2019', exactNumber(4), '0'],
        ['2020', '0', exactNumber(12)],
        ['2021', exactNumber(10), '0'],
      ]);
    });
  });
});
