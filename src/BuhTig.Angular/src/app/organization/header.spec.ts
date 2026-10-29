import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Organization } from '../dashboard/resources';
import { Clock } from '../format/clock';
import { exactTime, relativeTime } from '../format/format';
import { OrganizationHeader } from './header';

@Component({
  imports: [OrganizationHeader],
  template: `<app-organization-header
    [name]="name()"
    [organization]="organization()"
    [fetchedAt]="fetchedAt()"
  />`,
})
class Host {
  readonly name = signal('acme');
  readonly organization = signal<Organization | undefined>(undefined);
  readonly fetchedAt = signal<Date | undefined>(undefined);
}

/** An organization of which GitHub says all that the header shows. */
const ACME: Organization = {
  login: 'Acme',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  displayName: 'Acme Corporation',
  description: 'Widgets for everyone',
  location: 'Springfield',
  website: 'https://acme.example/blog/',
  createdAt: new Date('2010-04-01T10:00:00Z'),
  verified: true,
};

/** An organization of which GitHub says as little as it can. */
const BARE: Organization = {
  login: 'bare',
  avatarUrl: undefined,
  displayName: undefined,
  description: undefined,
  location: undefined,
  website: undefined,
  createdAt: undefined,
  verified: false,
};

describe('OrganizationHeader', () => {
  const now = signal(new Date('2026-10-22T12:00:00Z').getTime());
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: Clock, useValue: { now } }],
    });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const header = () =>
    fixture.nativeElement.querySelector('app-organization-header') as HTMLElement;
  const heading = () => header().querySelector('h1')?.textContent?.trim();
  const login = () => header().querySelector('.login')?.textContent?.trim();
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

  async function show(organization: Organization | undefined, fetchedAt?: Date): Promise<void> {
    fixture.componentInstance.organization.set(organization);
    fixture.componentInstance.fetchedAt.set(fetchedAt);
    await fixture.whenStable();
  }

  it('shows the login at once, and the rest once the server has said it', async () => {
    expect(heading()).toBe('acme');
    expect(header().querySelector('img, .login, .badges, .github, .description, dl')).toBeNull();
    await show(ACME);
    expect(
      header().querySelector('img, .login, .badges, .github, .description, dl'),
    ).not.toBeNull();
  });

  it('keeps the room it will take until the server has said what is in it (NFR-PERF-05)', async () => {
    expect(header().classList).toContain('pending');
    expect(header().querySelector('.slot')).not.toBeNull();
    await show(ACME);
    expect(header().classList).not.toContain('pending');
    expect(header().querySelector('.slot')).toBeNull();
    await show(BARE);
    expect(header().querySelector('.slot')).toBeNull();
  });

  it('shows what GitHub says of the organization (FR-ORG-01)', async () => {
    const fetchedAt = new Date('2026-10-22T11:56:00Z');
    await show(ACME, fetchedAt);
    const avatar = header().querySelector('img')!;
    expect([avatar.getAttribute('src'), avatar.getAttribute('alt')]).toEqual([ACME.avatarUrl, '']);
    expect([heading(), login()]).toEqual(['Acme Corporation', 'Acme']);
    expect(badges()).toEqual(['Verified']);
    expect(header().querySelector('.github')?.getAttribute('href')).toBe('https://github.com/Acme');
    expect(header().querySelector('.description')?.textContent).toBe('Widgets for everyone');
    expect(facts()).toEqual([
      ['Location', 'Springfield'],
      ['Website', 'acme.example/blog'],
      ['Created', relativeTime(ACME.createdAt!, now())],
    ]);
    expect(header().querySelector('dd a')?.getAttribute('href')).toBe(ACME.website);
    const created = header().querySelector('dd time')!;
    expect(created.getAttribute('datetime')).toBe('2010-04-01T10:00:00.000Z');
    expect(created.querySelector('[role="tooltip"]')?.textContent).toBe(exactTime(ACME.createdAt!));
    expect(shown(header().querySelector('.updated')!)).toBe(
      `Updated ${relativeTime(fetchedAt, now())}`,
    );
  });

  it('shows the login once when the organization goes by it', async () => {
    await show({ ...ACME, displayName: 'Acme' });
    expect([heading(), login()]).toEqual(['Acme', undefined]);
  });

  it('leaves out what GitHub does not say', async () => {
    fixture.componentInstance.name.set('BARE');
    await show(BARE);
    expect([heading(), login()]).toEqual(['BARE', undefined]);
    expect(header().querySelector('img, .badges, .description, .updated')).toBeNull();
    expect(facts()).toEqual([]);
    expect(header().querySelector('.github')?.getAttribute('href')).toBe('https://github.com/bare');
  });
});
