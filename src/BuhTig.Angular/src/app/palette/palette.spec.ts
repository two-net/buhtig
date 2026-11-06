import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { MockInstance } from 'vitest';
import { HEADING, HINT, LABEL, NO_MATCHES, START } from './messages';
import { Palette } from './palette';

@Component({
  imports: [Palette],
  template: `
    <button id="opener">Open</button>
    @if (open()) {
      <app-palette (closed)="close()" />
    }
  `,
})
class Host {
  readonly open = signal(false);
  closes = 0;

  close(): void {
    this.closes++;
    this.open.set(false);
  }
}

const MONA = { login: 'mona', name: 'Mona Lisa', avatar_url: 'https://example.com/mona.png' };

/** A public repository opened on this BuhTig lately, as the server describes it. */
function opened(name: string) {
  return {
    name,
    owner_avatar_url: null,
    description: null,
    language: null,
    stars: 0,
    forks: 0,
    pushed_at: null,
    fetched_at: null,
  };
}

describe('Palette (FR-SRCH-12)', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;
  let navigate: MockInstance<Router['navigateByUrl']>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(Host);
    // Attached, so that what is in it can take the focus.
    document.body.append(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => {
    (fixture.nativeElement as HTMLElement).remove();
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const dialog = () => element().querySelector<HTMLElement>('[role="dialog"]');
  const input = () => element().querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const listbox = () => element().querySelector<HTMLElement>('[role="listbox"]')!;
  const options = () => [...element().querySelectorAll<HTMLElement>('[role="option"]')];
  /**
   * The suggestions, as their names, with no space between the parts that matched and the rest,
   * and their tabs, as the list shows them.
   */
  const names = () =>
    options().map((option) => {
      const name = option.querySelector('.palette-name')!.textContent;
      const tab = option.querySelector('.palette-tab')?.textContent?.trim();
      return tab ? `${name} › ${tab}` : name;
    });
  const sources = () =>
    options().map((option) => option.querySelector('.palette-source')?.textContent?.trim());
  const active = () => options().findIndex((option) => option.ariaSelected === 'true');
  const status = () => element().querySelector('[role="status"]')?.textContent?.trim();
  const empty = () => element().querySelector('.palette-empty')?.textContent?.trim();

  /** Opens the palette from its opener, as Ctrl+K there would. */
  async function open(): Promise<void> {
    element().querySelector<HTMLButtonElement>('#opener')!.focus();
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
  }

  /** Answers who is viewing, and what the palette asks for, as the server would. */
  async function answer(
    who: { user: object | null; access?: string },
    personal?: { pins: object[]; recent: object[] },
    repositories = [opened('angular/angular')],
  ): Promise<void> {
    http.expectOne('/-/api/session').flush(who);
    await fixture.whenStable();
    if (personal !== undefined) {
      http.expectOne('/-/api/shortcuts').flush(personal);
    }
    http.expectOne('/-/api/recent').flush({ repositories });
    await fixture.whenStable();
  }

  async function signedIn(): Promise<void> {
    await open();
    await answer(
      { user: MONA },
      {
        pins: [{ kind: 'repository', name: 'tokio-rs/axum' }],
        recent: [
          { kind: 'organization', name: 'rust-lang', viewed_at: '2026-11-06T10:00:00Z' },
          { kind: 'user', name: 'octocat', viewed_at: '2026-11-05T10:00:00Z' },
        ],
      },
    );
  }

  /** Types `text` into the input, which suggests at once, with no request in between. */
  function type(text: string): void {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    input().dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  it('is a modal dialog, named for assistive technology, whose input has the focus', async () => {
    await signedIn();
    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    expect(dialog()!.querySelector('h2')!.textContent).toBe(HEADING);
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute('aria-label')).toBe(LABEL);
    expect(document.getElementById(input().getAttribute('aria-describedby')!)?.textContent).toBe(
      HINT,
    );
  });

  it("lists the user's pins, then what they viewed, then what was opened here (FR-SRCH-08, FR-SRCH-11)", async () => {
    await signedIn();
    expect(names()).toEqual(['tokio-rs/axum', 'rust-lang', 'octocat', 'angular/angular']);
    expect(sources()).toEqual([
      'Pinned',
      'Recently viewed',
      'Recently viewed',
      'Viewed on this BuhTig',
    ]);
    expect(status()).toBe('4 suggestions');
  });

  it('lists what was opened here alone for a visitor, who has no shortcuts', async () => {
    await open();
    await answer({ user: null, access: 'public' });
    expect(names()).toEqual(['angular/angular']);
  });

  it('asks for nothing that a visitor may not see in private mode (FR-ACC-03)', async () => {
    await open();
    http.expectOne('/-/api/session').flush({ user: null, access: 'private' });
    await fixture.whenStable();
    http.expectNone('/-/api/recent');
    expect(names()).toEqual([]);
    expect(empty()).toBe(START);
  });

  it('is a combobox of a list, whose chosen option assistive technology is told of', async () => {
    await signedIn();
    expect(input().getAttribute('aria-autocomplete')).toBe('list');
    expect(input().getAttribute('aria-controls')).toBe(listbox().id);
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    expect(active()).toBe(0);
  });

  it('moves through the suggestions with ↑ and ↓, around from end to end (NFR-UX-03)', async () => {
    await signedIn();
    expect(press('ArrowDown').defaultPrevented).toBe(true);
    expect(active()).toBe(1);
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    press('ArrowUp');
    press('ArrowUp');
    expect(active()).toBe(3);
    press('ArrowDown');
    expect(active()).toBe(0);
  });

  it('suggests what matches as the user types, at once (NFR-PERF-06)', async () => {
    await signedIn();
    press('ArrowDown');
    type('rust');
    expect(names()).toEqual(['rust-lang', 'rust']);
    // The best match is the one that Enter opens.
    expect(active()).toBe(0);
    expect(status()).toBe('2 suggestions');
    expect([...options()[0].querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'rust',
    ]);
    http.verify();
  });

  it('opens the chosen suggestion on Enter, and closes', async () => {
    await signedIn();
    press('ArrowDown');
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/rust-lang');
    expect(fixture.componentInstance.closes).toBe(1);
  });

  it('opens a suggestion that is clicked, and keeps the focus in the input until then', async () => {
    await signedIn();
    const option = options()[2];
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    option.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    option.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    fixture.detectChanges();
    expect(active()).toBe(2);
    option.click();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/octocat');
    expect(fixture.componentInstance.closes).toBe(1);
  });

  it("opens a dashboard's tab of the name after the query (FR-SRCH-13)", async () => {
    await signedIn();
    type('axum pulls');
    expect(names()).toEqual(['tokio-rs/axum › Pull requests']);
    press('Enter');
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/tokio-rs/axum/pulls');
  });

  it('opens what the user pastes, in any form of Table 4-1', async () => {
    await signedIn();
    type('https://github.com/owner/repo/tree/main');
    expect(names()[0]).toBe('owner/repo');
    expect(sources()[0]).toBe('Repository');
    press('Enter');
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/owner/repo');
  });

  it('says why what the user typed opens nothing, and opens nothing on Enter (NFR-UX-06)', async () => {
    await signedIn();
    type('gitlab.com/owner/repo');
    expect(options()).toEqual([]);
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().hasAttribute('aria-activedescendant')).toBe(false);
    expect(empty()).toBe('BuhTig supports github.com URLs only.');
    expect(status()).toBe('No suggestions');
    press('Enter');
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.closes).toBe(0);
  });

  it('says when nothing matches', async () => {
    await open();
    await answer({ user: null, access: 'public' });
    type('https://github.c');
    expect(empty()).toBe(NO_MATCHES);
  });

  it('closes on Esc, and gives the focus back to what had it', async () => {
    await signedIn();
    press('Escape');
    await fixture.whenStable();
    expect(fixture.componentInstance.closes).toBe(1);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(element().querySelector('#opener'));
  });

  it('suggests what it can when the server cannot say what the user has', async () => {
    await open();
    http.expectOne('/-/api/session').flush({ user: MONA });
    await fixture.whenStable();
    http.expectOne('/-/api/shortcuts').flush(null, { status: 503, statusText: 'Unavailable' });
    http.expectOne('/-/api/recent').flush({ repositories: [opened('angular/angular')] });
    await fixture.whenStable();
    expect(names()).toEqual(['angular/angular']);
  });

  it('starts no animation of its own, beyond the dialog that motion settings still (FR-ANIM-10)', async () => {
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate;
    try {
      await signedIn();
      type('ax');
      press('ArrowDown');
      expect(animate).not.toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    }
  });
});
