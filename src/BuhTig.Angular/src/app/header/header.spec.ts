import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Crumb, Header } from './header';

@Component({
  imports: [Header],
  template: `
    <app-header [crumbs]="crumbs()" [prefill]="prefill()" [slash]="slash()">
      <nav class="below">Tabs</nav>
    </app-header>
  `,
})
class Host {
  readonly crumbs = signal<Crumb[]>([]);
  readonly prefill = signal('');
  readonly slash = signal(true);
  readonly header = viewChild.required(Header);
}

describe('Header (UI-03)', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const header = () => element().querySelector('header')!;
  const input = () => header().querySelector('input')!;
  const crumbs = () =>
    [...header().querySelectorAll('nav.crumbs a')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);

  async function set(change: () => void): Promise<void> {
    change();
    await fixture.whenStable();
  }

  it('leads home from the wordmark', () => {
    http.expectOne('/-/api/session');
    const home = header().querySelector('a.brandmark')!;
    expect(home.getAttribute('href')).toBe('/');
    expect(home.getAttribute('aria-label')).toBe('BuhTig home');
  });

  it("shows a compact search box, filled in with the dashboard's resource", async () => {
    http.expectOne('/-/api/session');
    await set(() => fixture.componentInstance.prefill.set('github.com/acme/widget'));
    expect(input().value).toBe('github.com/acme/widget');
    expect(input().placeholder).toBe('Type / to open a dashboard');
    expect(header().querySelector('button[type="submit"]')).toBeNull();
    expect(fixture.componentInstance.header().search()).toBeDefined();
  });

  it('focuses its search box on /, unless the page has another for it', async () => {
    http.expectOne('/-/api/session');
    const press = () =>
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }),
      );
    await set(() => fixture.componentInstance.slash.set(false));
    press();
    expect(document.activeElement).not.toBe(input());
    await set(() => fixture.componentInstance.slash.set(true));
    press();
    expect(document.activeElement).toBe(input());
  });

  it('has no breadcrumbs outside a dashboard', () => {
    http.expectOne('/-/api/session');
    expect(header().querySelector('nav.crumbs')).toBeNull();
  });

  it("shows a dashboard's breadcrumbs, one after another", async () => {
    http.expectOne('/-/api/session');
    await set(() =>
      fixture.componentInstance.crumbs.set([
        { label: 'acme', link: '/acme' },
        { label: 'widget', link: '/acme/widget' },
      ]),
    );
    expect(header().querySelector('nav.crumbs')?.getAttribute('aria-label')).toBe('Breadcrumb');
    expect(crumbs()).toEqual([
      ['acme', '/acme'],
      ['widget', '/acme/widget'],
    ]);
    // Between them, and for the eye alone.
    const slashes = [...header().querySelectorAll('nav.crumbs .slash')];
    expect(slashes.map((slash) => [slash.textContent, slash.getAttribute('aria-hidden')])).toEqual([
      ['/', 'true'],
    ]);
  });

  it('says who is viewing, once the server says (UI-02)', async () => {
    expect(header().querySelector('app-account')?.textContent?.trim()).toBe('');
    http.expectOne('/-/api/session').flush({ user: null });
    await fixture.whenStable();
    expect(header().querySelector('app-account a')?.textContent?.trim()).toBe('Sign in');
  });

  it('shows what the page puts below it, such as its tabs, in it', () => {
    http.expectOne('/-/api/session');
    const below = header().querySelector('nav.below')!;
    expect(below.textContent).toBe('Tabs');
    expect(below.previousElementSibling?.classList).toContain('hdr-bar');
  });
});
