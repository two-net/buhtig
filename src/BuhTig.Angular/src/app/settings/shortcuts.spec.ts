import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Clock } from '../format/clock';
import { relativeTime } from '../format/format';
import { Toasts } from '../toast/toasts';
import {
  CLEAR_FAILED,
  HISTORY_CLEARED,
  HISTORY_PURPOSE,
  NO_HISTORY,
  NO_PINS,
  PINS_FAILED,
  PINS_PURPOSE,
  SHORTCUTS_UNAVAILABLE,
  movedDown,
  movedUp,
  pinnedCount,
  unpinned,
} from './messages';
import { ShortcutSettings } from './shortcuts';

describe('ShortcutSettings', () => {
  const NOW = new Date('2026-10-22T12:00:00Z').getTime();
  let fixture: ComponentFixture<ShortcutSettings>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ShortcutSettings],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(NOW) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ShortcutSettings);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const repository = (name: string) => ({ kind: 'repository', name });
  const organization = (name: string) => ({ kind: 'organization', name });
  const PINS = [repository('owner/repo'), organization('acme'), repository('acme/widget')];
  const HISTORY = [
    { ...repository('owner/repo'), viewed_at: '2026-10-22T11:00:00Z' },
    { ...organization('github'), viewed_at: '2026-10-19T12:00:00Z' },
    { ...repository('acme/gadget') },
  ];

  const element = () => fixture.nativeElement as HTMLElement;
  const text = () => element().textContent!.replace(/\s+/g, ' ');
  /** The pins listed, as their links' text and where they lead. */
  const listed = () =>
    [...element().querySelectorAll('.pins li a')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);
  /** The text that `element` shows, without the tooltips that hover and focus show. */
  const shown = (element: Element) => {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  };
  /** The dashboards viewed, as their links' text, where they lead, and when, if said. */
  const viewed = () =>
    [...element().querySelectorAll('ul.mini-list li')].map((item) => {
      const when = item.querySelector('.when');
      return [
        item.querySelector('a')!.textContent?.trim(),
        item.querySelector('a')!.getAttribute('href'),
        when ? shown(when) : undefined,
      ];
    });
  /** The button whose accessible name is `name`. */
  const button = (name: string) =>
    [...element().querySelectorAll('button')].find(
      (button) =>
        (button.getAttribute('aria-label') ?? button.textContent?.replace(/\s+/g, ' ').trim()) ===
        name,
    );
  const toasts = () =>
    TestBed.inject(Toasts)
      .toasts()
      .map((toast) => toast.message);
  const alert = () => element().querySelector('[role="alert"]')?.textContent?.trim();

  /** Answers what the user pinned and viewed recently. */
  async function load(pins: object[], recent: object[] = HISTORY): Promise<void> {
    http.expectOne('/-/api/shortcuts').flush({ pins, recent });
    await fixture.whenStable();
  }

  /** Clicks `name`, and answers the server's part, `method` of `url`, with `answer`. */
  async function change(
    name: string,
    method: string,
    url: string,
    answer: object | null,
    status = 200,
  ): Promise<unknown> {
    button(name)!.focus();
    button(name)!.click();
    await fixture.whenStable();
    // Nothing more until the server answers.
    expect([...element().querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    const request = http.expectOne({ method, url });
    request.flush(answer, { status, statusText: `${status}` });
    await fixture.whenStable();
    return request.request.body;
  }

  it('says what pins and history are for, before it knows what they hold', () => {
    expect(text()).toContain(PINS_PURPOSE);
    expect(text()).toContain(HISTORY_PURPOSE);
    expect(element().querySelector('.pins')).toBeNull();
    expect(text()).not.toContain(NO_PINS);
    expect(text()).not.toContain(NO_HISTORY);
    http.expectOne('/-/api/shortcuts');
  });

  it('lists the pins in their order, each with what it can do', async () => {
    await load(PINS);
    expect(element().querySelector('h3')!.textContent?.trim()).toBe(pinnedCount(3));
    expect(pinnedCount(3)).toBe('Pinned (3 of 12)');
    expect(listed()).toEqual([
      ['owner/repo', '/owner/repo'],
      ['acme', '/acme'],
      ['acme/widget', '/acme/widget'],
    ]);
    // The first goes no higher, and the last no lower.
    expect(button('Move owner/repo up')!.disabled).toBe(true);
    expect(button('Move owner/repo down')!.disabled).toBe(false);
    expect(button('Move acme/widget up')!.disabled).toBe(false);
    expect(button('Move acme/widget down')!.disabled).toBe(true);
    expect(button('Unpin acme')!.disabled).toBe(false);
    expect(button('Clear history')!.disabled).toBe(false);
    // Each with the pattern drawn from its account's name, which looks the same each time.
    expect(element().querySelectorAll('.pins li svg.av')).toHaveLength(3);
    expect(element().querySelector('.pins img')).toBeNull();
  });

  it('lists the dashboards viewed, newest first, with when, if the server says', async () => {
    await load([]);
    expect(viewed()).toEqual([
      ['owner/repo', '/owner/repo', relativeTime(new Date('2026-10-22T11:00:00Z'), NOW)],
      ['github', '/github', relativeTime(new Date('2026-10-19T12:00:00Z'), NOW)],
      ['acme/gadget', '/acme/gadget', undefined],
    ]);
    expect(element().querySelectorAll('ul.mini-list .when')).toHaveLength(2);
  });

  it('says when there are no pins, and no history', async () => {
    await load([], []);
    expect(element().querySelector('h3')!.textContent?.trim()).toBe(pinnedCount(0));
    expect(text()).toContain(NO_PINS);
    expect(text()).toContain(NO_HISTORY);
    expect(element().querySelector('.pins')).toBeNull();
    expect(button('Clear history')).toBeUndefined();
  });

  it('moves a pin up or down, and keeps focus on it (FR-PERS-05)', async () => {
    await load(PINS);
    expect(
      await change('Move acme up', 'PUT', '/-/api/pins', {
        pins: [organization('acme'), repository('owner/repo'), repository('acme/widget')],
      }),
    ).toEqual({
      pins: [organization('acme'), repository('owner/repo'), repository('acme/widget')],
    });
    expect(listed().map(([name]) => name)).toEqual(['acme', 'owner/repo', 'acme/widget']);
    expect(toasts()).toEqual([movedUp('acme')]);
    // As high as it goes, so on the button that can move it back.
    expect(document.activeElement).toBe(button('Move acme down'));

    expect(
      await change('Move owner/repo down', 'PUT', '/-/api/pins', {
        pins: [organization('acme'), repository('acme/widget'), repository('owner/repo')],
      }),
    ).toEqual({
      pins: [organization('acme'), repository('acme/widget'), repository('owner/repo')],
    });
    expect(toasts()).toEqual([movedUp('acme'), movedDown('owner/repo')]);
    expect(document.activeElement).toBe(button('Move owner/repo up'));

    // Not yet as far as it goes, so on the button that moved it.
    await change('Move acme down', 'PUT', '/-/api/pins', {
      pins: [repository('acme/widget'), organization('acme'), repository('owner/repo')],
    });
    expect(document.activeElement).toBe(button('Move acme down'));
  });

  it('unpins a pin, and keeps focus nearby (FR-PERS-02)', async () => {
    await load(PINS);
    await change('Unpin owner/repo', 'DELETE', '/-/api/repositories/owner/repo/pin', {
      pins: [organization('acme'), repository('acme/widget')],
    });
    expect(listed().map(([name]) => name)).toEqual(['acme', 'acme/widget']);
    expect(element().querySelector('h3')!.textContent?.trim()).toBe(pinnedCount(2));
    expect(toasts()).toEqual([unpinned('owner/repo')]);
    // On the pin that took its place.
    expect(document.activeElement).toBe(button('Unpin acme'));

    // Or else the one before it.
    await change('Unpin acme/widget', 'DELETE', '/-/api/repositories/acme/widget/pin', {
      pins: [organization('acme')],
    });
    expect(document.activeElement).toBe(button('Unpin acme'));

    // Or else the heading.
    await change('Unpin acme', 'DELETE', '/-/api/organizations/acme/pin', { pins: [] });
    expect(text()).toContain(NO_PINS);
    expect(document.activeElement).toBe(element().querySelector('#shortcuts-heading'));
  });

  it('clears the history, and keeps the pins (FR-PERS-03)', async () => {
    await load(PINS);
    await change('Clear history', 'DELETE', '/-/api/history', null, 204);
    expect(toasts()).toEqual([HISTORY_CLEARED]);
    expect(text()).toContain(NO_HISTORY);
    expect(viewed()).toEqual([]);
    expect(button('Clear history')).toBeUndefined();
    expect(listed()).toHaveLength(3);
    expect(document.activeElement).toBe(element().querySelector('#history-heading'));
  });

  it('says what it could not do, and leaves things as they were (NFR-UX-06)', async () => {
    await load(PINS);
    await change('Move acme up', 'PUT', '/-/api/pins', null, 503);
    expect(alert()).toBe(PINS_FAILED);
    expect(listed().map(([name]) => name)).toEqual(['owner/repo', 'acme', 'acme/widget']);
    // Focus is back on the button, disabled meanwhile, to try again (NFR-UX-03).
    expect(document.activeElement).toBe(button('Move acme up'));
    await change('Move acme down', 'PUT', '/-/api/pins', null, 503);
    expect(document.activeElement).toBe(button('Move acme down'));
    await change('Unpin acme', 'DELETE', '/-/api/organizations/acme/pin', null, 503);
    expect(alert()).toBe(PINS_FAILED);
    expect(listed()).toHaveLength(3);
    expect(document.activeElement).toBe(button('Unpin acme'));
    await change('Clear history', 'DELETE', '/-/api/history', null, 503);
    expect(alert()).toBe(CLEAR_FAILED);
    expect(viewed()).toHaveLength(3);
    expect(document.activeElement).toBe(button('Clear history'));
    expect(toasts()).toEqual([]);
  });

  it('forgets what it could not do once a change goes through', async () => {
    await load(PINS);
    await change('Unpin acme', 'DELETE', '/-/api/organizations/acme/pin', null, 503);
    expect(alert()).toBe(PINS_FAILED);
    button('Unpin acme')!.click();
    await fixture.whenStable();
    expect(alert()).toBeUndefined();
    http
      .expectOne('/-/api/organizations/acme/pin')
      .flush({ pins: [repository('owner/repo'), repository('acme/widget')] });
    await fixture.whenStable();
    expect(alert()).toBeUndefined();
    expect(toasts()).toEqual([unpinned('acme')]);
  });

  it('says when it cannot tell what is pinned or viewed', async () => {
    http.expectOne('/-/api/shortcuts').flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(alert()).toBe(SHORTCUTS_UNAVAILABLE);
    expect(element().querySelector('.pins')).toBeNull();
    expect(text()).not.toContain(NO_PINS);
    expect(text()).not.toContain(NO_HISTORY);
    expect(button('Clear history')).toBeUndefined();
  });
});
