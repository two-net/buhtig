import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import {
  NOT_FOUND_OR_PRIVATE,
  TOKEN_REFUSED,
  notFoundForSignedIn,
  staleData,
} from '../dashboard/messages';
import { Clock } from '../format/clock';
import { relativeTime } from '../format/format';
import { TITLES } from '../messages';
import { problemMessage as searchProblem } from '../search/messages';
import { RUN_STATES, noRuns } from '../repository/messages';
import { Toasts } from '../toast/toasts';
import {
  NOT_A_REPOSITORY,
  NO_SUCH_WATCHLIST,
  NO_WATCHLISTS,
  RELEASE_FAILED,
  RUNS_FAILED,
  SIGN_IN_FOR_WATCHLISTS,
  WATCHLISTS_UNAVAILABLE,
  addedPins,
  addedTo,
  alreadyIn,
  created,
  deleted,
  movedDown,
  problemMessage,
  removedFrom,
  renamedTo,
  rowFailure,
} from './messages';
import { Watchlist } from './watchlists';

describe('Watchlists page', () => {
  const now = new Date('2026-11-09T12:00:00Z').getTime();
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

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
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    http.match('/-/api/session');
    http.verify();
  });

  const MONA = { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' };
  const DEPENDENCIES: Watchlist = {
    id: 7,
    name: 'Dependencies',
    repositories: ['acme/widget', 'octo/thing'],
  };
  const TEAM: Watchlist = { id: 9, name: 'Team', repositories: [] };

  const page = () => harness.routeNativeElement!;
  const url = () => TestBed.inject(Router).url;
  const toasts = () =>
    TestBed.inject(Toasts)
      .toasts()
      .map((toast) => toast.message);
  const rows = () => [...page().querySelectorAll<HTMLElement>('.wl-rows > li')];
  const row = (index: number) => rows()[index].querySelector<HTMLElement>('app-watchlist-entry')!;
  const button = (text: string) =>
    [...page().querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === text,
    );
  const dialogButton = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].find(
      (button) => button.textContent?.trim() === text,
    );

  /**
   * The text that `element` shows, each element's apart, as the page lays them out, without the
   * tooltips that hover and focus show.
   */
  function shown(element: Element): string {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"], .sr').forEach((hidden) => hidden.remove());
    const texts: string[] = [];
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      texts.push(walker.currentNode.textContent ?? '');
    }
    return texts.join(' ').replace(/\s+/g, ' ').trim();
  }

  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    TestBed.tick();
    await harness.fixture.whenStable();
  }

  /** Opens `path` for Mona, with `lists` as her watchlists and `pins` as her pins. */
  async function open(
    path: string,
    lists: Watchlist[] = [DEPENDENCIES, TEAM],
    pins: object[] = [],
    token: object | null = null,
  ): Promise<void> {
    await harness.navigateByUrl(path);
    await settle();
    http.expectOne('/-/api/session').flush({ user: MONA, token });
    await settle();
    http.expectOne({ method: 'GET', url: '/-/api/watchlists' }).flush({ watchlists: lists });
    http.expectOne('/-/api/shortcuts').flush({ pins, recent: [] });
    await settle();
  }

  /** The requests for what rows show of their repositories, on their way. */
  const glances = () => http.match((request) => request.url.endsWith('/glance'));

  /** What the server answers of `name` when GitHub shows it, with `changes`. */
  function glance(name: string, changes: object = {}): object {
    return {
      name,
      fetched_at: '2026-11-09T11:50:00.000Z',
      stale: null,
      owner_avatar_url: null,
      description: `The ${name} repository`,
      visibility: 'public',
      archived: false,
      fork: false,
      pushed_at: '2026-11-09T09:00:00Z',
      default_branch: 'main',
      latest_release: {
        release: {
          tag: 'v1.2.0',
          published_at: '2026-11-02T12:00:00Z',
          url: `https://github.com/${name}/releases/tag/v1.2.0`,
        },
        fetched_at: '2026-11-09T11:50:00.000Z',
        stale: null,
      },
      workflow_runs: {
        branch: 'main',
        sampled: 2,
        passed: 1,
        failed: 1,
        average_duration: 60,
        latest: {
          name: 'CI',
          status: 'completed',
          conclusion: 'failure',
          started_at: '2026-11-09T08:00:00Z',
          url: `https://github.com/${name}/actions/runs/1`,
        },
        hidden: false,
        fetched_at: '2026-11-09T11:40:00.000Z',
        stale: null,
      },
      ...changes,
    };
  }

  /** Answers the commit activity that each row asks for once its repository shows. */
  function answerActivity(): void {
    for (const request of http.match((request) => request.url.endsWith('/commit-activity'))) {
      request.flush({ weeks: [{ week: '2026-11-01', commits: 3 }] });
    }
  }

  it('asks a visitor to sign in, and asks for no watchlists (FR-ACC-02)', async () => {
    await harness.navigateByUrl('/-/watchlists');
    await settle();
    http.expectOne('/-/api/session').flush({ user: null });
    await settle();
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(SIGN_IN_FOR_WATCHLISTS);
    expect(page().querySelector('a.btn.primary')?.getAttribute('href')).toBe(
      '/-/auth/sign-in?return_to=%2F-%2Fwatchlists',
    );
    expect(TestBed.inject(Title).getTitle()).toBe(TITLES.watchlists);
    http.expectNone('/-/api/watchlists');
  });

  it('says there are no watchlists yet, and offers to make one (FR-PERS-06)', async () => {
    await open('/-/watchlists', []);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(NO_WATCHLISTS);
    expect(button('New watchlist')).toBeDefined();
  });

  it('shows the first watchlist in place of /-/watchlists', async () => {
    await open('/-/watchlists');
    expect(url()).toBe('/-/watchlists/7');
    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Dependencies');
    glances().forEach((request) => request.flush(null, { status: 404, statusText: 'Not Found' }));
  });

  it("shows no more of another's watchlist than of one that does not exist", async () => {
    await open('/-/watchlists/99');
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(NO_SUCH_WATCHLIST);
    expect(glances()).toEqual([]);
  });

  it('says when it cannot load the watchlists, and tries again', async () => {
    await harness.navigateByUrl('/-/watchlists/7');
    await settle();
    http.expectOne('/-/api/session').flush({ user: MONA, token: null });
    await settle();
    http.expectOne('/-/api/watchlists').flush(null, { status: 503, statusText: 'Unavailable' });
    http.expectOne('/-/api/shortcuts').flush({ pins: [], recent: [] });
    await settle();
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(WATCHLISTS_UNAVAILABLE);
    button('Try again')!.click();
    await settle();
    http.expectOne('/-/api/watchlists').flush({ watchlists: [DEPENDENCIES] });
    await settle();
    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Dependencies');
    glances().forEach((request) => request.flush(null, { status: 404, statusText: 'Not Found' }));
  });

  it('lists the watchlists beside the one shown, which it marks', async () => {
    await open('/-/watchlists/7');
    const links = [...page().querySelectorAll<HTMLAnchorElement>('.wl-nav a')];
    expect(links.map((link) => shown(link))).toEqual(['Dependencies 2', 'Team 0']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/-/watchlists/7',
      '/-/watchlists/9',
    ]);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual(['page', null]);
    expect(shown(page().querySelector('.wl-nav h2')!)).toBe('Watchlists 2 of 10');
    expect(shown(page().querySelector('.wl-head')!)).toContain('2 of 25 repositories');
    glances().forEach((request) => request.flush(null, { status: 404, statusText: 'Not Found' }));
  });

  it("shows each repository's release, last push, latest run and freshness (FR-PERS-08)", async () => {
    await open('/-/watchlists/7');
    expect(rows().map((row) => row.querySelector('h3 a')?.textContent?.trim())).toEqual([
      'acme/widget',
      'octo/thing',
    ]);
    http.expectOne('/-/api/repositories/acme/widget/glance').flush(glance('Acme/Widget'));
    http
      .expectOne('/-/api/repositories/octo/thing/glance')
      .flush(glance('octo/thing', { visibility: 'private', archived: true }));
    await settle();
    answerActivity();
    await settle();

    const first = row(0);
    // GitHub's spelling, linking to its dashboard.
    expect(first.querySelector('h3 a')?.getAttribute('href')).toBe('/Acme/Widget');
    expect(shown(first.querySelector('h3')!)).toBe('Acme/Widget Public');
    const ago = (time: string) => relativeTime(new Date(time), now);
    expect(shown(first.querySelector('.release')!)).toBe(
      `Latest release v1.2.0 · ${ago('2026-11-02T12:00:00Z')}`,
    );
    expect(first.querySelector('.release a')?.getAttribute('href')).toBe(
      'https://github.com/Acme/Widget/releases/tag/v1.2.0',
    );
    expect(shown(first.querySelector('.pushed')!)).toBe(`Pushed ${ago('2026-11-09T09:00:00Z')}`);
    // The run's state in words, beside its icon and color (NFR-UX-05).
    expect(shown(first.querySelector('.runs')!)).toBe(`${RUN_STATES.failing} CI`);
    expect(first.querySelector('.runs .label.danger')).not.toBeNull();
    // The oldest of its parts: the runs, fetched 20 minutes ago.
    expect(shown(first.querySelector('.updated')!)).toBe(
      `Updated ${ago('2026-11-09T11:40:00.000Z')}`,
    );
    expect(first.querySelector('.spark-wrap')?.getAttribute('aria-label')).toBe(
      '3 commits in the last 26 weeks',
    );
    expect(first.querySelector('.wl-note')).toBeNull();

    expect(shown(row(1).querySelector('h3')!)).toBe('octo/thing Private Archived');
    // No score of how either fares, only what each part says.
    expect(page().textContent).not.toMatch(/score|health/i);
  });

  it('says what a repository has none of, and what failed alone, beside the rest', async () => {
    await open('/-/watchlists/7');
    http.expectOne('/-/api/repositories/acme/widget/glance').flush(
      glance('acme/widget', {
        latest_release: { release: null, fetched_at: '2026-11-09T11:50:00.000Z', stale: null },
        workflow_runs: {
          branch: 'trunk',
          sampled: 0,
          passed: 0,
          failed: 0,
          average_duration: null,
          latest: null,
          hidden: false,
          fetched_at: '2026-11-09T11:50:00.000Z',
          stale: null,
        },
      }),
    );
    http.expectOne('/-/api/repositories/octo/thing/glance').flush(
      glance('octo/thing', {
        latest_release: { failure: 'github' },
        workflow_runs: { failure: 'unavailable' },
      }),
    );
    await settle();
    answerActivity();
    await settle();
    expect(shown(row(0).querySelector('.release')!)).toBe('No releases');
    expect(shown(row(0).querySelector('.runs')!)).toBe(noRuns('trunk'));
    expect(shown(row(1).querySelector('.release')!)).toBe(RELEASE_FAILED);
    expect(shown(row(1).querySelector('.runs')!)).toBe(RUNS_FAILED);
    // What did not fail still shows.
    expect(shown(row(1).querySelector('.pushed')!)).toBe(
      `Pushed ${relativeTime(new Date('2026-11-09T09:00:00Z'), now)}`,
    );
  });

  it('says when it shows saved data, and how old (FR-DATA-05)', async () => {
    await open('/-/watchlists/7');
    http.expectOne('/-/api/repositories/acme/widget/glance').flush(
      glance('acme/widget', {
        fetched_at: '2026-11-09T09:00:00.000Z',
        stale: 'github',
      }),
    );
    http.expectOne('/-/api/repositories/octo/thing/glance').flush(glance('octo/thing'));
    await settle();
    answerActivity();
    await settle();
    expect(shown(row(0).querySelector('.updated')!)).toBe(
      `Updated ${relativeTime(new Date('2026-11-09T09:00:00Z'), now)}`,
    );
    expect(shown(row(0).querySelector('.wl-note')!)).toBe(
      staleData(relativeTime(new Date('2026-11-09T09:00:00Z'), now)),
    );
    expect(row(1).querySelector('.wl-note')).toBeNull();
  });

  it("shows nothing but the name of what GitHub doesn't show the viewer, and what to do (FR-ACC-05)", async () => {
    await open('/-/watchlists/7', [
      { ...DEPENDENCIES, repositories: ['acme/secret', 'acme/sso', 'acme/widget'] },
    ]);
    http
      .expectOne('/-/api/repositories/acme/secret/glance')
      .flush(null, { status: 404, statusText: 'Not Found' });
    http
      .expectOne('/-/api/repositories/acme/sso/glance')
      .flush({ denied: 'token' }, { status: 403, statusText: 'Forbidden' });
    http.expectOne('/-/api/repositories/acme/widget/glance').flush(glance('acme/widget'));
    await settle();
    answerActivity();
    await settle();

    const secret = row(0);
    expect(shown(secret)).toBe(
      `acme/secret ${NOT_FOUND_OR_PRIVATE}. ${notFoundForSignedIn('repository', 'acme/secret')} Add a token`,
    );
    expect(secret.querySelector('.wl-note a')?.getAttribute('href')).toBe('/-/settings');
    expect(secret.querySelector('.spark-wrap, .spark')).toBeNull();
    expect(shown(row(1))).toBe(`acme/sso ${TOKEN_REFUSED} Replace token`);
    // The others show all the same.
    expect(row(2).querySelector('.release')).not.toBeNull();
    // Nothing is asked of what GitHub doesn't show the viewer.
    http.expectNone('/-/api/repositories/acme/secret/commit-activity');
  });

  it('says when a row failed, and tries it again alone, while the others show (FR-PERS-08)', async () => {
    await open('/-/watchlists/7');
    http
      .expectOne('/-/api/repositories/acme/widget/glance')
      .flush(null, { status: 502, statusText: 'Bad Gateway' });
    http.expectOne('/-/api/repositories/octo/thing/glance').flush(glance('octo/thing'));
    await settle();
    answerActivity();
    await settle();
    expect(shown(row(0).querySelector('.wl-note')!)).toBe(rowFailure('github'));
    expect(row(1).querySelector('.release')).not.toBeNull();

    row(0).querySelector<HTMLButtonElement>('.retry')!.click();
    await settle();
    // Only the row that failed asks again.
    const again = http.expectOne('/-/api/repositories/acme/widget/glance');
    expect(glances()).toEqual([]);
    again.flush(glance('acme/widget'));
    await settle();
    answerActivity();
    await settle();
    expect(row(0).querySelector('.release')).not.toBeNull();
  });

  it('asks for no more than 4 rows at once, the others as those end (FR-PERS-09)', async () => {
    const names = ['a/one', 'a/two', 'a/three', 'a/four', 'a/five', 'a/six'];
    await open('/-/watchlists/7', [{ ...DEPENDENCIES, repositories: names }]);
    const urls = (requests: TestRequest[]) => requests.map((request) => request.request.url);
    const first = glances();
    expect(urls(first)).toEqual(
      names.slice(0, 4).map((name) => `/-/api/repositories/${name}/glance`),
    );
    // Each row shows its name while it loads.
    expect(rows().map((row) => row.querySelector('h3 a')?.textContent?.trim())).toEqual(names);
    expect(row(5).getAttribute('aria-busy')).toBe('true');

    first[1].flush(null, { status: 404, statusText: 'Not Found' });
    await settle();
    const next = glances();
    expect(urls(next)).toEqual(['/-/api/repositories/a/five/glance']);
    for (const request of [first[0], first[2], first[3], ...next]) {
      request.flush(null, { status: 404, statusText: 'Not Found' });
    }
    await settle();
    http.expectOne('/-/api/repositories/a/six/glance').flush(null, {
      status: 404,
      statusText: 'Not Found',
    });
  });

  describe('changes', () => {
    /** Opens Dependencies, and answers its rows as not found, for what is changed alone. */
    async function openDependencies(lists?: Watchlist[], pins: object[] = []): Promise<void> {
      await open('/-/watchlists/7', lists, pins);
      notFound();
    }

    function notFound(): void {
      for (const request of glances()) {
        request.flush(null, { status: 404, statusText: 'Not Found' });
      }
    }

    function type(selector: string, text: string): void {
      const input = document.querySelector<HTMLInputElement>(selector)!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
    }

    async function submit(selector: string): Promise<void> {
      document.querySelector<HTMLFormElement>(selector)!.requestSubmit();
      await settle();
    }

    const answered = (request: TestRequest, lists: Watchlist[]) =>
      request.flush({ watchlists: lists });

    it('makes a watchlist, with the pinned repositories if asked, and shows it (FR-PERS-06)', async () => {
      await openDependencies(undefined, [
        { kind: 'repository', name: 'acme/widget' },
        { kind: 'organization', name: 'acme' },
        { kind: 'repository', name: 'octo/rocket' },
      ]);
      button('New watchlist')!.click();
      await settle();
      expect(document.activeElement?.id).toBe('watchlist-create-name');
      // Only repositories go in a watchlist.
      const box = document.querySelector<HTMLInputElement>('.dialog input[type="checkbox"]')!;
      expect(box.parentElement?.textContent?.trim()).toBe('Start with my 2 pinned repositories');

      // A name is checked before the server is asked.
      type('#watchlist-create-name', '  dependencies ');
      await submit('#watchlist-create');
      expect(document.querySelector('.dialog .field-msg')?.textContent?.trim()).toBe(
        problemMessage('name_taken'),
      );
      http.expectNone('/-/api/watchlists');

      type('#watchlist-create-name', '  Upstream ');
      box.click();
      await submit('#watchlist-create');
      const made = http.expectOne({ method: 'POST', url: '/-/api/watchlists' });
      expect(made.request.body).toEqual({
        name: 'Upstream',
        repositories: ['acme/widget', 'octo/rocket'],
      });
      const upstream = { id: 12, name: 'Upstream', repositories: ['acme/widget', 'octo/rocket'] };
      made.flush({ id: 12, watchlists: [DEPENDENCIES, TEAM, upstream] });
      await settle();
      expect(url()).toBe('/-/watchlists/12');
      expect(document.querySelector('.dialog')).toBeNull();
      expect(toasts()).toEqual([created('Upstream')]);
      notFound();
    });

    it('says when the user has as many watchlists as they may', async () => {
      const lists = Array.from({ length: 10 }, (_, index) => ({
        id: index + 1,
        name: `List ${index}`,
        repositories: [],
      }));
      await open('/-/watchlists/1', lists);
      button('New watchlist')!.click();
      await settle();
      type('#watchlist-create-name', 'One more');
      await submit('#watchlist-create');
      expect(document.querySelector('.dialog .field-msg')?.textContent?.trim()).toBe(
        problemMessage('too_many_watchlists'),
      );
      http.expectNone('/-/api/watchlists');
    });

    it('renames a watchlist, and says why it could not (FR-PERS-06)', async () => {
      await openDependencies();
      button('Rename')!.click();
      await settle();
      expect(document.querySelector<HTMLInputElement>('#watchlist-rename-name')!.value).toBe(
        'Dependencies',
      );
      type('#watchlist-rename-name', 'Deps');
      await submit('#watchlist-rename');
      const asked = http.expectOne({ method: 'PUT', url: '/-/api/watchlists/7' });
      expect(asked.request.body).toEqual({ name: 'Deps' });
      asked.flush({ error: 'name_taken' }, { status: 409, statusText: 'Conflict' });
      await settle();
      expect(document.querySelector('.dialog .field-msg')?.textContent?.trim()).toBe(
        problemMessage('name_taken'),
      );

      await submit('#watchlist-rename');
      answered(http.expectOne({ method: 'PUT', url: '/-/api/watchlists/7' }), [
        { ...DEPENDENCIES, name: 'Deps' },
        TEAM,
      ]);
      await settle();
      expect(document.querySelector('.dialog')).toBeNull();
      expect(page().querySelector('h1')?.textContent?.trim()).toBe('Deps');
      expect(toasts()).toEqual([renamedTo('Deps')]);
    });

    it('deletes a watchlist once confirmed, and shows the next (FR-PERS-06)', async () => {
      await openDependencies();
      button('Delete')!.click();
      await settle();
      expect(document.querySelector('.dialog p')?.textContent).toContain('Dependencies and the 2');
      dialogButton('Delete watchlist')!.click();
      await settle();
      http
        .expectOne({ method: 'DELETE', url: '/-/api/watchlists/7' })
        .flush({ watchlists: [TEAM] });
      await settle();
      expect(url()).toBe('/-/watchlists/9');
      expect(page().querySelector('h1')?.textContent?.trim()).toBe('Team');
      expect(toasts()).toEqual([deleted('Dependencies')]);
      expect(page().textContent).not.toContain(NO_SUCH_WATCHLIST);
    });

    it('adds a repository in any form of SRS Table 4-1, and says what it cannot add (FR-PERS-07)', async () => {
      await openDependencies();
      const add = async (text: string) => {
        type('#watchlist-add', text);
        await submit('.wl-add');
      };
      const problem = () => page().querySelector('#watchlist-add-problem')?.textContent?.trim();

      await add('octo');
      expect(problem()).toBe(NOT_A_REPOSITORY);
      await add('gitlab.com/octo/rocket');
      expect(problem()).toBe(searchProblem({ kind: 'not-github' }, 'github.com'));
      await add('github.com/Octo/Thing');
      expect(problem()).toBe(alreadyIn('Octo/Thing'));
      http.expectNone((request) => request.method === 'POST');

      await add('https://github.com/Octo/Rocket/tree/main');
      const asked = http.expectOne({ method: 'POST', url: '/-/api/watchlists/7/repositories' });
      expect(asked.request.body).toEqual({ repositories: ['Octo/Rocket'] });
      answered(asked, [
        { ...DEPENDENCIES, repositories: [...DEPENDENCIES.repositories, 'Octo/Rocket'] },
        TEAM,
      ]);
      await settle();
      expect(problem()).toBeUndefined();
      expect(document.querySelector<HTMLInputElement>('#watchlist-add')!.value).toBe('');
      expect(document.activeElement?.id).toBe('watchlist-add');
      expect(toasts()).toEqual([addedTo('Octo/Rocket', 'Dependencies')]);
      // Only the new row asks for its repository.
      const added = glances();
      expect(added.map((request) => request.request.url)).toEqual([
        '/-/api/repositories/Octo/Rocket/glance',
      ]);
      added.forEach((request) => request.flush(null, { status: 404, statusText: 'Not Found' }));
    });

    it('says when the watchlist holds as many as it may, as the server says too', async () => {
      const problem = () => page().querySelector('#watchlist-add-problem')?.textContent?.trim();
      await openDependencies();
      type('#watchlist-add', 'octo/rocket');
      await submit('.wl-add');
      http
        .expectOne('/-/api/watchlists/7/repositories')
        .flush({ error: 'too_many_repositories' }, { status: 409, statusText: 'Conflict' });
      await settle();
      expect(problem()).toBe(problemMessage('too_many_repositories'));
    });

    it('says so of a full watchlist before the server is asked', async () => {
      const names = Array.from({ length: 25 }, (_, index) => `acme/repo-${index}`);
      await open('/-/watchlists/7', [{ ...DEPENDENCIES, repositories: names }]);
      while (glances().length > 0) {
        notFound();
        await settle();
      }
      type('#watchlist-add', 'octo/rocket');
      await submit('.wl-add');
      expect(page().querySelector('#watchlist-add-problem')?.textContent?.trim()).toBe(
        problemMessage('too_many_repositories'),
      );
      http.expectNone((request) => request.method === 'POST');
    });

    it('offers the pinned repositories that are not in it yet (FR-PERS-07)', async () => {
      await openDependencies(undefined, [
        { kind: 'repository', name: 'Acme/Widget' },
        { kind: 'repository', name: 'octo/rocket' },
        { kind: 'user', name: 'mona' },
        { kind: 'repository', name: 'octo/moon' },
      ]);
      const offered = () =>
        [...page().querySelectorAll('.wl-pins li .grow')].map((item) => item.textContent?.trim());
      expect(offered()).toEqual(['octo/rocket', 'octo/moon']);
      const add = page().querySelector<HTMLButtonElement>('.wl-pins li button')!;
      expect(add.getAttribute('aria-label')).toBe('Add octo/rocket to Dependencies');

      add.click();
      await settle();
      const asked = http.expectOne('/-/api/watchlists/7/repositories');
      expect(asked.request.body).toEqual({ repositories: ['octo/rocket'] });
      answered(asked, [
        { ...DEPENDENCIES, repositories: [...DEPENDENCIES.repositories, 'octo/rocket'] },
      ]);
      await settle();
      notFound();
      expect(offered()).toEqual(['octo/moon']);
      expect(toasts()).toEqual([addedTo('octo/rocket', 'Dependencies')]);
      // Focus moves on to the pin that took its place.
      expect(document.activeElement).toBe(page().querySelector('.wl-pins li button'));
      // With one left, there is nothing to add all of.
      expect(button('Add all')).toBeUndefined();
    });

    it('adds all the pinned repositories at once', async () => {
      await open(
        '/-/watchlists/9',
        [TEAM],
        [
          { kind: 'repository', name: 'octo/rocket' },
          { kind: 'repository', name: 'octo/moon' },
        ],
      );
      button('Add all')!.click();
      await settle();
      const asked = http.expectOne('/-/api/watchlists/9/repositories');
      expect(asked.request.body).toEqual({ repositories: ['octo/rocket', 'octo/moon'] });
      answered(asked, [{ ...TEAM, repositories: ['octo/rocket', 'octo/moon'] }]);
      await settle();
      notFound();
      expect(page().querySelector('.wl-pins')).toBeNull();
      expect(toasts()).toEqual([addedPins(2, 'Team')]);
    });

    it('moves a repository down, keeping focus on the button (FR-PERS-07)', async () => {
      await openDependencies();
      const down = rows()[0].querySelector<HTMLButtonElement>('.down')!;
      expect(down.getAttribute('aria-label')).toBe('Move acme/widget down');
      expect(rows()[0].querySelector<HTMLButtonElement>('.up')!.disabled).toBe(true);
      down.focus();
      down.click();
      await settle();
      const asked = http.expectOne({ method: 'PUT', url: '/-/api/watchlists/7/repositories' });
      expect(asked.request.body).toEqual({ repositories: ['octo/thing', 'acme/widget'] });
      answered(asked, [{ ...DEPENDENCIES, repositories: ['octo/thing', 'acme/widget'] }, TEAM]);
      await settle();
      expect(rows().map((row) => row.querySelector('h3 a')?.textContent?.trim())).toEqual([
        'octo/thing',
        'acme/widget',
      ]);
      // Moving rows asks nothing of their repositories again.
      expect(glances()).toEqual([]);
      // At the bottom, it can go no further down, so focus goes to the button that moves it up.
      expect(document.activeElement).toBe(rows()[1].querySelector('.up'));
      expect(toasts()).toEqual([movedDown('acme/widget')]);
    });

    it('takes a repository out, with focus on the next (FR-PERS-07)', async () => {
      await openDependencies();
      rows()[0].querySelector<HTMLButtonElement>('.remove')!.click();
      await settle();
      http
        .expectOne({ method: 'DELETE', url: '/-/api/watchlists/7/repositories/acme/widget' })
        .flush({ watchlists: [{ ...DEPENDENCIES, repositories: ['octo/thing'] }, TEAM] });
      await settle();
      expect(rows()).toHaveLength(1);
      expect(document.activeElement).toBe(rows()[0].querySelector('.remove'));
      expect(toasts()).toEqual([removedFrom('acme/widget', 'Dependencies')]);
    });

    it('says when a change failed, with focus where it was made', async () => {
      await openDependencies();
      rows()[1].querySelector<HTMLButtonElement>('.remove')!.click();
      await settle();
      http
        .expectOne('/-/api/watchlists/7/repositories/octo/thing')
        .flush(null, { status: 503, statusText: 'Unavailable' });
      await settle();
      expect(page().querySelector('.field-msg.err[role="alert"]')?.textContent?.trim()).toBe(
        problemMessage('failed'),
      );
      expect(rows()).toHaveLength(2);
      expect(document.activeElement).toBe(rows()[1].querySelector('.remove'));
    });
  });
});
