import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OrganizationData } from '../dashboard/data';
import { ListedRepository, Resources } from '../dashboard/resources';
import { Clock } from '../format/clock';
import { compactNumber, relativeTime } from '../format/format';
import { RECHECK_MS } from '../widget/load';
import { NO_DESCRIPTION, OPEN_ISSUES_AND_PULL_REQUESTS, sparklineLabel } from './messages';
import { RepositoryCard, RepositoryRow } from './repository-row';

@Component({
  imports: [RepositoryCard, RepositoryRow],
  template: `
    <ul>
      @for (repository of repositories(); track repository.name) {
        <li>
          @if (cards()) {
            <app-repository-card [repository]="repository" />
          } @else {
            <app-repository-row [repository]="repository" />
          }
        </li>
      }
    </ul>
  `,
})
class Host {
  readonly repositories = signal<ListedRepository[]>([]);
  readonly cards = signal(false);
}

/** `acme/widget`, as the organization's lists show it. */
const WIDGET: ListedRepository = {
  name: 'widget',
  path: '/acme/widget',
  description: 'Widgets for everyone',
  language: 'Rust',
  stars: 12_345,
  forks: 30,
  openIssuesAndPullRequests: 1_204,
  pushedAt: new Date('2026-10-20T08:00:00Z'),
  fork: false,
  archived: false,
  visibility: 'public',
  topics: [],
};

/** The weeks of a year of commit activity, as the server answers, `commits` of each. */
function weeks(commits: number[]): object {
  return {
    weeks: commits.map((count, index) => ({
      week: new Date(Date.UTC(2025, 9, 26) + index * 7 * 86_400_000).toISOString(),
      commits: count,
    })),
  };
}

/** What stands in for the browser's IntersectionObserver, whose entries the tests make. */
class Observer {
  static made: Observer[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(readonly callback: IntersectionObserverCallback) {
    Observer.made.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Says whether what it observes is in view. */
  see(isIntersecting: boolean): void {
    this.callback(
      this.observed.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    );
  }
}

describe('RepositoryRow and RepositoryCard', () => {
  const NOW = new Date('2026-10-22T12:00:00Z').getTime();
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(() => {
    Observer.made = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(NOW) } },
        {
          provide: OrganizationData,
          useValue: {
            login: signal('acme'),
            displayName: signal('Acme'),
            languageColor: signal((language: string) =>
              language === 'Rust' ? 'var(--s1)' : 'var(--s-other)',
            ),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  /** The text that `element` shows, without what only assistive technology or hover reads. */
  const shown = (element: Element) => {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"], .sr').forEach((hidden) => hidden.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  };
  const activity = (repo: string) =>
    `/-/api/organizations/acme/repositories/${repo}/commit-activity`;

  async function show(repositories: ListedRepository[], cards = false): Promise<void> {
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.repositories.set(repositories);
    fixture.componentInstance.cards.set(cards);
    await fixture.whenStable();
  }

  describe('a row', () => {
    const row = () => element().querySelector('app-repository-row')!;

    it("shows a repository's name, leading to its dashboard, and what GitHub says of it (FR-ORG-03)", async () => {
      await show([WIDGET]);
      expect(row().classList).toContain('repo-row');
      const link = row().querySelector('h3 a')!;
      expect([link.textContent?.trim(), link.getAttribute('href')]).toEqual([
        'widget',
        '/acme/widget',
      ]);
      expect([...row().querySelectorAll('h3 .label')].map((label) => label.textContent)).toEqual([
        'Public',
      ]);
      expect(row().querySelector('p')!.textContent?.trim()).toBe('Widgets for everyone');
      expect([...row().querySelectorAll('.rmeta > span')].map((span) => shown(span))).toEqual([
        'Rust',
        compactNumber(12_345),
        '30',
        '1,204',
        `Updated ${relativeTime(WIDGET.pushedAt!, NOW)}`,
      ]);
      http.expectOne(activity('widget'));
    });

    it('tells the exact figures on hover, and to assistive technology', async () => {
      await show([WIDGET]);
      const meta = [...row().querySelectorAll('.rmeta > span')];
      expect(meta.map((span) => span.getAttribute('title'))).toEqual([
        null,
        '12,345 stars',
        '30 forks',
        OPEN_ISSUES_AND_PULL_REQUESTS,
        null,
      ]);
      expect(meta[1].querySelector('.sr')!.textContent).toBe('12,345');
      expect(meta[3].querySelector('.sr')!.textContent).toBe(OPEN_ISSUES_AND_PULL_REQUESTS);
      http.expectOne(activity('widget'));
    });

    it("colors the language's dot as the dashboard colors its languages", async () => {
      await show([WIDGET, { ...WIDGET, name: 'gadget', language: 'Go' }]);
      expect(
        [...element().querySelectorAll<HTMLElement>('.lang-dot')].map(
          (dot) => dot.style.background,
        ),
      ).toEqual(['var(--s1)', 'var(--s-other)']);
      http.expectOne(activity('widget'));
      http.expectOne(activity('gadget'));
    });

    it('marks private, internal, archived and forked repositories, in words (FR-ORG-09)', async () => {
      await show([
        { ...WIDGET, name: 'secret', visibility: 'private', archived: true },
        { ...WIDGET, name: 'shared', visibility: 'internal', fork: true },
      ]);
      expect(
        [...element().querySelectorAll('app-repository-row')].map((row) =>
          [...row.querySelectorAll('h3 .label')].map((label) => label.textContent),
        ),
      ).toEqual([
        ['Private', 'Archived'],
        ['Internal', 'Fork'],
      ]);
      expect(element().querySelector('.label.attention')!.textContent).toBe('Archived');
      http.expectOne(activity('secret'));
      http.expectOne(activity('shared'));
    });

    it('shows nothing for what the server does not say', async () => {
      await show([{ ...WIDGET, description: undefined, language: undefined, pushedAt: undefined }]);
      expect(row().querySelector('p')).toBeNull();
      expect(row().querySelector('.lang-dot')).toBeNull();
      expect([...row().querySelectorAll('.rmeta > span')].map((span) => shown(span))).toEqual([
        compactNumber(12_345),
        '30',
        '1,204',
      ]);
      http.expectOne(activity('widget'));
    });

    it('shows the commits of the last 26 weeks as a sparkline', async () => {
      await show([WIDGET]);
      // A placeholder of its shape until then.
      expect(row().querySelector('.spark.waiting')).not.toBeNull();
      const request = http.expectOne(activity('widget'));
      expect(request.request.method).toBe('GET');
      // Busy weeks long ago, and one commit a week of late.
      request.flush(weeks([...Array(26).fill(100), ...Array(26).fill(1)]));
      await fixture.whenStable();
      expect(row().querySelector('.spark.waiting')).toBeNull();
      const sparkline = row().querySelector('.spark-wrap')!;
      expect(sparkline.getAttribute('role')).toBe('img');
      expect(sparkline.getAttribute('aria-label')).toBe(sparklineLabel(26));
      expect(sparklineLabel(26)).toBe('26 commits in the last 26 weeks');
      expect(sparkline.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(
        26,
      );
    });

    it('says so of a single commit', async () => {
      await show([WIDGET]);
      http.expectOne(activity('widget')).flush(weeks([5, ...Array(25).fill(0), 1]));
      await fixture.whenStable();
      expect(row().querySelector('.spark-wrap')!.getAttribute('aria-label')).toBe(
        '1 commit in the last 26 weeks',
      );
    });

    it('shows no sparkline when its commits could not be loaded', async () => {
      await show([WIDGET]);
      http.expectOne(activity('widget')).flush(null, { status: 502, statusText: 'Bad Gateway' });
      await fixture.whenStable();
      expect(row().querySelector('.spark, .spark-wrap')).toBeNull();
      // The rest of the row is there all the same.
      expect(row().querySelector('h3 a')!.textContent).toBe('widget');
    });

    it('waits while GitHub computes the commits, and asks again (FR-REPO-10)', async () => {
      await show([WIDGET]);
      vi.useFakeTimers();
      http.expectOne(activity('widget')).flush(null, { status: 202, statusText: 'Accepted' });
      fixture.detectChanges();
      expect(row().querySelector('.spark.waiting')).not.toBeNull();
      vi.advanceTimersByTime(RECHECK_MS[0] - 1);
      http.expectNone(activity('widget'));
      vi.advanceTimersByTime(1);
      http.expectOne(activity('widget')).flush(null, { status: 202, statusText: 'Accepted' });
      vi.advanceTimersByTime(RECHECK_MS[1]);
      http.expectOne(activity('widget')).flush(weeks([1, 2, 3]));
      fixture.detectChanges();
      expect(row().querySelector('.spark-wrap')!.getAttribute('aria-label')).toBe(
        sparklineLabel(6),
      );
    });

    it('asks for the commits again on a refresh (FR-DATA-07)', async () => {
      await show([WIDGET]);
      http.expectOne(activity('widget')).flush(weeks([1]));
      await fixture.whenStable();
      TestBed.inject(Resources).refresh({ kind: 'organization', org: 'acme' }).subscribe();
      http
        .expectOne({ method: 'POST', url: '/-/api/organizations/acme/refresh' })
        .flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();
      http.expectOne(activity('widget')).flush(weeks([4]));
      await fixture.whenStable();
      expect(row().querySelector('.spark-wrap')!.getAttribute('aria-label')).toBe(
        sparklineLabel(4),
      );
    });

    it('asks for no commits until its row comes into view (FR-DATA-10)', async () => {
      vi.stubGlobal('IntersectionObserver', Observer);
      await show([WIDGET, { ...WIDGET, name: 'gadget' }]);
      http.expectNone(activity('widget'));
      http.expectNone(activity('gadget'));
      expect(row().querySelector('.spark.waiting')).not.toBeNull();
      const [widget, gadget] = Observer.made;
      // Each observes its own row.
      expect(widget.observed).toEqual([element().querySelectorAll('app-repository-row')[0]]);
      expect(gadget.observed).toEqual([element().querySelectorAll('app-repository-row')[1]]);

      widget.see(false);
      await fixture.whenStable();
      http.expectNone(activity('widget'));

      widget.see(true);
      await fixture.whenStable();
      http.expectOne(activity('widget')).flush(weeks([2]));
      await fixture.whenStable();
      expect(widget.disconnected).toBe(true);
      expect(row().querySelector('.spark-wrap')).not.toBeNull();
      http.expectNone(activity('gadget'));

      // Once seen, it stays loaded as it scrolls out of view and back.
      widget.see(false);
      widget.see(true);
      await fixture.whenStable();
      http.expectNone(activity('widget'));
    });

    it('stops looking out for a row that is gone', async () => {
      vi.stubGlobal('IntersectionObserver', Observer);
      await show([WIDGET]);
      fixture.componentInstance.repositories.set([]);
      await fixture.whenStable();
      expect(Observer.made[0].disconnected).toBe(true);
    });
  });

  describe('a card', () => {
    const card = () => element().querySelector('app-repository-card')!;

    it('shows a repository with its name, visibility, description and figures (FR-ORG-05)', async () => {
      await show([{ ...WIDGET, visibility: 'internal' }], true);
      expect(card().classList).toContain('card');
      const link = card().querySelector('.c-head a')!;
      expect([link.textContent?.trim(), link.getAttribute('href')]).toEqual([
        'widget',
        '/acme/widget',
      ]);
      expect(card().querySelector('.c-head .label')!.textContent).toBe('Internal');
      expect(card().querySelector('p')!.textContent?.trim()).toBe('Widgets for everyone');
      expect([...card().querySelectorAll('.rmeta > span')].map((span) => shown(span))).toEqual([
        'Rust',
        compactNumber(12_345),
        '30',
      ]);
      expect(card().querySelector<HTMLElement>('.lang-dot')!.style.background).toBe('var(--s1)');
      // A card has no sparkline to load.
      http.expectNone(activity('widget'));
    });

    it('says when a repository has no description', async () => {
      await show([{ ...WIDGET, description: undefined, language: undefined }], true);
      expect(card().querySelector('p')!.textContent?.trim()).toBe(NO_DESCRIPTION);
      expect(card().querySelector('.lang-dot')).toBeNull();
    });
  });
});
