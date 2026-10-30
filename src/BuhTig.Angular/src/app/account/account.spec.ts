import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Session, token } from '../session/session';
import { Account } from './account';
import { TOKEN_STATES } from './messages';

@Component({ template: '' })
class Page {}

describe('Account', () => {
  let fixture: ComponentFixture<Account>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Account],
      providers: [
        provideRouter([{ path: '**', component: Page }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Account);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const avatar = () => element().querySelector<HTMLButtonElement>('button.avatar-btn');
  const menu = () => element().querySelector<HTMLElement>('#account-menu');
  const items = () => [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const signIn = () =>
    [...element().querySelectorAll('a')].find((link) => link.textContent?.trim() === 'Sign in');

  async function answer(body: object | null, init?: { status: number; statusText: string }) {
    http.expectOne('/-/api/session').flush(body, init);
    await fixture.whenStable();
  }

  /** Opens the menu, as a click on the avatar does, once it has put the focus in it. */
  async function open(): Promise<void> {
    avatar()!.click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }

  function press(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    (document.activeElement ?? menu()!).dispatchEvent(event);
    return event;
  }

  const MONA = { login: 'mona', name: 'Mona Lisa', avatar_url: 'https://example.com/mona.png' };

  const TOKEN = {
    type: 'classic',
    last_four: 'abcd',
    scopes: ['repo'],
    expires_at: null,
    status: 'valid',
    last_validated_at: '2026-10-20T12:00:00.000Z',
  };

  it('shows nothing until it knows who is viewing', () => {
    expect(element().textContent?.trim()).toBe('');
    expect(element().querySelector('a, button')).toBeNull();
    http.expectOne('/-/api/session');
  });

  it('offers a visitor to sign in, and to come back here afterwards (FR-AUTH-05)', async () => {
    await answer({ user: null });
    expect(signIn()!.getAttribute('href')).toBe('/-/auth/sign-in?return_to=%2F');
    expect(avatar()).toBeNull();
  });

  it('comes back to the page the visitor is on as they move about', async () => {
    await answer({ user: null });
    await TestBed.inject(Router).navigateByUrl('/owner/repo/issues?q=bug');
    await fixture.whenStable();
    expect(signIn()!.getAttribute('href')).toBe(
      '/-/auth/sign-in?return_to=%2Fowner%2Frepo%2Fissues%3Fq%3Dbug',
    );
  });

  it('offers to sign in when the server cannot tell who is viewing', async () => {
    await answer(null, { status: 503, statusText: 'Service Unavailable' });
    expect(signIn()).toBeDefined();
  });

  it("shows a signed-in user's avatar, which opens a menu (UI-02)", async () => {
    await answer({ user: MONA });
    expect(signIn()).toBeUndefined();
    expect(avatar()!.querySelector('img')!.getAttribute('src')).toBe(MONA.avatar_url);
    expect(avatar()!.getAttribute('aria-label')).toBe('Account menu for @mona');
    expect(avatar()!.getAttribute('aria-haspopup')).toBe('menu');
    expect(avatar()!.getAttribute('aria-expanded')).toBe('false');
    expect(avatar()!.hasAttribute('aria-controls')).toBe(false);
    expect(menu()).toBeNull();

    await open();
    expect(avatar()!.getAttribute('aria-expanded')).toBe('true');
    expect(avatar()!.getAttribute('aria-controls')).toBe('account-menu');
    expect(menu()).not.toBeNull();

    avatar()!.click();
    await fixture.whenStable();
    expect(avatar()!.getAttribute('aria-expanded')).toBe('false');
    expect(menu()).toBeNull();
  });

  it('says who is signed in, and leads home, to Settings, and to sign out', async () => {
    await answer({ user: MONA, token: null });
    await open();
    expect(menu()!.querySelector('.who strong')?.textContent).toBe('@mona');
    expect(menu()!.querySelector('.who small')?.textContent).toBe('Mona Lisa');
    expect(menu()!.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Account');
    expect(items().map((item) => item.textContent?.trim())).toEqual([
      'Home',
      'Settings',
      'Sign out',
    ]);
    const [home, settings] = items();
    expect(home.getAttribute('href')).toBe('/');
    expect(settings.getAttribute('href')).toBe('/-/settings');
    // Signing out changes state, so it is no GET (NFR-SEC-02).
    const form = menu()!.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/-/auth/sign-out');
    expect(form.querySelector('button')!.getAttribute('type')).toBe('submit');
  });

  it('shows the login alone for a user without a display name', async () => {
    await answer({ user: { ...MONA, name: null } });
    await open();
    expect(menu()!.querySelector('.who strong')?.textContent).toBe('@mona');
    expect(menu()!.querySelector('.who small')).toBeNull();
  });

  it("says whether GitHub accepts the user's personal access token (FR-PAT-04)", async () => {
    const said = () => menu()!.querySelector('.tok')?.textContent?.trim();
    await answer({ user: MONA, token: TOKEN });
    await open();
    expect(said()).toBe(TOKEN_STATES.valid);

    const session = TestBed.inject(Session);
    session.setToken(token({ ...TOKEN, status: 'invalid' }));
    await fixture.whenStable();
    expect(said()).toBe(TOKEN_STATES.invalid);

    session.setToken(null);
    await fixture.whenStable();
    expect(said()).toBe(TOKEN_STATES.none);
  });

  it('puts the focus on the first item as the menu opens (NFR-UX-03)', async () => {
    await answer({ user: MONA });
    await open();
    expect(document.activeElement).toBe(items()[0]);
  });

  it('moves the focus through the menu with ↑ and ↓, round and round', async () => {
    await answer({ user: MONA });
    await open();
    const [home, settings, signOut] = items();
    expect(press('ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(settings);
    press('ArrowDown');
    expect(document.activeElement).toBe(signOut);
    press('ArrowDown');
    expect(document.activeElement).toBe(home);
    expect(press('ArrowUp').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(signOut);
    press('ArrowUp');
    expect(document.activeElement).toBe(settings);

    // Other keys do what they always do.
    expect(press('Tab').defaultPrevented).toBe(false);
    expect(press('Enter').defaultPrevented).toBe(false);
  });

  it('closes the menu on Esc, and returns the focus to the avatar', async () => {
    await answer({ user: MONA });
    await open();
    items()[1].focus();
    press('Escape');
    await fixture.whenStable();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(avatar());
  });

  it('closes the menu as one of its links is followed', async () => {
    await answer({ user: MONA });
    await open();
    items()[1].click();
    await fixture.whenStable();
    expect(menu()).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/-/settings');
  });

  it('closes the menu on a click elsewhere, or when the focus moves elsewhere', async () => {
    await answer({ user: MONA });
    await open();
    menu()!.querySelector<HTMLElement>('.tok')!.click();
    await fixture.whenStable();
    expect(menu()).not.toBeNull();
    document.body.click();
    await fixture.whenStable();
    expect(menu()).toBeNull();

    await open();
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      items()[0].dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: items()[1] }),
      );
      await fixture.whenStable();
      expect(menu()).not.toBeNull();
      items()[0].dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }),
      );
      await fixture.whenStable();
      expect(menu()).toBeNull();
    } finally {
      outside.remove();
    }
  });

  it('keeps the menu open as the focus leaves the page, to find it again on return', async () => {
    await answer({ user: MONA });
    await open();
    items()[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await fixture.whenStable();
    expect(menu()).not.toBeNull();
  });

  it('offers to sign in again once the user has been signed out (FR-AUTH-09)', async () => {
    await answer({ user: MONA });
    await open();
    TestBed.inject(Session).end();
    await fixture.whenStable();
    expect(avatar()).toBeNull();
    expect(menu()).toBeNull();
    expect(signIn()).toBeDefined();
  });
});
