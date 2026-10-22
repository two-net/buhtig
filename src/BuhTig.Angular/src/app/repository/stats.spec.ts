import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clock } from '../format/clock';
import { compactNumber, exactNumber, exactTime, relativeTime } from '../format/format';
import { FAILED } from '../widget/messages';
import { RepositoryStats } from './stats';

@Component({
  imports: [RepositoryStats],
  template: `<app-repository-stats [owner]="owner()" [repo]="repo()" />`,
})
class Host {
  readonly owner = signal('acme');
  readonly repo = signal('widget');
}

/** The figures of `acme/widget`, as the server gives them. */
const WIDGET = {
  stars: 12_345,
  forks: 678,
  watchers: 321,
  open_issues: 33,
  open_pull_requests: 12,
  latest_release: {
    tag: 'v2.1.0',
    published_at: '2026-10-01T12:00:00Z',
    url: 'https://github.com/acme/widget/releases/tag/v2.1.0',
  },
};

describe('RepositoryStats', () => {
  const now = signal(new Date('2026-10-22T12:00:00Z').getTime());
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const release = () => element().querySelector('.release')!;

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  /** Each card, as its label and what it shows. */
  const cards = () =>
    [...element().querySelectorAll('dl > div')].map((card) => [
      card.querySelector('dt')?.textContent?.trim(),
      shown(card.querySelector('dd')!),
    ]);

  async function answer(body: object): Promise<void> {
    http.expectOne('/-/api/repositories/acme/widget/stats').flush(body);
    await fixture.whenStable();
  }

  it('shows six figures, in short with the exact number on hover and focus (FR-REPO-02)', async () => {
    await answer(WIDGET);
    expect(cards()).toEqual([
      ['Stars', compactNumber(12_345)],
      ['Forks', '678'],
      ['Watchers', '321'],
      ['Open issues', '33'],
      ['Open pull requests', '12'],
      ['Latest release', 'v2.1.0'],
    ]);
    expect(element().querySelector('dd [role="tooltip"]')?.textContent).toBe(exactNumber(12_345));
  });

  it('links the latest release to its page on GitHub, with its date (FR-REPO-12)', async () => {
    await answer(WIDGET);
    const published = new Date('2026-10-01T12:00:00Z');
    expect(release().querySelector('a')?.getAttribute('href')).toBe(WIDGET.latest_release.url);
    expect(shown(release().querySelector('.date')!)).toBe(relativeTime(published, now()));
    expect(release().querySelector('.date [role="tooltip"]')?.textContent).toBe(
      exactTime(published),
    );
  });

  it('says when there is no release', async () => {
    await answer({ ...WIDGET, latest_release: null });
    expect(cards().at(-1)).toEqual(['Latest release', 'No releases']);
    expect(release().querySelector('a, .date')).toBeNull();
  });

  it('links only to web pages, and leaves out what it cannot tell', async () => {
    await answer({
      ...WIDGET,
      latest_release: { tag: 'v1', published_at: 'yesterday', url: 'javascript:alert(1)' },
    });
    expect(cards().at(-1)).toEqual(['Latest release', 'v1']);
    expect(release().querySelector('a, .date')).toBeNull();
  });

  it('spans the grid, with a heading for assistive technology alone', async () => {
    const widget = element().querySelector('app-widget')!;
    const heading = widget.querySelector('h2')!;
    expect(widget.classList.contains('wide')).toBe(true);
    expect(heading.textContent?.trim()).toBe('Statistics');
    expect(heading.classList.contains('visually-hidden')).toBe(true);
    expect(widget.querySelector('section')?.getAttribute('aria-labelledby')).toBe(heading.id);
    await answer(WIDGET);
  });

  it('says when its figures failed to load, and tries again (FR-REPO-09)', async () => {
    http
      .expectOne('/-/api/repositories/acme/widget/stats')
      .flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(element().querySelector('.message')?.textContent?.trim()).toBe(FAILED);
    element().querySelector('button')!.click();
    await fixture.whenStable();
    await answer(WIDGET);
    expect(cards()).toHaveLength(6);
  });
});
