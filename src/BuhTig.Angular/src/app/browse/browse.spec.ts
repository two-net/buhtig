import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { Clock } from '../format/clock';
import { TITLES } from '../messages';
import {
  BROWSE_FAILED,
  NOTHING_TO_BROWSE,
  NO_MATCH,
  SIGN_IN_TO_BROWSE,
  browsePurpose,
  browseStatus,
} from './messages';

describe('Browse (FR-SRCH-14)', () => {
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
    // Listing repositories records no view in anyone's history, nor asks for anything else.
    http.verify();
  });

  const page = () => harness.routeNativeElement!;
  const url = () => TestBed.inject(Router).url;
  const names = () =>
    [...page().querySelectorAll('.browse-list a.ttl')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);
  const status = () => page().querySelector('.count-note')?.textContent?.trim();

  /** The repository `name`, as the server lists it, with `changes`. */
  function listed(name: string, changes: object = {}): object {
    return {
      name,
      owner_avatar_url: null,
      description: `The ${name} repository`,
      language: 'Rust',
      stars: 12,
      forks: 3,
      pushed_at: '2026-11-08T12:00:00Z',
      fetched_at: '2026-11-09T11:00:00.000Z',
      topics: ['cli'],
      ...changes,
    };
  }

  const LISTED = [
    listed('acme/widget', { topics: ['cli', 'widgets'] }),
    listed('octo/thing', { language: 'Go', topics: [] }),
    listed('umbrella/gadget', { language: 'rust', topics: ['widgets'] }),
    listed('mona/notes', { language: null, topics: ['notes'] }),
  ];

  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    TestBed.tick();
    await harness.fixture.whenStable();
  }

  /** Opens `path` for a visitor in `access` mode, and answers what it lists with `repositories`. */
  async function open(
    path: string,
    repositories: object[] = LISTED,
    access: 'public' | 'private' = 'public',
  ): Promise<void> {
    await harness.navigateByUrl(path);
    http.expectOne('/-/api/session').flush({ user: null, access });
    await settle();
    http.expectOne('/-/api/browse').flush({ cap: 200, repositories });
    await settle();
  }

  async function choose(selector: string, value: string): Promise<void> {
    const select = page().querySelector<HTMLSelectElement>(selector)!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  }

  it('lists the public repositories in the shared cache, each leading to its dashboard', async () => {
    await open('/-/browse');
    expect(TestBed.inject(Title).getTitle()).toBe(TITLES.browse);
    // How many it lists at most, as the server says.
    expect(page().querySelector('.help')?.textContent?.trim()).toBe(browsePurpose(200));
    expect(names()).toEqual([
      ['acme/widget', '/acme/widget'],
      ['octo/thing', '/octo/thing'],
      ['umbrella/gadget', '/umbrella/gadget'],
      ['mona/notes', '/mona/notes'],
    ]);
    expect(status()).toBe(browseStatus(4, 4, 1, 1));
    const first = page().querySelector('.browse-list li')!;
    expect(first.querySelector('.desc')?.textContent).toBe('The acme/widget repository');
    expect([...first.querySelectorAll('.topic-tag')].map((tag) => tag.textContent)).toEqual([
      'cli',
      'widgets',
    ]);
    expect(first.querySelector('.rmeta')?.textContent?.replace(/\s+/g, ' ')).toContain('Rust');
  });

  it('narrows the list to one language, whatever its letter case, in the URL', async () => {
    await open('/-/browse');
    const options = [...page().querySelectorAll('select.language option')].map((option) =>
      option.textContent?.trim(),
    );
    // Of the most repositories first, each once.
    expect(options).toEqual(['Any language', 'Rust', 'Go']);
    await choose('select.language', 'Rust');
    expect(url()).toBe('/-/browse?language=Rust');
    expect(names().map(([name]) => name)).toEqual(['acme/widget', 'umbrella/gadget']);
    expect(status()).toBe(browseStatus(2, 4, 1, 1));
    await choose('select.language', '');
    expect(url()).toBe('/-/browse');
    expect(names()).toHaveLength(4);
  });

  it('narrows the list to one topic, from the filter or a topic of a row', async () => {
    await open('/-/browse');
    await choose('select.topic', 'widgets');
    expect(url()).toBe('/-/browse?topic=widgets');
    expect(names().map(([name]) => name)).toEqual(['acme/widget', 'umbrella/gadget']);

    await choose('select.topic', '');
    const notes = [...page().querySelectorAll<HTMLAnchorElement>('.topic-tag')].find(
      (tag) => tag.textContent === 'notes',
    )!;
    notes.click();
    await settle();
    expect(url()).toBe('/-/browse?topic=notes');
    expect(names().map(([name]) => name)).toEqual(['mona/notes']);
  });

  it('takes both filters and the page from a link, and says when none matches', async () => {
    const many = Array.from({ length: 30 }, (_, i) => listed(`acme/r${i}`));
    await open('/-/browse?language=rust&topic=cli&page=2', many);
    expect(status()).toBe(browseStatus(30, 30, 2, 2));
    expect(names().map(([name]) => name)).toEqual([25, 26, 27, 28, 29].map((i) => `acme/r${i}`));
    expect(page().querySelector('select.language option:checked')?.textContent?.trim()).toBe(
      'Rust',
    );
    // The pages, 25 to one.
    const previous = [...page().querySelectorAll<HTMLButtonElement>('.pager button')][0];
    previous.click();
    await settle();
    expect(url()).toBe('/-/browse?language=rust&topic=cli');

    await harness.navigateByUrl('/-/browse?language=haskell');
    await settle();
    expect(page().querySelector('.empty-note')?.textContent).toContain(NO_MATCH);
    // What the link names stays chosen.
    expect(page().querySelector('select.language option:checked')?.textContent?.trim()).toBe(
      'haskell',
    );
  });

  it('says when nothing was opened here yet', async () => {
    await open('/-/browse', []);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(NOTHING_TO_BROWSE);
    expect(page().querySelector('.browse-list')).toBeNull();
  });

  it('says when it could not list them, and tries again (NFR-UX-06)', async () => {
    await harness.navigateByUrl('/-/browse');
    http.expectOne('/-/api/session').flush({ user: null, access: 'public' });
    await settle();
    http.expectOne('/-/api/browse').flush(null, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(BROWSE_FAILED);
    page().querySelector<HTMLButtonElement>('.center button')!.click();
    await settle();
    http.expectOne('/-/api/browse').flush({ cap: 200, repositories: LISTED });
    await settle();
    expect(names()).toHaveLength(4);
  });

  it('asks a visitor in private mode to sign in, and asks for nothing (FR-ACC-03)', async () => {
    await harness.navigateByUrl('/-/browse');
    http.expectOne('/-/api/session').flush({ user: null, access: 'private' });
    await settle();
    http.expectNone('/-/api/browse');
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(SIGN_IN_TO_BROWSE);
    expect(page().querySelector('a.btn.primary')?.getAttribute('href')).toBe(
      '/-/auth/sign-in?return_to=%2F-%2Fbrowse',
    );
  });

  it('lists them to a signed-in user in private mode', async () => {
    await harness.navigateByUrl('/-/browse');
    http.expectOne('/-/api/session').flush({
      user: { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' },
      token: null,
      access: 'private',
    });
    await settle();
    http.expectOne('/-/api/browse').flush({ cap: 200, repositories: LISTED });
    await settle();
    expect(names()).toHaveLength(4);
  });
});
