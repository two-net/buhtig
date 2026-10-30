import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Mock } from 'vitest';
import { OrganizationData } from '../dashboard/data';
import { ListedRepository } from '../dashboard/resources';
import { Load } from '../widget/load';
import { FAILED } from '../widget/messages';
import { FIND_REPOSITORY, NO_REPOSITORIES, listed, noMatch } from './messages';
import { OrganizationRepositoriesTab } from './repositories';

/** A repository of `acme` named `name`, with `details` in place of the plainest. */
function repository(name: string, details: Partial<ListedRepository> = {}): ListedRepository {
  return {
    name,
    path: `/acme/${name}`,
    description: undefined,
    language: undefined,
    stars: 0,
    forks: 0,
    openIssuesAndPullRequests: 0,
    pushedAt: undefined,
    fork: false,
    archived: false,
    visibility: 'public',
    topics: [],
    ...details,
  };
}

/** What stands in for the browser's IntersectionObserver, which sees nothing come into view. */
class Unseeing {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

describe('OrganizationRepositoriesTab', () => {
  const scrolling = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<OrganizationRepositoriesTab>;
  let http: HttpTestingController;
  let state: ReturnType<typeof signal<Load<ListedRepository[]>>>;
  let retry: Mock<() => void>;
  let scrollIntoView: Mock<Element['scrollIntoView']>;

  beforeEach(async () => {
    // So that the rows' sparklines load nothing, which `repository-row.spec.ts` tests.
    vi.stubGlobal('IntersectionObserver', Unseeing);
    // The tests' jsdom scrolls nothing, and has no way to.
    scrollIntoView = vi.fn<Element['scrollIntoView']>();
    Element.prototype.scrollIntoView = scrollIntoView;
    state = signal<Load<ListedRepository[]>>({ status: 'loading' });
    retry = vi.fn();
    TestBed.configureTestingModule({
      imports: [OrganizationRepositoriesTab],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: OrganizationData,
          useValue: {
            login: signal('acme'),
            displayName: signal('Acme Corp'),
            repositories: () => ({ state, retry }),
            languageColor: signal(() => 'var(--s1)'),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OrganizationRepositoriesTab);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = scrolling;
  });

  const element = () => fixture.nativeElement as HTMLElement;
  /** The names of the repositories listed, in their order. */
  const names = () =>
    [...element().querySelectorAll('app-repository-row')].map(
      (row) => row.querySelector('h3 a')!.textContent,
    );
  const status = () => element().querySelector('.count-note')!.textContent?.trim();
  const search = () => element().querySelector<HTMLInputElement>('input[type="search"]')!;
  const select = (label: string) =>
    element().querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const options = (label: string) =>
    [...select(label).options].map((option) => option.textContent?.trim());
  const pager = () => element().querySelector('nav.pager');
  /** What the pager offers, as its buttons' text, and gaps. */
  const pages = () =>
    [...(pager()?.children ?? [])].map((item) =>
      item.classList.contains('gap') ? '…' : item.textContent?.trim(),
    );
  const page = (label: string) =>
    [...pager()!.querySelectorAll('button')].find(
      (button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label,
    )!;
  const current = () => pager()!.querySelector('[aria-current="page"]')?.textContent?.trim();

  async function answer(repositories: ListedRepository[]): Promise<void> {
    state.set({ status: 'ready', data: repositories });
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

  async function click(button: HTMLElement): Promise<void> {
    button.click();
    await fixture.whenStable();
  }

  /** `count` repositories, named `r01` and on, each pushed to a day before the one before. */
  function many(count: number): ListedRepository[] {
    return Array.from({ length: count }, (_, i) =>
      repository(`r${String(i + 1).padStart(2, '0')}`, {
        pushedAt: new Date(Date.UTC(2026, 9, 22) - i * 86_400_000),
      }),
    );
  }

  it('stands in its place until the repositories are there', () => {
    expect(element().querySelector('.skel-row')).not.toBeNull();
    expect(names()).toEqual([]);
    expect(status()).toBe('');
  });

  it('lists the repositories pushed to last first, and says how many there are (FR-ORG-03)', async () => {
    await answer([
      repository('a', { pushedAt: new Date('2026-10-01T00:00:00Z') }),
      repository('b', { pushedAt: new Date('2026-10-20T00:00:00Z') }),
      repository('c'),
    ]);
    expect(names()).toEqual(['b', 'a', 'c']);
    expect(status()).toBe(listed(3, '', 1, 1));
    expect(status()).toBe('3 repositories, page 1 of 1');
    expect(element().querySelector('.count-note')!.getAttribute('aria-live')).toBe('polite');
    // One page needs no paging.
    expect(pager()).toBeNull();
  });

  it('offers to find a repository by name, its type, language and order', async () => {
    await answer([repository('a', { language: 'Rust' }), repository('b', { language: 'Go' })]);
    expect(search().placeholder).toBe(FIND_REPOSITORY);
    expect(search().getAttribute('aria-label')).toBe('Find a repository');
    // Only a token user's repositories may be private or internal (FR-ORG-09).
    expect(options('Type')).toEqual(['All', 'Sources', 'Forks', 'Archived']);
    expect(options('Language')).toEqual(['All languages', 'Go', 'Rust']);
    expect(options('Sort')).toEqual(['Last updated', 'Name', 'Stars']);
    expect(select('Type').value).toBe('all');
    expect(select('Language').value).toBe('');
    expect(select('Sort').value).toBe('pushed');
  });

  it('offers public, and private and internal ones, once there is one that is not public (FR-ORG-09)', async () => {
    await answer([
      repository('open'),
      repository('secret', { visibility: 'private' }),
      repository('shared', { visibility: 'internal' }),
    ]);
    expect(options('Type')).toEqual([
      'All',
      'Public',
      'Private and internal',
      'Sources',
      'Forks',
      'Archived',
    ]);
    await choose('Type', 'public');
    expect(names()).toEqual(['open']);
    await choose('Type', 'private');
    expect(names()).toEqual(['secret', 'shared']);
  });

  it('finds repositories by name, type and language, and says how many match', async () => {
    await answer([
      repository('widget', { language: 'Rust' }),
      repository('gadget', { language: 'TypeScript', fork: true }),
      repository('sprocket', { language: 'Rust', archived: true }),
      repository('docs'),
    ]);
    await type('WIDG');
    expect(names()).toEqual(['widget']);
    expect(status()).toBe(listed(1, 'WIDG', 1, 1));
    expect(status()).toBe('1 repository matching “WIDG”, page 1 of 1');

    await type('');
    await choose('Type', 'forks');
    expect(names()).toEqual(['gadget']);
    await choose('Type', 'sources');
    expect(names()).toEqual(['docs', 'sprocket', 'widget']);
    await choose('Type', 'archived');
    expect(names()).toEqual(['sprocket']);

    await choose('Type', 'all');
    await choose('Language', 'Rust');
    expect(names()).toEqual(['sprocket', 'widget']);
    expect(status()).toBe('2 repositories, page 1 of 1');
    await choose('Language', '');
    expect(names()).toHaveLength(4);
  });

  it('sorts by name, or by stars, most first', async () => {
    await answer([
      repository('b', { stars: 10, pushedAt: new Date('2026-10-20T00:00:00Z') }),
      repository('c', { stars: 30, pushedAt: new Date('2026-10-01T00:00:00Z') }),
      repository('a', { stars: 20 }),
    ]);
    expect(names()).toEqual(['b', 'c', 'a']);
    await choose('Sort', 'name');
    expect(names()).toEqual(['a', 'b', 'c']);
    await choose('Sort', 'stars');
    expect(names()).toEqual(['c', 'a', 'b']);
    await choose('Sort', 'pushed');
    expect(names()).toEqual(['b', 'c', 'a']);
  });

  it("says when no repository matches, in the organization's name", async () => {
    await answer([repository('widget')]);
    await type('gizmo');
    expect(names()).toEqual([]);
    expect(element().querySelector('.empty-note')!.textContent?.trim()).toBe(noMatch('Acme Corp'));
    expect(noMatch('Acme Corp')).toBe("Acme Corp doesn't have any repositories that match.");
    expect(status()).toBe('');
    await type('');
    expect(names()).toEqual(['widget']);
    expect(element().querySelector('.empty-note')).toBeNull();
  });

  it('says when the organization has no repositories', async () => {
    await answer([]);
    expect(element().querySelector('app-widget')!.textContent).toContain(NO_REPOSITORIES);
    expect(element().querySelector('.repo-list')).toBeNull();
    expect(status()).toBe('');
  });

  it('says when the repositories could not be loaded, and tries again', async () => {
    state.set({ status: 'error', failure: 'github' });
    await fixture.whenStable();
    const widget = element().querySelector('app-widget')!;
    expect(widget.textContent).toContain(FAILED);
    widget.querySelector<HTMLButtonElement>('.w-state button')!.click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows 25 repositories a page, with a page of each (FR-ORG-03)', async () => {
    await answer(many(60));
    expect(names()).toHaveLength(25);
    expect(names()[0]).toBe('r01');
    expect(status()).toBe('60 repositories, page 1 of 3');
    expect(pages()).toEqual(['Previous', '1', '2', '3', 'Next']);
    expect(current()).toBe('1');
    expect(page('Previous').disabled).toBe(true);
    expect(page('Next').disabled).toBe(false);
    expect(pager()!.getAttribute('aria-label')).toBe('Pages');

    await click(page('Next'));
    expect(names()[0]).toBe('r26');
    expect(status()).toBe('60 repositories, page 2 of 3');
    expect(current()).toBe('2');
    expect(page('Previous').disabled).toBe(false);

    await click(page('Page 3'));
    expect(names()).toHaveLength(10);
    expect(names()[9]).toBe('r60');
    expect(page('Next').disabled).toBe(true);

    await click(page('Previous'));
    expect(current()).toBe('2');
  });

  it('leaves pages out between the first, the last and those next to the page shown', async () => {
    await answer(many(250));
    expect(pages()).toEqual(['Previous', '1', '2', '…', '10', 'Next']);
    await click(page('Page 10'));
    await click(page('Previous'));
    await click(page('Previous'));
    await click(page('Previous'));
    await click(page('Previous'));
    expect(current()).toBe('6');
    expect(pages()).toEqual(['Previous', '1', '…', '5', '6', '7', '…', '10', 'Next']);
    // The gaps are for the eye alone.
    expect(pager()!.querySelector('.gap')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the new page from the top of the list', async () => {
    await answer(many(30));
    await click(page('Page 2'));
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(search());
    expect(scrollIntoView.mock.calls[0][0]).toEqual(expect.objectContaining({ block: 'start' }));
  });

  it('goes back to the first page as what the list holds changes', async () => {
    await answer(many(60));
    await click(page('Page 3'));
    await type('r');
    expect(current()).toBe('1');
    await click(page('Page 2'));
    await choose('Sort', 'name');
    expect(current()).toBe('1');
    await click(page('Page 2'));
    await answer(many(55));
    expect(current()).toBe('1');
  });
});
