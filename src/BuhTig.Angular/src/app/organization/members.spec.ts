import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { compactNumber, exactNumber } from '../format/format';
import { FAILED } from '../widget/messages';
import { OrganizationMembers } from './members';

@Component({
  imports: [OrganizationMembers],
  template: `<app-organization-members [org]="org()" />`,
})
class Host {
  readonly org = signal('acme');
}

/** The members of `acme`, as the server gives them. */
const ACME = {
  count: 1_234,
  members: [
    {
      login: 'alice',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      url: 'https://github.com/alice',
    },
    {
      login: 'bob',
      avatar_url: 'https://avatars.githubusercontent.com/u/3?v=4',
      url: 'https://github.com/bob',
    },
  ],
};

describe('OrganizationMembers', () => {
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
  const members = () => [...element().querySelectorAll('ul > li')];
  const message = () => element().querySelector('.message')?.textContent?.trim();

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  async function answer(body: object, org = 'acme'): Promise<void> {
    http.expectOne(`/-/api/organizations/${org}/members`).flush(body);
    await fixture.whenStable();
  }

  it('shows how many members there are, and their avatars (FR-ORG-07)', async () => {
    await answer(ACME);
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Members');
    const count = element().querySelector('.count')!;
    expect(shown(count)).toBe(`${compactNumber(1_234)} members`);
    expect(count.querySelector('[role="tooltip"]')?.textContent).toBe(exactNumber(1_234));
    expect(
      members().map((member) => {
        const avatar = member.querySelector('img')!;
        return [avatar.getAttribute('src'), avatar.getAttribute('alt')];
      }),
    ).toEqual([
      ['https://avatars.githubusercontent.com/u/2?v=4', 'alice'],
      ['https://avatars.githubusercontent.com/u/3?v=4', 'bob'],
    ]);
  });

  it("links each avatar to the member's page on GitHub, named by their login", async () => {
    await answer(ACME);
    expect(
      members().map((member) => {
        const link = member.querySelector('a')!;
        return [link.getAttribute('href'), link.querySelector('.login')?.textContent?.trim()];
      }),
    ).toEqual([
      ['https://github.com/alice', 'alice'],
      ['https://github.com/bob', 'bob'],
    ]);
  });

  it('shows a login on hover and focus alike, until Esc hides it (NFR-UX-03, WCAG 1.4.13)', async () => {
    await answer(ACME);
    const link = members()[0].querySelector('a')!;
    // The avatar's alternative text names the link already.
    expect(link.querySelector('.login')!.getAttribute('aria-hidden')).toBe('true');
    expect(link.getAttribute('title')).toBeNull();

    link.focus();
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(link.classList.contains('dismissed')).toBe(true);
    link.blur();
    await fixture.whenStable();
    expect(link.classList.contains('dismissed')).toBe(false);
  });

  it('says "member" of one', async () => {
    await answer({ count: 1, members: [ACME.members[0]] });
    expect(shown(element().querySelector('.count')!)).toBe('1 member');
  });

  it('links only to web pages, and shows avatars only from https URLs', async () => {
    await answer({
      count: 1,
      members: [
        { login: 'mallory', avatar_url: 'http://avatars.example/u/4', url: 'javascript:alert(1)' },
      ],
    });
    expect(members()).toHaveLength(1);
    expect(members()[0].querySelector('img, a[href]')).toBeNull();
    // Still named, and told apart by the first letter of the login.
    const avatar = members()[0].querySelector('[role="img"]')!;
    expect(avatar.getAttribute('aria-label')).toBe('mallory');
    expect(avatar.textContent?.trim()).toBe('m');
    expect(members()[0].querySelector('.login')?.textContent?.trim()).toBe('mallory');
  });

  it('spans the grid', async () => {
    expect(element().querySelector('app-widget')!.classList.contains('wide')).toBe(true);
    await answer(ACME);
  });

  it('says when there are no members to show', async () => {
    await answer({ count: 0, members: [] });
    expect(message()).toBe('No members to show.');
    expect(element().querySelector('ul, button')).toBeNull();
  });

  it('says when the members failed to load, and tries again (FR-REPO-09)', async () => {
    http
      .expectOne('/-/api/organizations/acme/members')
      .flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    const retry = [...element().querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Try again',
    )!;
    retry.click();
    await fixture.whenStable();
    await answer(ACME);
    expect(members()).toHaveLength(2);
  });

  it('moves with the organization', async () => {
    await answer(ACME);
    fixture.componentInstance.org.set('globex');
    await fixture.whenStable();
    await answer({ count: 1, members: [ACME.members[1]] }, 'globex');
    expect(members().map((member) => member.querySelector('.login')?.textContent?.trim())).toEqual([
      'bob',
    ]);
  });
});
