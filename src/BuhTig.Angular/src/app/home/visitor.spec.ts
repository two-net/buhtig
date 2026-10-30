import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RecentRepository } from '../recent/recent';
import { FEATURES, HEADLINE, LEDE, NOT_AFFILIATED } from './messages';
import { VisitorHome } from './visitor';

@Component({
  imports: [VisitorHome],
  template: `<app-visitor-home [recent]="recent()" [entrance]="entrance()" />`,
})
class Host {
  readonly recent = signal<RecentRepository[] | undefined>(undefined);
  readonly entrance = signal(false);
}

/** A repository opened here lately, named `name`. */
function opened(name: string): RecentRepository {
  return {
    name,
    ownerAvatarUrl: undefined,
    description: undefined,
    language: undefined,
    stars: 0,
    forks: 0,
    pushedAt: undefined,
    fetchedAt: undefined,
  };
}

describe('VisitorHome', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    // Who is viewing is the account corner's business.
    http.expectOne('/-/api/session').flush({ user: null });
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const more = () => element().querySelector('.hero-more')!;
  /** The repositories offered to try, as their links' text and where they lead. */
  const tries = () =>
    [...more().querySelectorAll('a')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);
  const links = (within: Element) =>
    [...within.querySelectorAll('a')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);

  async function surprise(answer: object | null, status = 200): Promise<void> {
    http.expectOne('/-/api/surprise').flush(answer, { status, statusText: `${status}` });
    await fixture.whenStable();
  }

  it("shows BuhTig's wordmark, what it does, and the search box (UI-02)", async () => {
    await surprise(null, 404);
    const hero = element().querySelector('.hero')!;
    const wordmark = hero.querySelector('app-wordmark')!;
    expect([wordmark.getAttribute('role'), wordmark.getAttribute('aria-label')]).toEqual([
      'img',
      'BuhTig',
    ]);
    expect(hero.querySelector('h1')!.textContent?.trim()).toBe(HEADLINE);
    expect(hero.querySelector('.lede')!.textContent?.trim()).toBe(LEDE);
    const search = hero.querySelector('form[role="search"]')!;
    expect(search.querySelector('input')).not.toBeNull();
    expect(search.querySelector('button[type="submit"]')!.textContent?.trim()).toBe(
      'Show dashboard',
    );
    expect(element().querySelector('main')!.id).toBe('main');
  });

  it('offers to try the 3 repositories opened here last (FR-SRCH-10)', async () => {
    await surprise(null, 404);
    fixture.componentInstance.recent.set(['acme/a', 'acme/b', 'other/c', 'other/d'].map(opened));
    await fixture.whenStable();
    expect(more().textContent).toContain('Try');
    expect(tries()).toEqual([
      ['acme/a', '/acme/a'],
      ['acme/b', '/acme/b'],
      ['other/c', '/other/c'],
    ]);
  });

  it('offers nothing to try until it knows, nor when nothing was opened here', async () => {
    await surprise(null, 404);
    expect(tries()).toEqual([]);
    expect(more().textContent?.trim()).toBe('');
    fixture.componentInstance.recent.set([]);
    await fixture.whenStable();
    expect(tries()).toEqual([]);
    expect(more().textContent?.trim()).toBe('');
  });

  it('offers a surprise, beside what to try, once the server has picked one', async () => {
    fixture.componentInstance.recent.set([opened('acme/a')]);
    await fixture.whenStable();
    expect(more().querySelector('button')).toBeNull();
    await surprise({ name: 'owner/repo' });
    const button = more().querySelector('button')!;
    expect(button.textContent?.trim()).toBe('Surprise me');
    expect(tries()).toEqual([['acme/a', '/acme/a']]);
  });

  it('says what BuhTig shows, in three', async () => {
    await surprise(null, 404);
    const features = [...element().querySelectorAll('.features .feature')];
    expect(features.map((feature) => feature.querySelector('h2')!.textContent?.trim())).toEqual(
      FEATURES.map((feature) => feature.title),
    );
    expect(features.map((feature) => feature.querySelector('p')!.textContent?.trim())).toEqual(
      FEATURES.map((feature) => feature.text),
    );
  });

  it('leads home, to About and Privacy, and to sign in, from its header', async () => {
    await surprise(null, 404);
    const header = element().querySelector('header')!;
    expect(header.querySelector('.brandmark')!.getAttribute('href')).toBe('/');
    expect(links(header.querySelector('nav[aria-label="Site"]')!)).toEqual([
      ['About', '/-/about'],
      ['Privacy', '/-/privacy'],
    ]);
    expect(header.querySelector('app-account a')!.textContent?.trim()).toBe('Sign in');
  });

  it('links to About and Privacy, and says whose it is not, in its footer (UI-08)', async () => {
    await surprise(null, 404);
    const footer = element().querySelector('footer')!;
    expect(links(footer)).toEqual([
      ['About', '/-/about'],
      ['Privacy', '/-/privacy'],
    ]);
    expect(footer.textContent).toContain(NOT_AFFILIATED);
    expect(NOT_AFFILIATED).toBe('Not affiliated with GitHub.');
  });

  it('plays the wordmark when it is to make its entrance (FR-ANIM-01)', async () => {
    await surprise(null, 404);
    const wordmark = () => element().querySelector('app-wordmark')!;
    expect(wordmark().classList).not.toContain('play');
    fixture.componentInstance.entrance.set(true);
    await fixture.whenStable();
    expect(wordmark().classList).toContain('play');
  });
});
