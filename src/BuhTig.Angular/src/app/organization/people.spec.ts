import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OrganizationData } from '../dashboard/data';
import { Members } from '../dashboard/resources';
import { Load } from '../widget/load';
import { HELD } from '../widget/messages';
import { NO_MEMBERS, moreMembers } from './messages';
import { OrganizationPeople } from './people';

describe('OrganizationPeople', () => {
  let fixture: ComponentFixture<OrganizationPeople>;
  let state: ReturnType<typeof signal<Load<Members>>>;

  beforeEach(async () => {
    state = signal<Load<Members>>({ status: 'loading' });
    TestBed.configureTestingModule({
      imports: [OrganizationPeople],
      providers: [
        provideRouter([]),
        { provide: OrganizationData, useValue: { members: () => ({ state, retry: () => {} }) } },
      ],
    });
    fixture = TestBed.createComponent(OrganizationPeople);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  /** The members shown, as their links' text and where they lead. */
  const people = () =>
    [...element().querySelectorAll('.people-grid a')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);
  const more = () => element().querySelector('.count-note')?.textContent?.trim();

  /** `count` members, the first without a page that the server gives. */
  function members(count: number): Members['members'] {
    return Array.from({ length: count }, (_, i) => ({
      login: `member-${i}`,
      avatarUrl: i === 1 ? undefined : `https://avatars.githubusercontent.com/u/${i}`,
      url: i === 0 ? undefined : `https://github.com/member-${i}?tab=profile`,
    }));
  }

  async function answer(count: number, shown: number): Promise<void> {
    state.set({ status: 'ready', data: { count, members: members(shown) } });
    await fixture.whenStable();
  }

  it('stands in its place until the members are there', () => {
    expect(element().querySelector('h2')!.textContent?.trim()).toBe('People');
    expect(element().querySelector('.skel-row')).not.toBeNull();
    expect(people()).toEqual([]);
  });

  it('shows the members the viewer may see, each leading to their profile on GitHub (FR-ORG-07)', async () => {
    await answer(3, 3);
    expect(people()).toEqual([
      ['@member-0', 'https://github.com/member-0'],
      ['@member-1', 'https://github.com/member-1?tab=profile'],
      ['@member-2', 'https://github.com/member-2?tab=profile'],
    ]);
    const avatars = [...element().querySelectorAll('.people-grid app-avatar')];
    expect(avatars[0].querySelector('img')!.getAttribute('src')).toBe(
      'https://avatars.githubusercontent.com/u/0',
    );
    // Without one, the pattern drawn from the login.
    expect(avatars[1].querySelector('img')).toBeNull();
    expect(avatars[1].querySelector('svg.av')).not.toBeNull();
    // All of them, so nothing more to say.
    expect(more()).toBeUndefined();
  });

  it('says how many more members the viewer may see', async () => {
    await answer(130, 24);
    expect(people()).toHaveLength(24);
    expect(more()).toBe(moreMembers(106));
    expect(moreMembers(106)).toBe('and 106 more members visible to you.');
    await answer(25, 24);
    expect(more()).toBe('and 1 more member visible to you.');
  });

  it('says when there are no members to show', async () => {
    await answer(0, 0);
    expect(element().textContent).toContain(NO_MEMBERS);
    expect(element().querySelector('.people-grid')).toBeNull();
  });

  it('says why the members could not be loaded', async () => {
    state.set({ status: 'error', failure: 'held' });
    await fixture.whenStable();
    expect(element().textContent).toContain(HELD);
  });
});
