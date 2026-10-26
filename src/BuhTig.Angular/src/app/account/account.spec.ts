import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Session } from '../session/session';
import { Account } from './account';
import { ENDED } from './messages';

describe('Account', () => {
  let fixture: ComponentFixture<Account>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Account],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
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
  const avatar = () => element().querySelector<HTMLButtonElement>('button.avatar');
  const menu = () => element().querySelector('#account-menu');

  async function answer(body: object | null, init?: { status: number; statusText: string }) {
    http.expectOne('/-/api/session').flush(body, init);
    await fixture.whenStable();
  }

  const MONA = { login: 'mona', name: 'Mona Lisa', avatar_url: 'https://example.com/mona.png' };

  it('shows nothing until it knows who is viewing', () => {
    expect(element().textContent?.trim()).toBe('');
    http.expectOne('/-/api/session');
  });

  it('offers a visitor to sign in, and to come back here afterwards (FR-AUTH-05)', async () => {
    await answer({ user: null });
    const link = element().querySelector('a')!;
    expect(link.textContent?.trim()).toBe('Sign in');
    expect(link.getAttribute('href')).toBe('/-/auth/sign-in?return_to=%2F');
    expect(avatar()).toBeNull();
  });

  it('offers to sign in when the server cannot tell who is viewing', async () => {
    await answer(null, { status: 503, statusText: 'Service Unavailable' });
    expect(element().querySelector('a')?.textContent?.trim()).toBe('Sign in');
  });

  it("shows a signed-in user's avatar, with a menu (UI-02)", async () => {
    await answer({ user: MONA });
    expect(element().textContent).not.toContain('Sign in');
    expect(avatar()!.querySelector('img')!.getAttribute('src')).toBe(MONA.avatar_url);
    expect(avatar()!.textContent?.trim()).toBe('Account menu, mona');
    expect(avatar()!.getAttribute('aria-expanded')).toBe('false');
    expect(menu()).toBeNull();

    avatar()!.click();
    await fixture.whenStable();
    expect(avatar()!.getAttribute('aria-expanded')).toBe('true');
    expect(avatar()!.getAttribute('aria-controls')).toBe('account-menu');
    expect(menu()!.textContent).toContain('Mona Lisa');
    expect(menu()!.querySelector('a')!.getAttribute('href')).toBe('/-/settings');
    // Signing out changes state, so it is no GET (NFR-SEC-02).
    const form = menu()!.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/-/auth/sign-out');
    expect(form.querySelector('button')!.textContent?.trim()).toBe('Sign out');

    avatar()!.click();
    await fixture.whenStable();
    expect(menu()).toBeNull();
  });

  it('asks a user signed out while the page was open to sign in again (FR-AUTH-09)', async () => {
    await answer({ user: MONA });
    TestBed.inject(Session).end();
    await fixture.whenStable();
    expect(avatar()).toBeNull();
    expect(element().querySelector('a')!.textContent?.trim()).toBe('Sign in');
    expect(element().querySelector('[role="alert"]')!.textContent?.trim()).toBe(ENDED);

    // Put away as the menu is, with a click elsewhere.
    element().querySelector<HTMLElement>('[role="alert"]')!.click();
    await fixture.whenStable();
    expect(element().querySelector('[role="alert"]')).not.toBeNull();
    document.body.click();
    await fixture.whenStable();
    expect(element().querySelector('[role="alert"]')).toBeNull();
  });

  it('tells a visitor of no sign-out', async () => {
    await answer({ user: null });
    TestBed.inject(Session).end();
    await fixture.whenStable();
    expect(element().querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the login alone for a user without a display name', async () => {
    await answer({ user: { ...MONA, name: null } });
    avatar()!.click();
    await fixture.whenStable();
    expect(menu()!.querySelector('strong')).toBeNull();
    expect(menu()!.textContent?.trim()).toMatch(/^mona/);
  });

  it('closes the menu on Esc, and returns the focus to the avatar', async () => {
    await answer({ user: MONA });
    avatar()!.click();
    await fixture.whenStable();
    const settings = menu()!.querySelector('a')!;
    settings.focus();
    settings.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(avatar());
  });

  it('closes the menu on a click elsewhere, or when the focus moves elsewhere', async () => {
    await answer({ user: MONA });
    avatar()!.click();
    await fixture.whenStable();
    menu()!.querySelector('p')!.click();
    await fixture.whenStable();
    expect(menu()).not.toBeNull();
    document.body.click();
    await fixture.whenStable();
    expect(menu()).toBeNull();

    avatar()!.click();
    await fixture.whenStable();
    const outside = document.createElement('button');
    document.body.append(outside);
    menu()!
      .querySelector('a')!
      .dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    await fixture.whenStable();
    expect(menu()).toBeNull();
    outside.remove();
  });
});
