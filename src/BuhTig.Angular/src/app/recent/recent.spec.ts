import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Recent, RecentRepository } from './recent';

describe('Recent', () => {
  let http: HttpTestingController;
  let recent: Recent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    recent = TestBed.inject(Recent);
  });

  afterEach(() => {
    http.verify();
  });

  /** `acme/widget`, as the server lists it. */
  const WIDGET = {
    name: 'acme/widget',
    owner_avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    description: 'Widgets for everyone',
    language: 'Rust',
    stars: 1_200,
    forks: 30,
    pushed_at: '2026-10-20T08:00:00Z',
    fetched_at: '2026-10-22T12:00:00Z',
  };

  /** What `list` gives once the server answers `body`, or fails with `status`. */
  function listed(body: object | null, status = 200): RecentRepository[] | undefined {
    let repositories: RecentRepository[] | undefined;
    recent.list().subscribe((list) => (repositories = list));
    http.expectOne('/-/api/recent').flush(body, { status, statusText: `${status}` });
    return repositories;
  }

  it('lists the public repositories opened here lately, as the server says (FR-DATA-04)', () => {
    expect(listed({ repositories: [WIDGET] })).toEqual([
      {
        name: 'acme/widget',
        ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        description: 'Widgets for everyone',
        language: 'Rust',
        stars: 1_200,
        forks: 30,
        pushedAt: new Date('2026-10-20T08:00:00Z'),
        fetchedAt: new Date('2026-10-22T12:00:00Z'),
      },
    ]);
  });

  it('keeps the order the server gives, latest first', () => {
    const names = listed({
      repositories: [
        { ...WIDGET, name: 'acme/b' },
        { ...WIDGET, name: 'acme/a' },
        { ...WIDGET, name: 'other/c' },
      ],
    })!.map(({ name }) => name);
    expect(names).toEqual(['acme/b', 'acme/a', 'other/c']);
  });

  it('leaves out what names no repository', () => {
    const names = listed({
      repositories: [
        WIDGET,
        { ...WIDGET, name: 'acme' },
        { ...WIDGET, name: '../evil' },
        { ...WIDGET, name: '' },
        // What `parse` takes for a repository, but is no `owner/repo` to link to.
        { ...WIDGET, name: 'acme/widget/tree/main' },
        { ...WIDGET, name: 'github.com/acme/widget' },
        { ...WIDGET, name: 'acme/widget.git' },
      ],
    })!.map(({ name }) => name);
    expect(names).toEqual(['acme/widget']);
  });

  it('shows nothing for what the server does not say, or says unsafely', () => {
    const [repository] = listed({
      repositories: [
        {
          ...WIDGET,
          owner_avatar_url: 'http://avatars.example/u/1',
          description: '',
          language: null,
          pushed_at: null,
          fetched_at: 'yesterday',
        },
      ],
    })!;
    expect(repository.ownerAvatarUrl).toBeUndefined();
    expect(repository.description).toBeUndefined();
    expect(repository.language).toBeUndefined();
    expect(repository.pushedAt).toBeUndefined();
    expect(repository.fetchedAt).toBeUndefined();

    expect(
      listed({ repositories: [{ ...WIDGET, owner_avatar_url: 'not a URL' }] })![0].ownerAvatarUrl,
    ).toBeUndefined();
  });

  it('lists none when the server cannot say', () => {
    expect(listed(null, 503)).toEqual([]);
    expect(listed(null, 500)).toEqual([]);
  });
});
