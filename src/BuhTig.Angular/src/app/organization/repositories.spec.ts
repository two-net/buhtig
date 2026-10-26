import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { MockInstance } from 'vitest';
import { Clock } from '../format/clock';
import { compactNumber, relativeTime } from '../format/format';
import { FAILED } from '../widget/messages';
import { NO_MATCH, pageRange, repositoryCount } from './messages';
import { OrganizationRepositories } from './repositories';

@Component({
  imports: [OrganizationRepositories],
  template: `<app-organization-repositories [org]="org()" />`,
})
class Host {
  readonly org = signal('acme');
}

/** `acme/widget`, as the server lists it. */
const WIDGET = {
  name: 'widget',
  description: 'Widgets for everyone',
  language: 'Rust',
  stars: 1_200,
  forks: 30,
  open_issues_and_pull_requests: 12,
  pushed_at: '2026-10-20T08:00:00Z',
  fork: false,
  archived: false,
  visibility: 'public',
};

/** A repository named `name`, as the server lists it, with `details` in place of `widget`'s. */
function listed(name: string, details: object = {}): object {
  return { ...WIDGET, name, description: null, ...details };
}

describe('OrganizationRepositories', () => {
  const now = new Date('2026-10-22T12:00:00Z').getTime();
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;
  let navigate: MockInstance<Router['navigateByUrl']>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Clock, useValue: { now: signal(now) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...element().querySelectorAll('tbody tr')];
  /** The names of the repositories that the table shows, in its order. */
  const names = () => rows().map((row) => row.querySelector('.name a')?.textContent?.trim());
  const status = () => element().querySelector('[role="status"]')?.textContent?.trim();
  const header = (label: string) =>
    [...element().querySelectorAll('th')].find((th) => th.textContent?.trim() === label)!;
  const button = (label: string) =>
    [...element().querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === label,
    )!;
  /** The control that the label `text` names. */
  const control = (text: string) => {
    const label = [...element().querySelectorAll('label')].find(
      (label) => label.textContent?.trim() === text,
    )!;
    return element().querySelector(`#${label.htmlFor}`)!;
  };
  const search = () => control('Find a repository') as HTMLInputElement;
  const select = (label: string) => control(label) as HTMLSelectElement;

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  async function answer(repositories: object[], org = 'acme'): Promise<void> {
    http.expectOne(`/-/api/organizations/${org}/repositories`).flush({ repositories });
    await fixture.whenStable();
  }

  async function type(text: string): Promise<void> {
    search().value = text;
    search().dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  async function choose(label: string, value: string): Promise<void> {
    select(label).value = value;
    select(label).dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  async function click(element: Element, init: MouseEventInit = {}): Promise<void> {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    await fixture.whenStable();
  }

  it('lists each repository with its description, language, figures and last push (FR-ORG-03)', async () => {
    await answer([WIDGET]);
    expect([...element().querySelectorAll('th')].map((th) => th.textContent?.trim())).toEqual([
      'Name',
      'Language',
      'Stars',
      'Forks',
      'Open issues & pull requests',
      'Last push',
    ]);
    const cells = [...rows()[0].querySelectorAll('td')];
    expect(cells.slice(1).map(shown)).toEqual([
      'Rust',
      compactNumber(1_200),
      '30',
      '12',
      relativeTime(new Date('2026-10-20T08:00:00Z'), now),
    ]);
    expect(cells[0].querySelector('a')!.textContent).toBe('widget');
    expect(cells[0].querySelector('a')!.getAttribute('href')).toBe('/acme/widget');
    expect(cells[0].querySelector('.description')?.textContent).toBe('Widgets for everyone');
    expect(status()).toBe(repositoryCount(1));
    expect(status()).toBe('1 repository');
    // One page needs no paging.
    expect(element().querySelector('.pages')).toBeNull();
  });

  it('shows nothing for what the server does not say', async () => {
    await answer([listed('docs', { language: null, pushed_at: null })]);
    const cells = [...rows()[0].querySelectorAll('td')];
    expect(cells.map(shown)).toEqual(['docs', '', compactNumber(1_200), '30', '12', '']);
    expect(cells[0].querySelector('.description, .badge')).toBeNull();
  });

  it('marks private, internal, forked and archived repositories, in words (FR-ORG-09)', async () => {
    await answer([
      listed('secret', { visibility: 'private' }),
      listed('shared', { visibility: 'internal', fork: true }),
      listed('old', { archived: true }),
      listed('odd', { visibility: 'secret' }),
    ]);
    // Pushed to at once, so by name.
    expect(
      rows().map((row) => [...row.querySelectorAll('.badge')].map((badge) => badge.textContent)),
    ).toEqual([[], ['Archived'], ['Private'], ['Internal', 'Fork']]);
  });

  it('leaves out what names no repository', async () => {
    await answer([listed('widget'), listed('../evil'), listed('a/b'), listed('')]);
    expect(names()).toEqual(['widget']);
  });

  it('lists those pushed to most recently first, and sorts by each figure either way', async () => {
    await answer([
      listed('a', { stars: 10, forks: 2, pushed_at: '2026-10-01T00:00:00Z' }),
      listed('b', { stars: 30, forks: 1, pushed_at: '2026-10-20T00:00:00Z' }),
      listed('c', { stars: 20, forks: 3, pushed_at: null }),
    ]);
    const orders = () =>
      ['Stars', 'Forks', 'Open issues & pull requests', 'Last push'].map((label) =>
        header(label).getAttribute('aria-sort'),
      );
    expect(names()).toEqual(['b', 'a', 'c']);
    expect(orders()).toEqual(['none', 'none', 'none', 'descending']);
    expect(header('Name').hasAttribute('aria-sort')).toBe(false);

    await click(button('Stars'));
    expect(names()).toEqual(['b', 'c', 'a']);
    expect(orders()).toEqual(['descending', 'none', 'none', 'none']);

    await click(button('Stars'));
    expect(names()).toEqual(['a', 'c', 'b']);
    expect(orders()).toEqual(['ascending', 'none', 'none', 'none']);

    // Another column starts with the most.
    await click(button('Forks'));
    expect(names()).toEqual(['c', 'a', 'b']);
    expect(orders()).toEqual(['none', 'descending', 'none', 'none']);

    await click(button('Last push'));
    expect(names()).toEqual(['b', 'a', 'c']);
    await click(button('Last push'));
    expect(names()).toEqual(['c', 'a', 'b']);
  });

  it('filters by name, type and language, and says how many match', async () => {
    await answer([
      listed('widget', { language: 'Rust' }),
      listed('gadget', { language: 'TypeScript', fork: true }),
      listed('sprocket', { language: 'Rust', archived: true }),
      listed('docs', { language: null }),
    ]);
    expect(status()).toBe('4 repositories');
    expect([...select('Language').options].map((option) => option.textContent?.trim())).toEqual([
      'All',
      'Rust',
      'TypeScript',
    ]);
    expect([...select('Type').options].map((option) => option.textContent?.trim())).toEqual([
      'All',
      'Sources',
      'Forks',
      'Archived',
    ]);

    await type('WIDG');
    expect(names()).toEqual(['widget']);
    expect(status()).toBe('1 repository');

    await type('');
    await choose('Type', 'forks');
    expect(names()).toEqual(['gadget']);
    await choose('Type', 'sources');
    // Pushed to at once, so by name.
    expect(names()).toEqual(['docs', 'sprocket', 'widget']);
    await choose('Type', 'archived');
    expect(names()).toEqual(['sprocket']);

    await choose('Type', 'all');
    await choose('Language', 'Rust');
    expect(names()).toEqual(['sprocket', 'widget']);
    expect(status()).toBe('2 repositories');
    await choose('Language', '');
    expect(names()).toHaveLength(4);
  });

  it('says when no repository matches, and what to do', async () => {
    await answer([listed('widget')]);
    await type('gizmo');
    expect(element().querySelector('table')).toBeNull();
    expect(status()).toBe(NO_MATCH);
    expect(NO_MATCH).toBe('No repositories match. Try another name, type or language.');
    await type('');
    expect(names()).toEqual(['widget']);
  });

  it('shows 25 repositories at a time (FR-ORG-03)', async () => {
    // Pushed to one a day apart, so that they are listed in the order of their names.
    const many = Array.from({ length: 30 }, (_, i) =>
      listed(`r${String(i).padStart(2, '0')}`, {
        stars: i,
        pushed_at: new Date(now - i * 86_400_000).toISOString(),
      }),
    );
    await answer(many);
    const disabled = (label: string) => button(label).getAttribute('aria-disabled');
    expect(names()).toHaveLength(25);
    expect([names()[0], names()[24]]).toEqual(['r00', 'r24']);
    expect(status()).toBe(pageRange(1, 25, 30));
    expect(status()).toBe('1–25 of 30 repositories');
    expect([disabled('Previous'), disabled('Next')]).toEqual(['true', 'false']);

    await click(button('Next'));
    expect(names()).toEqual(['r25', 'r26', 'r27', 'r28', 'r29']);
    expect(status()).toBe('26–30 of 30 repositories');
    expect([disabled('Previous'), disabled('Next')]).toEqual(['false', 'true']);

    // Not past the last, where the focus stays.
    await click(button('Next'));
    expect(names()).toHaveLength(5);

    await click(button('Previous'));
    expect(names()).toHaveLength(25);

    // A new order starts on the first page again, as does a new filter.
    await click(button('Next'));
    await click(button('Stars'));
    expect([names()[0], status()]).toEqual(['r29', '1–25 of 30 repositories']);
    await click(button('Next'));
    await type('r2');
    expect(names()).toHaveLength(10);
    expect(status()).toBe('10 repositories');
    expect(element().querySelector('.pages')).toBeNull();
  });

  it("opens a repository's dashboard from anywhere in its row", async () => {
    await answer([WIDGET]);
    const [name, language, stars] = [...rows()[0].querySelectorAll('td')];

    await click(language);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/acme/widget');

    // Not from what does something else, nor from a click meant for the browser.
    navigate.mockClear();
    await click(stars.querySelector('app-exact')!);
    await click(language, { ctrlKey: true });
    await click(language, { metaKey: true });
    await click(language, { shiftKey: true });
    expect(navigate).not.toHaveBeenCalled();

    // Its name's link opens it once.
    await click(name.querySelector('a')!);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('says when the organization has no repositories', async () => {
    await answer([]);
    expect(element().querySelector('.message')?.textContent?.trim()).toBe('No repositories yet.');
    expect(element().querySelector('table, input')).toBeNull();
  });

  it('spans the grid, under a heading', async () => {
    const widget = element().querySelector('app-widget')!;
    const heading = widget.querySelector('h2')!;
    expect(widget.classList.contains('wide')).toBe(true);
    expect(heading.textContent?.trim()).toBe('Repositories');
    expect(heading.classList.contains('visually-hidden')).toBe(false);
    await answer([WIDGET]);
  });

  it('says when the repositories failed to load, and tries again (FR-REPO-09)', async () => {
    http
      .expectOne('/-/api/organizations/acme/repositories')
      .flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(element().querySelector('.message')?.textContent?.trim()).toBe(FAILED);
    await click(button('Try again'));
    await answer([WIDGET]);
    expect(names()).toEqual(['widget']);
  });

  it('starts afresh for another organization', async () => {
    await answer([listed('widget', { language: 'Rust' }), listed('gadget')]);
    await type('widg');
    await choose('Language', 'Rust');
    await click(button('Stars'));

    fixture.componentInstance.org.set('globex');
    await fixture.whenStable();
    await answer(
      [listed('gizmo', { language: 'Go', pushed_at: '2026-10-21T08:00:00Z' }), listed('gear')],
      'globex',
    );
    expect(names()).toEqual(['gizmo', 'gear']);
    expect(search().value).toBe('');
    expect(select('Language').value).toBe('');
    expect(header('Last push').getAttribute('aria-sort')).toBe('descending');
    expect(rows()[0].querySelector('a')!.getAttribute('href')).toBe('/globex/gizmo');
  });
});
