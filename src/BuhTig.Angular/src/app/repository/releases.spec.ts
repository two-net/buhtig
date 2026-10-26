import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clock } from '../format/clock';
import { relativeTime } from '../format/format';
import { FAILED } from '../widget/messages';
import { PRERELEASE } from './messages';
import { RepositoryReleases } from './releases';

@Component({
  imports: [RepositoryReleases],
  template: `<app-repository-releases [owner]="owner()" [repo]="repo()" />`,
})
class Host {
  readonly owner = signal('acme');
  readonly repo = signal('widget');
}

/** The latest releases of `acme/widget`, as the server gives them. */
const WIDGET = {
  releases: [
    {
      tag: 'v3.0.0-rc.1',
      name: null,
      published_at: '2026-10-11T12:00:00Z',
      prerelease: true,
      url: 'https://github.com/acme/widget/releases/tag/v3.0.0-rc.1',
    },
    {
      tag: 'v2.1.0',
      name: 'Widget 2.1',
      published_at: '2026-10-01T12:00:00Z',
      prerelease: false,
      url: 'https://github.com/acme/widget/releases/tag/v2.1.0',
    },
  ],
};

describe('RepositoryReleases', () => {
  const now = new Date('2026-10-22T12:00:00Z').getTime();
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(now) } },
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
  const rows = () => [...element().querySelectorAll('ol > li')];
  const message = () => element().querySelector('.message')?.textContent?.trim();
  const ago = (time: string) => relativeTime(new Date(time), now);

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  async function answer(body: object): Promise<void> {
    http.expectOne('/-/api/repositories/acme/widget/releases').flush(body);
    await fixture.whenStable();
  }

  it('lists the latest releases with their tag, name and date (FR-REPO-08)', async () => {
    await answer(WIDGET);
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Releases');
    expect(
      rows().map((row) =>
        ['.tag', '.name', '.badge', '.date'].map((part) => {
          const found = row.querySelector(part);
          return found ? shown(found) : undefined;
        }),
      ),
    ).toEqual([
      // Its name only repeated its tag, and it is marked as GitHub marks it.
      ['v3.0.0-rc.1', undefined, PRERELEASE, ago('2026-10-11T12:00:00Z')],
      ['v2.1.0', 'Widget 2.1', undefined, ago('2026-10-01T12:00:00Z')],
    ]);
  });

  it("links each tag to the release's page on GitHub (FR-REPO-12)", async () => {
    await answer(WIDGET);
    expect(rows().map((row) => row.querySelector('a.tag')?.getAttribute('href'))).toEqual([
      'https://github.com/acme/widget/releases/tag/v3.0.0-rc.1',
      'https://github.com/acme/widget/releases/tag/v2.1.0',
    ]);
  });

  it('links only to web pages, and leaves out a date it does not know', async () => {
    await answer({
      releases: [
        { tag: 'v1', name: 'One', published_at: null, prerelease: false, url: 'javascript:x' },
      ],
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('a, .date')).toBeNull();
    expect(rows()[0].querySelector('.tag')?.textContent).toBe('v1');
  });

  it('says when there are no releases', async () => {
    await answer({ releases: [] });
    expect(message()).toBe('No releases yet.');
    expect(element().querySelector('ol, button')).toBeNull();
  });

  it('says when they failed to load, and tries again (FR-REPO-09)', async () => {
    http
      .expectOne('/-/api/repositories/acme/widget/releases')
      .flush(null, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(message()).toBe(FAILED);
    element().querySelector('button')!.click();
    await fixture.whenStable();
    await answer(WIDGET);
    expect(rows()).toHaveLength(2);
  });
});
