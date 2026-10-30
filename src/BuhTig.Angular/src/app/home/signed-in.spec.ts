import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Clock } from '../format/clock';
import { compactNumber, relativeTime } from '../format/format';
import { RecentRepository } from '../recent/recent';
import { Shortcut as SlashShortcut } from '../search/shortcut';
import { MAX_SHORTCUTS } from '../shortcuts/pick';
import { SignedInHome } from './signed-in';
import {
  NOTHING_RECENT,
  NO_DASHBOARDS,
  NO_MATCHES,
  PINNED,
  RECENTLY_VIEWED,
  RECENT_HEADING,
  SHORTCUTS_UNAVAILABLE,
  TOKEN_TEXTS,
} from './signed-in-messages';

@Component({
  imports: [SignedInHome],
  template: `<app-signed-in-home [recent]="recent()" />`,
})
class Host {
  readonly recent = signal<RecentRepository[] | undefined>(undefined);
}

/** `acme/widget`, as the feed shows it. */
const WIDGET: RecentRepository = {
  name: 'acme/widget',
  ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  description: 'Widgets for everyone',
  language: 'Rust',
  stars: 12_345,
  forks: 30,
  pushedAt: new Date('2026-10-20T08:00:00Z'),
  fetchedAt: new Date('2026-10-22T11:00:00Z'),
};

describe('SignedInHome', () => {
  const NOW = new Date('2026-10-22T12:00:00Z').getTime();
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(NOW) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const MONA = { login: 'mona', name: 'Mona Lisa', avatar_url: 'https://example.com/mona.png' };
  const CLASSIC = {
    type: 'classic',
    last_four: 'abcd',
    scopes: ['repo'],
    expires_at: null,
    status: 'valid',
    last_validated_at: null,
  };
  const repository = (name: string) => ({ kind: 'repository', name });
  const organization = (name: string) => ({ kind: 'organization', name });

  const element = () => fixture.nativeElement as HTMLElement;
  const side = () => element().querySelector('.dash-side')!;
  const filter = () => side().querySelector<HTMLInputElement>('input')!;
  /** The dashboards listed, as their names, where they lead, and whether pinned. */
  const dashboards = () =>
    [...side().querySelectorAll('.side-repos a')].map((link) => [
      link.querySelector('span')!.textContent?.trim(),
      link.getAttribute('href'),
      link.getAttribute('title'),
    ]);
  const empty = () => side().querySelector('.empty-note')?.textContent?.trim();
  const cards = () => [...element().querySelectorAll('.feed .feed-card')];
  /** The text that `element` shows, without the tooltips that hover and focus show. */
  const shown = (element: Element) => {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"], .sr').forEach((hidden) => hidden.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  };
  const card = (heading: string) =>
    element().querySelector(`section[aria-labelledby="${heading}"]`)!;

  async function session(token: object | null = null): Promise<void> {
    http.expectOne('/-/api/session').flush({ user: MONA, token });
    await fixture.whenStable();
  }

  async function shortcuts(pins: object[], recent: object[]): Promise<void> {
    http.expectOne('/-/api/shortcuts').flush({ pins, recent });
    await fixture.whenStable();
  }

  async function type(text: string): Promise<void> {
    filter().value = text;
    filter().dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('lists the pins first, then the dashboards viewed lately, each leading to its own (FR-SRCH-08)', async () => {
    await session();
    await shortcuts(
      [repository('acme/widget'), organization('github')],
      [
        { ...organization('angular'), viewed_at: '2026-10-22T11:00:00Z' },
        { ...repository('ACME/Widget'), viewed_at: '2026-10-21T11:00:00Z' },
      ],
    );
    expect(side().querySelector('h2')!.textContent?.trim()).toBe('Top dashboards');
    expect(dashboards()).toEqual([
      ['acme/widget', '/acme/widget', PINNED],
      ['github', '/github', PINNED],
      ['angular', '/angular', RECENTLY_VIEWED],
    ]);
    // The pins say so, in words too.
    const links = [...side().querySelectorAll('.side-repos a')];
    expect(links.map((link) => link.querySelector('.sr')?.textContent)).toEqual([
      `(${PINNED})`,
      `(${PINNED})`,
      undefined,
    ]);
    expect(empty()).toBeUndefined();
  });

  it(`lists at most ${MAX_SHORTCUTS} dashboards`, async () => {
    await session();
    await shortcuts(
      [],
      Array.from({ length: 20 }, (_, i) => organization(`org-${i}`)),
    );
    expect(dashboards()).toHaveLength(12);
    expect(dashboards()[11][0]).toBe('org-11');
  });

  it('finds a dashboard by name, whatever its letter case', async () => {
    await session();
    await shortcuts(
      [repository('acme/widget')],
      [organization('angular'), repository('Acme/Gadget')],
    );
    await type('ACME');
    expect(dashboards().map(([name]) => name)).toEqual(['acme/widget', 'Acme/Gadget']);
    await type('  gadget ');
    expect(dashboards().map(([name]) => name)).toEqual(['Acme/Gadget']);
    await type('nothing');
    expect(dashboards()).toEqual([]);
    expect(empty()).toBe(NO_MATCHES);
    await type('');
    expect(dashboards()).toHaveLength(3);
    expect(empty()).toBeUndefined();
    expect(filter().getAttribute('aria-label')).toBe('Filter your dashboards');
  });

  it('says where dashboards come from while there are none', async () => {
    await session();
    // Nothing until the server says.
    expect(empty()).toBeUndefined();
    await shortcuts([], []);
    expect(dashboards()).toEqual([]);
    expect(empty()).toBe(NO_DASHBOARDS);
    expect(NO_DASHBOARDS).toBe('Dashboards you pin or open appear here.');
    await type('acme');
    expect(empty()).toBe(NO_DASHBOARDS);
  });

  it('says when it cannot list the dashboards', async () => {
    await session();
    http.expectOne('/-/api/shortcuts').flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(dashboards()).toEqual([]);
    expect(empty()).toBe(SHORTCUTS_UNAVAILABLE);
  });

  it('shows what was opened on this BuhTig lately, each as a card', async () => {
    await session();
    await shortcuts([], []);
    expect(element().querySelector('h1')!.textContent?.trim()).toBe('Home');
    expect(element().querySelector('.recent-title')!.textContent?.trim()).toBe(RECENT_HEADING);
    // Nothing until it knows.
    expect(cards()).toEqual([]);
    expect(element().querySelector('.dash-main .empty-note')).toBeNull();

    fixture.componentInstance.recent.set([WIDGET]);
    await fixture.whenStable();
    const [shown_] = cards();
    const link = shown_.querySelector('.fc-top a')!;
    expect([link.textContent?.trim(), link.getAttribute('href')]).toEqual([
      'acme/widget',
      '/acme/widget',
    ]);
    expect(shown_.querySelector('.fc-top img')!.getAttribute('src')).toBe(WIDGET.ownerAvatarUrl);
    expect(shown(shown_.querySelector('.fc-top > span')!)).toBe(
      `viewed ${relativeTime(WIDGET.fetchedAt!, NOW)}`,
    );
    expect(shown_.querySelector('p')!.textContent?.trim()).toBe('Widgets for everyone');
    expect([...shown_.querySelectorAll('.rmeta > span')].map((span) => shown(span))).toEqual([
      'Rust',
      compactNumber(12_345),
      '30',
      `Updated ${relativeTime(WIDGET.pushedAt!, NOW)}`,
    ]);
    // The exact number, for hover and for assistive technology.
    expect(shown_.querySelector('.rmeta [title="12,345"]')).not.toBeNull();
  });

  it('shows nothing of a repository that the server does not say', async () => {
    await session();
    await shortcuts([], []);
    fixture.componentInstance.recent.set([
      {
        ...WIDGET,
        ownerAvatarUrl: undefined,
        description: undefined,
        language: undefined,
        pushedAt: undefined,
        fetchedAt: undefined,
      },
    ]);
    await fixture.whenStable();
    const [shown_] = cards();
    expect(shown_.querySelector('p')).toBeNull();
    expect(shown_.querySelector('img')).toBeNull();
    expect(shown_.querySelector('.fc-top > span')).toBeNull();
    expect(shown_.querySelector('.lang-dot')).toBeNull();
    expect(shown_.querySelectorAll('.rmeta > span')).toHaveLength(2);
  });

  it('colors the languages of the most repositories first, as the charts do', async () => {
    await session();
    await shortcuts([], []);
    fixture.componentInstance.recent.set([
      { ...WIDGET, name: 'acme/a', language: 'Go' },
      { ...WIDGET, name: 'acme/b', language: 'Rust' },
      { ...WIDGET, name: 'acme/c', language: 'Rust' },
    ]);
    await fixture.whenStable();
    expect(
      cards().map((card) => card.querySelector<HTMLElement>('.lang-dot')!.style.background),
    ).toEqual(['var(--s2)', 'var(--s1)', 'var(--s1)']);
  });

  it('says when nothing was opened here yet', async () => {
    await session();
    await shortcuts([], []);
    fixture.componentInstance.recent.set([]);
    await fixture.whenStable();
    expect(cards()).toEqual([]);
    expect(element().querySelector('.dash-main .empty-note')!.textContent?.trim()).toBe(
      NOTHING_RECENT,
    );
  });

  it('says what a personal access token would add, by the state of the one saved (FR-PAT-01)', async () => {
    const privateCard = () => card('private-heading');
    const link = () => privateCard().querySelector('a')!;

    await session(null);
    await shortcuts([], []);
    expect(privateCard().querySelector('p')!.textContent?.trim()).toBe(TOKEN_TEXTS.none);
    expect([link().textContent?.trim(), link().getAttribute('href')]).toEqual([
      'Add a token',
      '/-/settings',
    ]);
  });

  it('says that a valid token shows private repositories, and offers to manage it', async () => {
    await session(CLASSIC);
    await shortcuts([], []);
    const privateCard = card('private-heading');
    expect(privateCard.querySelector('p')!.textContent?.trim()).toBe(TOKEN_TEXTS.valid);
    expect(privateCard.querySelector('a')!.textContent?.trim()).toBe('Manage token');
  });

  it('says that private repositories are hidden while GitHub rejects the token (FR-PAT-07)', async () => {
    await session({ ...CLASSIC, status: 'invalid' });
    await shortcuts([], []);
    const privateCard = card('private-heading');
    expect(privateCard.querySelector('p')!.textContent?.trim()).toBe(TOKEN_TEXTS.invalid);
    expect(privateCard.querySelector('a')!.textContent?.trim()).toBe('Add a token');
  });

  it('lists the keys BuhTig answers to, without `/` while it is turned off (WCAG 2.1.4)', async () => {
    await session();
    await shortcuts([], []);
    const keys = () =>
      [...card('keyboard-heading').querySelectorAll('li')].map((item) =>
        item.textContent?.replace(/\s+/g, ' ').trim(),
      );
    expect(keys()).toEqual(['/Jump to search', 'EscClear the search box', '←→Read chart values']);
    TestBed.inject(SlashShortcut).set(false);
    await fixture.whenStable();
    expect(keys()).toEqual(['EscClear the search box', '←→Read chart values']);
    TestBed.inject(SlashShortcut).set(true);
  });

  it('has a search box of its own, which `/` focuses rather than the header’s', async () => {
    await session();
    await shortcuts([], []);
    const boxes = [...element().querySelectorAll<HTMLInputElement>('form[role="search"] input')];
    expect(boxes).toHaveLength(2);
    const own = element().querySelector<HTMLInputElement>('.dash-search input')!;
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(document.activeElement).toBe(own);
  });
});
