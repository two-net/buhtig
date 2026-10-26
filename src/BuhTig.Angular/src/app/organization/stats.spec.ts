import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { compactNumber, exactNumber } from '../format/format';
import { FAILED } from '../widget/messages';
import { limited } from './messages';
import { OrganizationStats } from './stats';

@Component({
  imports: [OrganizationStats],
  template: `<app-organization-stats [org]="org()" />`,
})
class Host {
  readonly org = signal('acme');
}

/** The figures of `acme`, as the server gives them. */
const ACME = {
  repositories: 1_234,
  private: 0,
  internal: 0,
  stars: 98_765,
  forks: 4_321,
  open_issues_and_pull_requests: 567,
  top_language: 'Rust',
  truncated: false,
};

describe('OrganizationStats', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const badges = () =>
    [...element().querySelectorAll('.badge')].map((badge) => badge.textContent?.trim());
  const note = () => element().querySelector('.limited')?.textContent?.trim();

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  /** Each card, as its label and the figure it shows. */
  const cards = () =>
    [...element().querySelectorAll('dl > div')].map((card) => [
      card.querySelector('dt')?.textContent?.trim(),
      shown(card.querySelector('dd')!),
    ]);

  async function answer(body: object): Promise<void> {
    http.expectOne('/-/api/organizations/acme/stats').flush(body);
    await fixture.whenStable();
  }

  it('shows five figures, in short with the exact number on hover and focus (FR-ORG-02)', async () => {
    await answer(ACME);
    expect(cards()).toEqual([
      ['Repositories', compactNumber(1_234)],
      ['Stars', compactNumber(98_765)],
      ['Forks', compactNumber(4_321)],
      ['Open issues and pull requests', '567'],
      ['Top language', 'Rust'],
    ]);
    expect(element().querySelector('dd [role="tooltip"]')?.textContent).toBe(exactNumber(1_234));
    expect(element().querySelector('.badges, .limited')).toBeNull();
  });

  it('says how many repositories are private or internal, in words (FR-ORG-09)', async () => {
    await answer({ ...ACME, private: 3, internal: 2 });
    expect(badges()).toEqual(['3 private', '2 internal']);
    // The badges are beside the count of repositories, not in its place.
    expect(cards()[0]).toEqual(['Repositories', compactNumber(1_234)]);
  });

  it('marks only the kinds of repository there are', async () => {
    await answer({ ...ACME, internal: 1 });
    expect(badges()).toEqual(['1 internal']);
  });

  it('says when no repository has a language', async () => {
    await answer({ ...ACME, top_language: null });
    expect(cards().at(-1)).toEqual(['Top language', 'None']);
  });

  it('says when its figures cover only the repositories pushed to last (FR-ORG-08)', async () => {
    await answer({ ...ACME, repositories: 1_000, truncated: true });
    expect(note()).toBe(limited(1_000));
    expect(note()).toBe(
      `This organization has more than ${exactNumber(1_000)} repositories. ` +
        `These figures cover the ${exactNumber(1_000)} pushed to most recently.`,
    );
  });

  it('spans the grid, with a heading for assistive technology alone', async () => {
    const widget = element().querySelector('app-widget')!;
    const heading = widget.querySelector('h2')!;
    expect(widget.classList.contains('wide')).toBe(true);
    expect(heading.textContent?.trim()).toBe('Statistics');
    expect(heading.classList.contains('visually-hidden')).toBe(true);
    await answer(ACME);
  });

  it('says when its figures failed to load, and tries again (FR-REPO-09)', async () => {
    http
      .expectOne('/-/api/organizations/acme/stats')
      .flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(element().querySelector('.message')?.textContent?.trim()).toBe(FAILED);
    element().querySelector('button')!.click();
    await fixture.whenStable();
    await answer(ACME);
    expect(cards()).toHaveLength(5);
  });

  it('loads the figures of another organization when it changes', async () => {
    await answer(ACME);
    fixture.componentInstance.org.set('globex');
    await fixture.whenStable();
    http.expectOne('/-/api/organizations/globex/stats').flush({ ...ACME, repositories: 7 });
    await fixture.whenStable();
    expect(cards()[0]).toEqual(['Repositories', '7']);
  });
});
