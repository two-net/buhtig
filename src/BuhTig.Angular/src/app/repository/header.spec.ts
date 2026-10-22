import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Repository } from '../dashboard/resources';
import { Clock } from '../format/clock';
import { exactTime, relativeTime } from '../format/format';
import { RepositoryHeader } from './header';

@Component({
  imports: [RepositoryHeader],
  template: `<app-repository-header
    [name]="name()"
    [repository]="repository()"
    [fetchedAt]="fetchedAt()"
  />`,
})
class Host {
  readonly name = signal('acme/widget');
  readonly repository = signal<Repository | undefined>(undefined);
  readonly fetchedAt = signal<Date | undefined>(undefined);
}

/** A repository of which GitHub says all that the header shows. */
const WIDGET: Repository = {
  name: 'Acme/Widget',
  ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  description: 'Widgets for everyone',
  visibility: 'public',
  archived: true,
  template: true,
  fork: true,
  parent: 'Upstream/Widget',
  topics: ['widgets', 'rust'],
  license: 'MIT License',
  defaultBranch: 'main',
  homepage: 'https://widget.example/docs/',
  createdAt: new Date('2015-03-01T10:00:00Z'),
  pushedAt: new Date('2026-10-22T09:00:00Z'),
};

/** A repository of which GitHub says as little as it can. */
const BARE: Repository = {
  name: 'acme/bare',
  ownerAvatarUrl: undefined,
  description: undefined,
  visibility: 'public',
  archived: false,
  template: false,
  fork: false,
  parent: undefined,
  topics: [],
  license: undefined,
  defaultBranch: undefined,
  homepage: undefined,
  createdAt: undefined,
  pushedAt: undefined,
};

describe('RepositoryHeader', () => {
  const now = signal(new Date('2026-10-22T12:00:00Z').getTime());
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: Clock, useValue: { now } }],
    });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const header = () => fixture.nativeElement.querySelector('app-repository-header') as HTMLElement;
  const badges = () =>
    [...header().querySelectorAll('.badge')].map((badge) => badge.textContent?.trim());

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  /** Each fact under the description, as its label and what it shows. */
  const facts = () =>
    [...header().querySelectorAll('dl > div')].map((fact) => [
      fact.querySelector('dt')?.textContent?.trim(),
      shown(fact.querySelector('dd')!),
    ]);

  async function show(repository: Repository | undefined, fetchedAt?: Date): Promise<void> {
    fixture.componentInstance.repository.set(repository);
    fixture.componentInstance.fetchedAt.set(fetchedAt);
    await fixture.whenStable();
  }

  it('shows the name at once, and the rest once the server has said it', async () => {
    expect(header().querySelector('h1')?.textContent?.trim()).toBe('acme/widget');
    expect(header().querySelector('img, .badges, .github, .description, .topics, dl')).toBeNull();
    await show(WIDGET);
    expect(header().querySelector('h1')?.textContent?.trim()).toBe('acme/widget');
    expect(
      header().querySelector('img, .badges, .github, .description, .topics, dl'),
    ).not.toBeNull();
  });

  it('shows what GitHub says of the repository (FR-REPO-01)', async () => {
    const fetchedAt = new Date('2026-10-22T11:56:00Z');
    await show(WIDGET, fetchedAt);
    const avatar = header().querySelector('img')!;
    expect([avatar.getAttribute('src'), avatar.getAttribute('alt')]).toEqual([
      WIDGET.ownerAvatarUrl,
      '',
    ]);
    expect(badges()).toEqual(['Public', 'Archived', 'Template', 'Fork of Upstream/Widget']);
    expect(header().querySelector('.github')?.getAttribute('href')).toBe(
      'https://github.com/Acme/Widget',
    );
    expect(header().querySelector('.description')?.textContent).toBe('Widgets for everyone');
    expect([...header().querySelectorAll('.topics li')].map((topic) => topic.textContent)).toEqual([
      'widgets',
      'rust',
    ]);
    expect(facts()).toEqual([
      ['License', 'MIT License'],
      ['Default branch', 'main'],
      ['Homepage', 'widget.example/docs'],
      ['Created', relativeTime(WIDGET.createdAt!, now())],
      ['Last push', relativeTime(WIDGET.pushedAt!, now())],
    ]);
    expect(header().querySelector('dd a')?.getAttribute('href')).toBe(WIDGET.homepage);
    const created = header().querySelectorAll('dd time')[0];
    expect(created.getAttribute('datetime')).toBe('2015-03-01T10:00:00.000Z');
    expect(created.querySelector('[role="tooltip"]')?.textContent).toBe(
      exactTime(WIDGET.createdAt!),
    );
    expect(shown(header().querySelector('.updated')!)).toBe(
      `Updated ${relativeTime(fetchedAt, now())}`,
    );
  });

  it("links a fork to its parent's dashboard (FR-REPO-01)", async () => {
    await show(WIDGET);
    const fork = header().querySelector('a.badge')!;
    expect(fork.getAttribute('href')).toBe('/Upstream/Widget');
    // A fork whose parent GitHub does not name is still one.
    await show({ ...WIDGET, parent: undefined });
    expect(header().querySelector('a.badge')).toBeNull();
    expect(badges()).toContain('Fork');
  });

  it('says whether the repository is public, private or internal, in words', async () => {
    for (const [visibility, badge] of [
      ['public', 'Public'],
      ['private', 'Private'],
      ['internal', 'Internal'],
    ] as const) {
      await show({ ...BARE, visibility });
      expect(badges(), visibility).toEqual([badge]);
    }
  });

  it('leaves out what GitHub does not say', async () => {
    await show(BARE);
    expect(badges()).toEqual(['Public']);
    expect(header().querySelector('img, .description, .topics, a.badge, .updated')).toBeNull();
    expect(facts()).toEqual([]);
    expect(header().querySelector('.github')?.getAttribute('href')).toBe(
      'https://github.com/acme/bare',
    );
  });
});
