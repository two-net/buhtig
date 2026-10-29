import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  CLEAR_FAILED,
  HISTORY_CLEARED,
  NO_HISTORY,
  NO_PINS,
  PINS_FAILED,
  SHORTCUTS_UNAVAILABLE,
  movedDown,
  movedUp,
  unpinned,
} from './messages';
import { ShortcutSettings } from './shortcuts';

describe('ShortcutSettings', () => {
  let fixture: ComponentFixture<ShortcutSettings>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ShortcutSettings],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
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

  const element = () => fixture.nativeElement as HTMLElement;
  const text = () => element().textContent!.replace(/\s+/g, ' ');
  /** The pins listed, as their links' text and where they lead. */
  const listed = () =>
    [...element().querySelectorAll('.pins li a')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);
  /** The button whose accessible name, hidden words too, is `name`. */
  const button = (name: string) =>
    [...element().querySelectorAll('button')].find(
      (button) => button.textContent?.replace(/\s+/g, ' ').trim() === name,
    );
  const status = () => element().querySelector('[role="status"]')?.textContent?.trim();
  const alert = () => element().querySelector('[role="alert"]')?.textContent?.trim();

  /** Answers what the user pinned and viewed recently. */
  async function load(pins: object[], recent: object[] = [repository('owner/repo')]) {
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
    button(name)!.click();
    await fixture.whenStable();
    // Nothing more until the server answers.
    expect([...element().querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    const request = http.expectOne({ method, url });
    request.flush(answer, { status, statusText: `${status}` });
    await fixture.whenStable();
    return request.request.body;
  }

  it('lists the pins in their order, each with what it can do', async () => {
    await load(PINS);
    expect(listed()).toEqual([
      ['owner/repo', '/owner/repo'],
      ['acme', '/acme'],
      ['acme/widget', '/acme/widget'],
    ]);
    // The first goes no higher, and the last no lower.
    expect(button('Move up owner/repo')!.disabled).toBe(true);
    expect(button('Move down owner/repo')!.disabled).toBe(false);
    expect(button('Move up acme/widget')!.disabled).toBe(false);
    expect(button('Move down acme/widget')!.disabled).toBe(true);
    expect(button('Unpin acme')!.disabled).toBe(false);
    expect(button('Clear history')!.disabled).toBe(false);
  });

  it('says when there are no pins, and no history', async () => {
    await load([], []);
    expect(text()).toContain(NO_PINS);
    expect(text()).toContain(NO_HISTORY);
    expect(element().querySelector('.pins')).toBeNull();
    expect(button('Clear history')).toBeUndefined();
  });

  it('moves a pin up or down, and keeps focus on it (FR-PERS-05)', async () => {
    await load(PINS);
    expect(
      await change('Move up acme', 'PUT', '/-/api/pins', {
        pins: [organization('acme'), repository('owner/repo'), repository('acme/widget')],
      }),
    ).toEqual({
      pins: [organization('acme'), repository('owner/repo'), repository('acme/widget')],
    });
    expect(listed().map(([name]) => name)).toEqual(['acme', 'owner/repo', 'acme/widget']);
    expect(status()).toBe(movedUp('acme'));
    // As high as it goes, so on the button that can move it back.
    expect(document.activeElement).toBe(button('Move down acme'));

    expect(
      await change('Move down owner/repo', 'PUT', '/-/api/pins', {
        pins: [organization('acme'), repository('acme/widget'), repository('owner/repo')],
      }),
    ).toEqual({
      pins: [organization('acme'), repository('acme/widget'), repository('owner/repo')],
    });
    expect(status()).toBe(movedDown('owner/repo'));
    expect(document.activeElement).toBe(button('Move up owner/repo'));

    await change('Move down acme', 'PUT', '/-/api/pins', {
      pins: [repository('acme/widget'), organization('acme'), repository('owner/repo')],
    });
    expect(document.activeElement).toBe(button('Move down acme'));
  });

  it('unpins a pin, and keeps focus nearby (FR-PERS-02)', async () => {
    await load(PINS);
    await change('Unpin owner/repo', 'DELETE', '/-/api/repositories/owner/repo/pin', {
      pins: [organization('acme'), repository('acme/widget')],
    });
    expect(listed().map(([name]) => name)).toEqual(['acme', 'acme/widget']);
    expect(status()).toBe(unpinned('owner/repo'));
    expect(document.activeElement).toBe(button('Unpin acme'));

    await change('Unpin acme/widget', 'DELETE', '/-/api/repositories/acme/widget/pin', {
      pins: [organization('acme')],
    });
    expect(document.activeElement).toBe(button('Unpin acme'));

    await change('Unpin acme', 'DELETE', '/-/api/organizations/acme/pin', { pins: [] });
    expect(text()).toContain(NO_PINS);
    expect(document.activeElement).toBe(element().querySelector('#pins-heading'));
  });

  it('clears the history, and keeps the pins (FR-PERS-03)', async () => {
    await load(PINS);
    await change('Clear history', 'DELETE', '/-/api/history', null, 204);
    expect(status()).toBe(HISTORY_CLEARED);
    expect(text()).toContain(NO_HISTORY);
    expect(button('Clear history')).toBeUndefined();
    expect(listed()).toHaveLength(3);
    expect(document.activeElement).toBe(element().querySelector('#history-heading'));
  });

  it('says what it could not do, and leaves things as they were (NFR-UX-06)', async () => {
    await load(PINS);
    await change('Move up acme', 'PUT', '/-/api/pins', null, 503);
    expect(alert()).toBe(PINS_FAILED);
    expect(listed().map(([name]) => name)).toEqual(['owner/repo', 'acme', 'acme/widget']);
    // Focus is back on the button, disabled meanwhile, to try again (NFR-UX-03).
    expect(document.activeElement).toBe(button('Move up acme'));
    await change('Move down acme', 'PUT', '/-/api/pins', null, 503);
    expect(document.activeElement).toBe(button('Move down acme'));
    await change('Unpin acme', 'DELETE', '/-/api/organizations/acme/pin', null, 503);
    expect(alert()).toBe(PINS_FAILED);
    expect(listed()).toHaveLength(3);
    expect(document.activeElement).toBe(button('Unpin acme'));
    await change('Clear history', 'DELETE', '/-/api/history', null, 503);
    expect(alert()).toBe(CLEAR_FAILED);
    expect(button('Clear history')).toBeDefined();
    expect(document.activeElement).toBe(button('Clear history'));
    expect(status()).toBe('');
  });

  it('says when it cannot tell what is pinned or viewed', async () => {
    http.expectOne('/-/api/shortcuts').flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(alert()).toBe(SHORTCUTS_UNAVAILABLE);
    expect(element().querySelector('.pins')).toBeNull();
    expect(text()).not.toContain(NO_PINS);
    expect(button('Clear history')).toBeUndefined();
  });
});
