import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { Component, DOCUMENT, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, Routes, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom } from 'rxjs';
import type { Mock } from 'vitest';
import { AccountData } from '../dashboard/data';
import {
  Coverage,
  Covered,
  Freshness,
  ListedRepository,
  RepositoryList,
} from '../dashboard/resources';
import {
  DOWNLOAD_CSV,
  DOWNLOAD_FAILED,
  listDownload,
  listDownloadCount,
  listDownloadScope,
} from '../export/messages';
import { Tip } from '../tip/tip';
import { Toasts } from '../toast/toasts';
import { Load } from '../widget/load';
import { FAILED } from '../widget/messages';
import {
  COPY_LINK,
  COPY_LINK_FAILED,
  FIND_REPOSITORY,
  LINK_COPIED,
  NO_REPOSITORIES,
  listed,
  noMatch,
} from './messages';
import { LIST_COLUMNS } from './csv';
import { OrganizationRepositoriesTab } from './repositories';

@Component({ selector: 'app-blank', template: '' })
class Blank {}

/** The list, as an organization's Repositories tab and as a user's, and a page elsewhere. */
const ROUTES: Routes = [
  { path: 'orgs/acme/repositories', component: OrganizationRepositoriesTab },
  { path: 'mona', component: OrganizationRepositoriesTab },
  { path: 'blank', component: Blank },
];

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

/** When the repositories were fetched from GitHub. */
const FETCHED = new Date('2026-11-09T10:00:00.000Z');

/** The rows of the CSV file `text`, cell by cell, as a spreadsheet reads them (RFC 4180). */
function parse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        cell += '"';
        at++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && text[at + 1] === '\n') {
      rows.push([...row, cell]);
      [row, cell] = [[], ''];
      at++;
    } else {
      cell += char;
    }
  }
  return rows;
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

describe('OrganizationRepositoriesTab', () => {
  const scrolling = Element.prototype.scrollIntoView;
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let state: ReturnType<typeof signal<Load<Covered<RepositoryList>>>>;
  let retry: Mock<() => void>;
  let scrollIntoView: Mock<Element['scrollIntoView']>;

  beforeEach(async () => {
    // So that the rows' sparklines load nothing, which `repository-row.spec.ts` tests.
    vi.stubGlobal('IntersectionObserver', Unseeing);
    // The tests' jsdom scrolls nothing, and has no way to.
    scrollIntoView = vi.fn<Element['scrollIntoView']>();
    Element.prototype.scrollIntoView = scrollIntoView;
    state = signal<Load<Covered<RepositoryList>>>({ status: 'loading' });
    retry = vi.fn();
    TestBed.configureTestingModule({
      imports: [OrganizationRepositoriesTab],
      providers: [
        provideRouter(ROUTES),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AccountData,
          useValue: {
            login: signal('acme'),
            displayName: signal('Acme Corp'),
            repositories: () => ({ state, retry }),
            languageColor: signal(() => 'var(--s1)'),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create('/orgs/acme/repositories');
    await harness.fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = scrolling;
  });

  const element = () => harness.routeNativeElement!;
  /** The names of the repositories listed, in their order. */
  const names = () =>
    [...element().querySelectorAll('app-repository-row')].map(
      (row) => row.querySelector('h3 a')!.textContent,
    );
  const status = () => element().querySelector('.count-note')!.textContent?.trim();
  const search = () => element().querySelector<HTMLInputElement>('input[type="search"]')!;
  const select = (label: string) =>
    element().querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const options = (label: string) =>
    [...select(label).options].map((option) => option.textContent?.trim());
  const pager = () => element().querySelector('nav.pager');
  /** What the pager offers, as its buttons' text, and gaps. */
  const pages = () =>
    [...(pager()?.children ?? [])].map((item) =>
      item.classList.contains('gap') ? '…' : item.textContent?.trim(),
    );
  const page = (label: string) =>
    [...pager()!.querySelectorAll('button')].find(
      (button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label,
    )!;
  const current = () => pager()!.querySelector('[aria-current="page"]')?.textContent?.trim();

  /**
   * The list loads `repositories`, all of the account's, fetched at `FETCHED`, unless `covered`
   * says otherwise.
   */
  async function answer(
    repositories: ListedRepository[],
    covered: Partial<Coverage & Freshness> = {},
  ): Promise<void> {
    state.set({
      status: 'ready',
      data: {
        repositories,
        truncated: false,
        repositoriesRead: repositories.length,
        fetchedAt: FETCHED,
        stale: undefined,
        ...covered,
      },
    });
    await harness.fixture.whenStable();
  }

  async function type(text: string): Promise<void> {
    search().value = text;
    search().dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
  }

  async function choose(label: string, value: string): Promise<void> {
    select(label).value = value;
    select(label).dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
  }

  async function click(button: HTMLElement): Promise<void> {
    button.click();
    await harness.fixture.whenStable();
  }

  /** `count` repositories, named `r01` and on, each pushed to a day before the one before. */
  function many(count: number): ListedRepository[] {
    return Array.from({ length: count }, (_, i) =>
      repository(`r${String(i + 1).padStart(2, '0')}`, {
        pushedAt: new Date(Date.UTC(2026, 9, 22) - i * 86_400_000),
      }),
    );
  }

  it('stands in its place until the repositories are there', () => {
    expect(element().querySelector('.skel-row')).not.toBeNull();
    expect(names()).toEqual([]);
    expect(status()).toBe('');
  });

  it('lists the repositories pushed to last first, and says how many there are (FR-ORG-03)', async () => {
    await answer([
      repository('a', { pushedAt: new Date('2026-10-01T00:00:00Z') }),
      repository('b', { pushedAt: new Date('2026-10-20T00:00:00Z') }),
      repository('c'),
    ]);
    expect(names()).toEqual(['b', 'a', 'c']);
    expect(status()).toBe(listed(3, '', 1, 1));
    expect(status()).toBe('3 repositories, page 1 of 1');
    expect(element().querySelector('.count-note')!.getAttribute('aria-live')).toBe('polite');
    // One page needs no paging.
    expect(pager()).toBeNull();
  });

  it('offers to find a repository by name, its type, language and order', async () => {
    await answer([repository('a', { language: 'Rust' }), repository('b', { language: 'Go' })]);
    expect(search().placeholder).toBe(FIND_REPOSITORY);
    expect(search().getAttribute('aria-label')).toBe('Find a repository');
    // Only a token user's repositories may be private or internal (FR-ORG-09).
    expect(options('Type')).toEqual(['All', 'Sources', 'Forks', 'Archived']);
    expect(options('Language')).toEqual(['All languages', 'Go', 'Rust']);
    expect(options('Sort')).toEqual(['Last updated', 'Name', 'Stars']);
    expect(select('Type').value).toBe('all');
    expect(select('Language').value).toBe('');
    expect(select('Sort').value).toBe('pushed');
  });

  it('offers public, and private and internal ones, once there is one that is not public (FR-ORG-09)', async () => {
    await answer([
      repository('open'),
      repository('secret', { visibility: 'private' }),
      repository('shared', { visibility: 'internal' }),
    ]);
    expect(options('Type')).toEqual([
      'All',
      'Public',
      'Private and internal',
      'Sources',
      'Forks',
      'Archived',
    ]);
    await choose('Type', 'public');
    expect(names()).toEqual(['open']);
    await choose('Type', 'private');
    expect(names()).toEqual(['secret', 'shared']);
  });

  it('finds repositories by name, type and language, and says how many match', async () => {
    await answer([
      repository('widget', { language: 'Rust' }),
      repository('gadget', { language: 'TypeScript', fork: true }),
      repository('sprocket', { language: 'Rust', archived: true }),
      repository('docs'),
    ]);
    await type('WIDG');
    expect(names()).toEqual(['widget']);
    expect(status()).toBe(listed(1, 'WIDG', 1, 1));
    expect(status()).toBe('1 repository matching “WIDG”, page 1 of 1');

    await type('');
    await choose('Type', 'forks');
    expect(names()).toEqual(['gadget']);
    await choose('Type', 'sources');
    expect(names()).toEqual(['docs', 'sprocket', 'widget']);
    await choose('Type', 'archived');
    expect(names()).toEqual(['sprocket']);

    await choose('Type', 'all');
    await choose('Language', 'Rust');
    expect(names()).toEqual(['sprocket', 'widget']);
    expect(status()).toBe('2 repositories, page 1 of 1');
    await choose('Language', '');
    expect(names()).toHaveLength(4);
  });

  it('sorts by name, or by stars, most first', async () => {
    await answer([
      repository('b', { stars: 10, pushedAt: new Date('2026-10-20T00:00:00Z') }),
      repository('c', { stars: 30, pushedAt: new Date('2026-10-01T00:00:00Z') }),
      repository('a', { stars: 20 }),
    ]);
    expect(names()).toEqual(['b', 'c', 'a']);
    await choose('Sort', 'name');
    expect(names()).toEqual(['a', 'b', 'c']);
    await choose('Sort', 'stars');
    expect(names()).toEqual(['c', 'a', 'b']);
    await choose('Sort', 'pushed');
    expect(names()).toEqual(['b', 'c', 'a']);
  });

  it("says when no repository matches, in the organization's name", async () => {
    await answer([repository('widget')]);
    await type('gizmo');
    expect(names()).toEqual([]);
    expect(element().querySelector('.empty-note')!.textContent?.trim()).toBe(noMatch('Acme Corp'));
    expect(noMatch('Acme Corp')).toBe("Acme Corp doesn't have any repositories that match.");
    expect(status()).toBe('');
    await type('');
    expect(names()).toEqual(['widget']);
    expect(element().querySelector('.empty-note')).toBeNull();
  });

  it('says when the organization has no repositories', async () => {
    await answer([]);
    expect(element().querySelector('app-widget')!.textContent).toContain(NO_REPOSITORIES);
    expect(element().querySelector('.repo-list')).toBeNull();
    expect(status()).toBe('');
  });

  it('says when the repositories could not be loaded, and tries again', async () => {
    state.set({ status: 'error', failure: 'github' });
    await harness.fixture.whenStable();
    const widget = element().querySelector('app-widget')!;
    expect(widget.textContent).toContain(FAILED);
    widget.querySelector<HTMLButtonElement>('.w-state button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows 25 repositories a page, with a page of each (FR-ORG-03)', async () => {
    await answer(many(60));
    expect(names()).toHaveLength(25);
    expect(names()[0]).toBe('r01');
    expect(status()).toBe('60 repositories, page 1 of 3');
    expect(pages()).toEqual(['Previous', '1', '2', '3', 'Next']);
    expect(current()).toBe('1');
    expect(page('Previous').disabled).toBe(true);
    expect(page('Next').disabled).toBe(false);
    expect(pager()!.getAttribute('aria-label')).toBe('Pages');

    await click(page('Next'));
    expect(names()[0]).toBe('r26');
    expect(status()).toBe('60 repositories, page 2 of 3');
    expect(current()).toBe('2');
    expect(page('Previous').disabled).toBe(false);

    await click(page('Page 3'));
    expect(names()).toHaveLength(10);
    expect(names()[9]).toBe('r60');
    expect(page('Next').disabled).toBe(true);

    await click(page('Previous'));
    expect(current()).toBe('2');
  });

  it('leaves pages out between the first, the last and those next to the page shown', async () => {
    await answer(many(250));
    expect(pages()).toEqual(['Previous', '1', '2', '…', '10', 'Next']);
    await click(page('Page 10'));
    await click(page('Previous'));
    await click(page('Previous'));
    await click(page('Previous'));
    await click(page('Previous'));
    expect(current()).toBe('6');
    expect(pages()).toEqual(['Previous', '1', '…', '5', '6', '7', '…', '10', 'Next']);
    // The gaps are for the eye alone.
    expect(pager()!.querySelector('.gap')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the new page from the top of the list', async () => {
    await answer(many(30));
    await click(page('Page 2'));
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(search());
    expect(scrollIntoView.mock.calls[0][0]).toEqual(expect.objectContaining({ block: 'start' }));
  });

  it('goes back to the first page as the filters or the order change', async () => {
    await answer(many(60));
    await click(page('Page 3'));
    await type('r');
    expect(current()).toBe('1');
    await click(page('Page 2'));
    await choose('Sort', 'name');
    expect(current()).toBe('1');
    await click(page('Page 2'));
    await choose('Type', 'sources');
    expect(current()).toBe('1');
  });

  it('keeps its page as what the list holds changes, but the last there is', async () => {
    await answer(many(60));
    await click(page('Page 3'));
    // As after a refresh.
    await answer(many(55));
    expect(current()).toBe('3');
    await answer(many(30));
    expect(current()).toBe('2');
  });

  describe('in its URL, to bookmark and share (FR-ORG-03)', () => {
    const router = () => TestBed.inject(Router);
    const path = () => router().url.split('?')[0];
    /** The URL's query, whatever its order. */
    const query = () => Object.fromEntries(new URLSearchParams(router().url.split('?')[1] ?? ''));
    const copyButton = () =>
      [...element().querySelectorAll<HTMLButtonElement>('.filters button')].find(
        (button) => button.textContent?.trim() === COPY_LINK,
      )!;
    const alert = () => element().querySelector('.field-msg.err[role="alert"]');

    // As the app does as it starts, so that the router follows the browser's Back and Forward.
    beforeEach(() => router().setUpLocationChangeListener());

    /** Opens `url` anew, as a link or a reload does, from a page elsewhere. */
    async function open(url: string): Promise<void> {
      await harness.navigateByUrl('/blank');
      await harness.navigateByUrl(url);
      await harness.fixture.whenStable();
    }

    /**
     * Steps through the history with `step`, as the browser's Back or Forward does, which the
     * router follows once the browser has moved, after the step itself.
     */
    async function traverse(step: (location: Location) => void): Promise<void> {
      const ended = firstValueFrom(router().events.pipe(filter((e) => e instanceof NavigationEnd)));
      step(TestBed.inject(Location));
      await ended;
      await harness.fixture.whenStable();
    }

    const back = () => traverse((location) => location.back());
    const forward = () => traverse((location) => location.forward());

    /**
     * 60 repositories: every other one a fork, every third in Rust and the rest in Go, each with
     * as many stars as there are before it.
     */
    function mixed(): ListedRepository[] {
      return many(60).map((repository, i) => ({
        ...repository,
        fork: i % 2 === 1,
        language: i % 3 === 0 ? 'Rust' : 'Go',
        stars: i,
      }));
    }

    it('opens at the filters, order and page that its URL names, as a link or a reload does', async () => {
      await answer(
        many(60).map((repository, i) => ({
          ...repository,
          fork: i < 10,
          language: 'Rust',
          stars: i,
        })),
      );
      await open('/orgs/acme/repositories?q=r&type=source&language=rust&sort=stargazers&page=2');
      expect(search().value).toBe('r');
      expect(select('Type').value).toBe('sources');
      expect(select('Language').value).toBe('Rust');
      expect(select('Sort').value).toBe('stars');
      expect(current()).toBe('2');
      // The 50 sources, most stars first: r60 to r36, then r35 on.
      expect(names()[0]).toBe('r35');
      expect(names()).toHaveLength(25);
      expect(status()).toBe(listed(50, 'r', 2, 2));
      expect(router().url).toBe(
        '/orgs/acme/repositories?q=r&type=source&language=rust&sort=stargazers&page=2',
      );
    });

    it("puts what the user picks in its URL, in GitHub's spelling, and leaves out what is as it starts", async () => {
      await answer(mixed());
      await type('r');
      expect(query()).toEqual({ q: 'r' });
      await choose('Type', 'forks');
      expect(query()).toEqual({ q: 'r', type: 'fork' });
      await choose('Language', 'Go');
      await choose('Sort', 'stars');
      expect(query()).toEqual({ q: 'r', type: 'fork', language: 'go', sort: 'stargazers' });
      await type('');
      await choose('Language', '');
      await click(page('Page 2'));
      expect(query()).toEqual({ type: 'fork', sort: 'stargazers', page: '2' });
      await choose('Type', 'all');
      expect(query()).toEqual({ sort: 'stargazers' });
      await choose('Sort', 'pushed');
      expect(router().url).toBe('/orgs/acme/repositories');
    });

    it("keeps a user's tab in their URL (FR-USER-04)", async () => {
      await answer(mixed());
      await open('/mona?tab=repositories&sort=name');
      expect(select('Sort').value).toBe('name');
      await choose('Type', 'sources');
      expect(path()).toBe('/mona');
      expect(query()).toEqual({ tab: 'repositories', sort: 'name', type: 'source' });
      await choose('Sort', 'pushed');
      await choose('Type', 'all');
      expect(router().url).toBe('/mona?tab=repositories');
    });

    it('steps back and forward through what the user picked, with its URL and what it shows', async () => {
      await answer(mixed());
      await choose('Type', 'forks');
      await choose('Sort', 'name');
      await click(page('Page 2'));
      const second = names();

      await back();
      expect(query()).toEqual({ type: 'fork', sort: 'name' });
      expect(current()).toBe('1');
      expect(select('Sort').value).toBe('name');
      expect(names()[0]).toBe('r02');

      await back();
      expect(query()).toEqual({ type: 'fork' });
      expect(select('Sort').value).toBe('pushed');
      expect(select('Type').value).toBe('forks');

      await back();
      expect(router().url).toBe('/orgs/acme/repositories');
      expect(select('Type').value).toBe('all');
      expect(names()).toHaveLength(25);
      expect(status()).toBe(listed(60, '', 1, 3));

      await forward();
      await forward();
      await forward();
      expect(query()).toEqual({ type: 'fork', sort: 'name', page: '2' });
      expect(current()).toBe('2');
      expect(names()).toEqual(second);
    });

    it('takes what the user types as one step back, whatever its length', async () => {
      await answer(mixed());
      await choose('Sort', 'name');
      await type('r');
      await type('r0');
      await type('r05');
      expect(query()).toEqual({ q: 'r05', sort: 'name' });
      expect(names()).toEqual(['r05']);

      await back();
      expect(query()).toEqual({ sort: 'name' });
      expect(search().value).toBe('');
      expect(names()).toHaveLength(25);

      await forward();
      expect(query()).toEqual({ q: 'r05', sort: 'name' });
      expect(search().value).toBe('r05');
      expect(names()).toEqual(['r05']);
    });

    it('shows the first page again, in its URL too, as the filters or the order change', async () => {
      await answer(mixed());
      await click(page('Page 3'));
      expect(query()).toEqual({ page: '3' });
      await choose('Sort', 'stars');
      expect(query()).toEqual({ sort: 'stargazers' });
      await click(page('Page 2'));
      await choose('Language', 'Rust');
      expect(query()).toEqual({ sort: 'stargazers', language: 'rust' });
    });

    it('shows the last page, in its URL too, when its URL names one past it, once it knows', async () => {
      await open('/orgs/acme/repositories?sort=name&page=9');
      // Not while it does not know how many there are.
      expect(query()).toEqual({ sort: 'name', page: '9' });
      await answer(mixed());
      expect(current()).toBe('3');
      expect(query()).toEqual({ sort: 'name', page: '3' });
      // In place of the URL the link named, so that Back leads where the user was before.
      await back();
      expect(router().url).toBe('/blank');
    });

    it('shows the last page there is when a refresh brings fewer, or none', async () => {
      await answer(mixed());
      await click(page('Page 3'));
      state.set({ status: 'loading' });
      await harness.fixture.whenStable();
      expect(query()).toEqual({ page: '3' });
      await answer(many(30));
      expect(current()).toBe('2');
      expect(query()).toEqual({ page: '2' });
      await answer([]);
      expect(router().url).toBe('/orgs/acme/repositories');
    });

    it('opens as it starts where its URL names what it does not know, and says so in its URL', async () => {
      await answer(mixed());
      await open(
        '/orgs/acme/repositories?type=mirror&sort=forks&page=two&language=&q=%20&utm_source=chat',
      );
      expect(select('Type').value).toBe('all');
      expect(select('Sort').value).toBe('pushed');
      expect(select('Language').value).toBe('');
      expect(search().value).toBe('');
      expect(current()).toBe('1');
      expect(names()).toHaveLength(25);
      // What is not the list's stays.
      expect(router().url).toBe('/orgs/acme/repositories?utm_source=chat');
      await back();
      expect(router().url).toBe('/blank');
    });

    it("spells its URL as it does, whatever spelling a link has, as BuhTig's own", async () => {
      await answer(mixed());
      await open('/orgs/acme/repositories?type=Sources&sort=stars&language=RUST&page=1');
      expect(select('Type').value).toBe('sources');
      expect(select('Language').value).toBe('Rust');
      expect(query()).toEqual({ type: 'source', sort: 'stargazers', language: 'rust' });
    });

    it("keeps a language or a type that the viewer's repositories don't have, and says none match", async () => {
      await answer(mixed());
      await open('/orgs/acme/repositories?language=zig&type=private');
      // So that what the URL says, the filters, and the list agree.
      expect(options('Language')).toEqual(['All languages', 'Go', 'Rust', 'zig']);
      expect(select('Language').value).toBe('zig');
      expect(options('Type')).toEqual([
        'All',
        'Private and internal',
        'Sources',
        'Forks',
        'Archived',
      ]);
      expect(select('Type').value).toBe('private');
      expect(names()).toEqual([]);
      expect(element().querySelector('.empty-note')!.textContent?.trim()).toBe(
        noMatch('Acme Corp'),
      );
      expect(query()).toEqual({ language: 'zig', type: 'private' });
    });

    it('shows what a link to the list from elsewhere names, as its tab does', async () => {
      await answer(mixed());
      await choose('Type', 'forks');
      await type('r1');
      // As the dashboard's Repositories tab, or the command palette.
      await harness.navigateByUrl('/orgs/acme/repositories?sort=name');
      await harness.fixture.whenStable();
      expect(select('Type').value).toBe('all');
      expect(search().value).toBe('');
      expect(select('Sort').value).toBe('name');
      expect(names()[0]).toBe('r01');
    });

    describe('Copy link', () => {
      let writeText: Mock<(text: string) => Promise<void>>;

      beforeEach(() => {
        writeText = vi.fn((_text: string) => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText },
          configurable: true,
        });
      });

      afterEach(() => {
        Reflect.deleteProperty(navigator, 'clipboard');
      });

      const origin = () => TestBed.inject(DOCUMENT).location.origin;
      const toasts = () =>
        TestBed.inject(Toasts)
          .toasts()
          .map((toast) => [toast.message, toast.icon]);

      it('copies the link to the list as it is shown, with its page (FR-ORG-03)', async () => {
        await answer(mixed());
        await open('/mona?tab=repositories&type=source');
        await choose('Sort', 'stars');
        await click(page('Page 2'));
        expect(copyButton().getAttribute('type')).toBe('button');
        await click(copyButton());
        expect(writeText).toHaveBeenCalledExactlyOnceWith(
          `${origin()}/mona?tab=repositories&type=source&sort=stargazers&page=2`,
        );
        expect(toasts()).toEqual([[LINK_COPIED, 'link']]);
        expect(alert()).toBeNull();
      });

      it("copies a link with nothing of the viewer's own but what they picked", async () => {
        await answer(mixed());
        await open('/orgs/acme/repositories');
        await click(copyButton());
        expect(writeText).toHaveBeenCalledExactlyOnceWith(`${origin()}/orgs/acme/repositories`);
      });

      it("says beside it, where the browser won't copy, that the address bar has the link (NFR-UX-06)", async () => {
        writeText.mockRejectedValue(new Error('Not allowed'));
        await answer(mixed());
        await click(copyButton());
        expect(alert()!.textContent?.trim()).toBe(COPY_LINK_FAILED);
        expect(copyButton().getAttribute('aria-describedby')).toBe(alert()!.id);
        expect(toasts()).toEqual([]);
        // Until the list shows something else.
        await choose('Sort', 'name');
        expect(alert()).toBeNull();
        expect(copyButton().getAttribute('aria-describedby')).toBeNull();
      });

      it('says so too where the browser has no clipboard, as over plain HTTP', async () => {
        Reflect.deleteProperty(navigator, 'clipboard');
        await answer(mixed());
        await click(copyButton());
        expect(alert()!.textContent?.trim()).toBe(COPY_LINK_FAILED);
      });
    });

    describe('Download CSV (FR-EXP-01)', () => {
      const { createObjectURL, revokeObjectURL } = URL;
      let blobs: Blob[];
      let saved: string[];

      beforeEach(() => {
        blobs = [];
        saved = [];
        URL.createObjectURL = vi.fn((blob: Blob) => {
          blobs.push(blob);
          return 'blob:test';
        });
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
          this: HTMLAnchorElement,
        ) {
          saved.push(this.download);
        });
      });

      afterEach(() => {
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
        vi.restoreAllMocks();
      });

      const origin = () => TestBed.inject(DOCUMENT).location.origin;
      const today = () => new Date().toISOString().slice(0, 10);
      const downloadButton = () =>
        [...element().querySelectorAll<HTMLButtonElement>('.filters button')].find(
          (button) => button.textContent?.trim() === DOWNLOAD_CSV,
        )!;
      const description = () =>
        element().querySelector(`[id="${downloadButton().getAttribute('aria-describedby')}"]`)
          ?.textContent;

      /** Downloads the list, and reads the file back, a row of cells a line, the header first. */
      async function download(): Promise<string[][]> {
        await click(downloadButton());
        return parse(await blobs.at(-1)!.text());
      }

      it('saves every repository that matches, from every page, in the order shown', async () => {
        await answer(mixed());
        await open('/orgs/acme/repositories?type=source&sort=stargazers&page=2');
        // 30 sources, on 2 pages, the second shown.
        expect(current()).toBe('2');
        const [header, ...rows] = await download();
        expect(header).toEqual([...LIST_COLUMNS, 'source_url']);
        // Those with the most stars first, as the list shows them: the sources are the even ones.
        const sources = Array.from({ length: 30 }, (_, i) => 58 - 2 * i);
        expect(rows.map((row) => row[1])).toEqual(
          sources.map((i) => `acme/r${String(i + 1).padStart(2, '0')}`),
        );
        expect(rows.map((row) => row[0])).toEqual(sources.map((_, at) => String(at + 1)));
        // Exactly, as GitHub gave it, with what the list covers and when it was fetched, and
        // the link to the list, from its first page, since the file has every page.
        expect(rows[0]).toEqual([
          '1',
          'acme/r59',
          '',
          'Go',
          '',
          'public',
          'false',
          'false',
          '58',
          '0',
          '0',
          new Date(Date.UTC(2026, 9, 22) - 58 * 86_400_000).toISOString(),
          'acme',
          'all',
          '60',
          '2026-11-09T10:00:00.000Z',
          '',
          `${origin()}/orgs/acme/repositories?type=source&sort=stargazers`,
        ]);
        expect(saved).toEqual([`acme-repositories-${today()}.csv`]);
        expect(
          TestBed.inject(Toasts)
            .toasts()
            .map((toast) => toast.message),
        ).toEqual([`Downloaded 30 repositories as acme-repositories-${today()}.csv`]);
        // The list shows what it showed.
        expect(current()).toBe('2');
      });

      it('says what it downloads, as it is pointed at or focused, and to assistive technology', async () => {
        await answer(many(60));
        await type('r1');
        expect(description()).toBe(listDownload(10, false, 60));
        downloadButton().dispatchEvent(new Event('focus'));
        expect(TestBed.inject(Tip).shown()).toMatchObject({
          value: listDownloadCount(10),
          label: listDownloadScope(false, 60),
        });
        downloadButton().dispatchEvent(new Event('blur'));
        expect(TestBed.inject(Tip).shown()).toBeUndefined();
      });

      it('says what it covers of an account with more repositories than BuhTig reads (FR-ORG-08)', async () => {
        await answer(many(30), { truncated: true, repositoriesRead: 30, stale: 'github' });
        expect(description()).toBe(listDownload(30, true, 30));
        const [header, ...rows] = await download();
        const cell = (row: string[], column: string) => row[header.indexOf(column)];
        expect(rows).toHaveLength(30);
        expect(rows.map((row) => [cell(row, 'coverage'), cell(row, 'repositories_read')])).toEqual(
          rows.map(() => ['most_recently_pushed', '30']),
        );
        // Saved data, as GitHub failed, with when it was fetched.
        expect([cell(rows[0], 'fetched_at'), cell(rows[0], 'stale')]).toEqual([
          '2026-11-09T10:00:00.000Z',
          'github',
        ]);
      });

      it('keeps text from GitHub as it is, in any language, but never as a formula (FR-EXP-05)', async () => {
        await answer([
          repository('widget', {
            description: '=HYPERLINK("https://evil.example","Click")',
            topics: ['widgets', 'rust'],
            pushedAt: new Date(Date.UTC(2026, 9, 22)),
          }),
          repository('gadget', {
            description: 'Gadgets, "tools"\nand ウィジェット 🚀',
            language: 'C++',
          }),
        ]);
        const [header, ...rows] = await download();
        const cell = (row: string[], column: string) => row[header.indexOf(column)];
        expect(rows.map((row) => cell(row, 'description'))).toEqual([
          `'=HYPERLINK("https://evil.example","Click")`,
          'Gadgets, "tools"\nand ウィジェット 🚀',
        ]);
        expect(rows.map((row) => [cell(row, 'topics'), cell(row, 'language')])).toEqual([
          ['widgets rust', ''],
          ['', 'C++'],
        ]);
      });

      it("has only the repositories the viewer's list has, of the type chosen (FR-ACC-06)", async () => {
        await answer([repository('rocket'), repository('secret', { visibility: 'private' })]);
        let [header, ...rows] = await download();
        expect(rows.map((row) => [row[1], row[header.indexOf('visibility')]])).toEqual([
          ['acme/rocket', 'public'],
          ['acme/secret', 'private'],
        ]);
        await choose('Type', 'public');
        [header, ...rows] = await download();
        expect(rows.map((row) => row[1])).toEqual(['acme/rocket']);
      });

      it('is offered once the list has loaded, while any repository matches', async () => {
        expect(downloadButton().disabled).toBe(true);
        await answer(many(3));
        expect(downloadButton().disabled).toBe(false);
        await type('nothing');
        expect(downloadButton().disabled).toBe(true);
        expect(saved).toEqual([]);
      });

      it('says so beside it when the browser will not save it (NFR-UX-06)', async () => {
        URL.createObjectURL = vi.fn(() => {
          throw new Error('no downloads');
        });
        await answer(many(3));
        await click(downloadButton());
        expect(alert()!.textContent?.trim()).toBe(DOWNLOAD_FAILED);
        expect(downloadButton().getAttribute('aria-describedby')).toBe(`list-csv ${alert()!.id}`);
        expect(TestBed.inject(Toasts).toasts()).toEqual([]);
        // Until the list shows something else.
        await choose('Sort', 'name');
        expect(alert()).toBeNull();
      });
    });
  });
});
