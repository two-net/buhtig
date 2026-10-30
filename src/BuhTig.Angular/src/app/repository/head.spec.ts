import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OPEN_ON_GITHUB } from '../dashboard/messages';
import { Repository } from '../dashboard/resources';
import { RepositoryHead } from './head';

@Component({
  imports: [RepositoryHead],
  template: `<app-repository-head
    [repository]="repository()"
    [fetchedAt]="fetchedAt()"
    (refreshed)="refreshed = refreshed + 1"
  />`,
})
class Host {
  readonly repository = signal<Repository>(WIDGET);
  readonly fetchedAt = signal<Date | undefined>(undefined);
  refreshed = 0;
}

/** A repository of which GitHub says all that the head shows. */
const WIDGET: Repository = {
  name: 'Acme/Widget',
  ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  description: 'Widgets for everyone',
  visibility: 'public',
  archived: true,
  template: true,
  fork: true,
  parent: 'Upstream/Widget',
  topics: [],
  license: undefined,
  defaultBranch: undefined,
  homepage: undefined,
  createdAt: undefined,
  pushedAt: undefined,
};

describe('RepositoryHead', () => {
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
    http.match('/-/api/session');
    http.match('/-/api/shortcuts');
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const labels = () =>
    [...element().querySelectorAll('.title .label')].map((label) => label.textContent?.trim());
  const forked = () => element().querySelector('.forked');

  async function show(repository: Partial<Repository>): Promise<void> {
    fixture.componentInstance.repository.set({ ...WIDGET, ...repository });
    await fixture.whenStable();
  }

  it("heads with the owner's avatar, and the repository's name linking to its dashboard (FR-REPO-01)", () => {
    expect(element().querySelector('.title img')?.getAttribute('src')).toBe(WIDGET.ownerAvatarUrl);
    const name = element().querySelector('h1 a')!;
    expect([name.textContent, name.getAttribute('href')]).toEqual(['Widget', '/Acme/Widget']);
  });

  it("draws an avatar from the owner's name when GitHub gives none", async () => {
    await show({ ownerAvatarUrl: undefined });
    expect(element().querySelector('.title img')).toBeNull();
    expect(element().querySelector('.title svg.av')).not.toBeNull();
  });

  it('marks its visibility, and whether it is archived or a template', async () => {
    expect(labels()).toEqual(['Public', 'Archived', 'Template']);
    await show({ visibility: 'private', archived: false, template: false });
    expect(labels()).toEqual(['Private']);
    await show({ visibility: 'internal', archived: false, template: false });
    expect(labels()).toEqual(['Internal']);
  });

  it("says what a fork was forked from, linking to the parent's dashboard", async () => {
    expect(forked()?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Forked from Upstream/Widget');
    expect(forked()?.querySelector('a')?.getAttribute('href')).toBe('/Upstream/Widget');
    // GitHub did not say which.
    await show({ parent: undefined });
    expect(forked()?.textContent?.trim()).toBe('Fork');
    expect(forked()?.querySelector('a')).toBeNull();
    await show({ fork: false, parent: undefined });
    expect(forked()).toBeNull();
  });

  it('links to its page on GitHub, and refreshes it as GitHub spells it (FR-DATA-07)', async () => {
    const link = [...element().querySelectorAll('a.btn')].find(
      (action) => action.textContent?.trim() === OPEN_ON_GITHUB,
    );
    expect(link?.getAttribute('href')).toBe('https://github.com/Acme/Widget');

    http.expectOne('/-/api/session').flush({
      user: { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' },
      token: null,
    });
    await fixture.whenStable();
    element().querySelector<HTMLButtonElement>('app-refresh button')!.click();
    http
      .expectOne({ method: 'POST', url: '/-/api/repositories/Acme/Widget/refresh' })
      .flush(null, { status: 204, statusText: 'No Content' });
    expect(fixture.componentInstance.refreshed).toBe(1);
  });

  it('says when its data was fetched', async () => {
    expect(element().querySelector('app-head-actions time')).toBeNull();
    fixture.componentInstance.fetchedAt.set(new Date('2026-10-22T12:00:00Z'));
    await fixture.whenStable();
    expect(element().querySelector('app-head-actions time')?.getAttribute('datetime')).toBe(
      '2026-10-22T12:00:00.000Z',
    );
  });
});
