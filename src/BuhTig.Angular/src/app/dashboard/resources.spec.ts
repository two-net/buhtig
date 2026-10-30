import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import { Computing } from '../widget/load';
import { Resources, Summary } from './resources';

describe('Resources', () => {
  let resources: Resources;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    resources = TestBed.inject(Resources);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  /** What `answer` comes to, once it has, or what it failed with. */
  function outcome<T>(answer: Observable<T>): { value?: T; error?: unknown } {
    const seen: { value?: T; error?: unknown } = {};
    answer.subscribe({
      next: (value) => (seen.value = value),
      error: (error) => (seen.error = error),
    });
    return seen;
  }

  const WIDGET = '/-/api/repositories/acme/widget';

  describe('summary', () => {
    const summary = (answer: object | null, status = 200) => {
      const seen = outcome(
        resources.summary({ kind: 'repository', owner: 'acme', repo: 'widget' }),
      );
      http.expectOne(WIDGET).flush(answer, { status, statusText: `${status}` });
      return seen.value!;
    };

    it("tells GitHub's spelling, when the data was fetched, and why it is stale", () => {
      const shown = summary({
        name: 'Acme/Widget',
        fetched_at: '2026-10-22T12:00:00Z',
        stale: 'held',
      });
      expect(shown.path).toBe('/Acme/Widget');
      expect(shown.fetchedAt).toEqual(new Date('2026-10-22T12:00:00Z'));
      expect(shown.stale).toBe('held');
      expect(shown.repository?.name).toBe('Acme/Widget');
      expect([shown.failure, shown.denied, shown.notFound, shown.invalid]).toEqual([
        undefined,
        undefined,
        false,
        false,
      ]);
      expect(summary({ name: 'acme/widget', stale: 'github' }).stale).toBe('github');
      expect(summary({ name: 'acme/widget', stale: 'later' }).stale).toBeUndefined();
      expect(summary({ name: 'acme/widget', stale: null }).stale).toBeUndefined();
    });

    it('shows nothing of an answer that names no such repository', () => {
      for (const name of ['acme', '../evil', 'acme/widget/x', 'github.com/acme/widget']) {
        const shown = summary({ name, description: 'Widgets' });
        expect([shown.path, shown.repository], name).toEqual([undefined, undefined]);
      }
    });

    it('keeps only what it can show safely of the repository (NFR-SEC-03)', () => {
      const repository = summary({
        name: 'acme/widget',
        owner_avatar_url: 'http://avatars.example/u/1',
        description: '',
        visibility: 'secret',
        parent: '../evil',
        topics: ['widgets', 7],
        homepage: 'javascript:alert(1)',
        created_at: 'yesterday',
        pushed_at: '2026-10-20T08:30:00Z',
      }).repository!;
      expect(repository).toEqual({
        name: 'acme/widget',
        ownerAvatarUrl: undefined,
        description: undefined,
        visibility: 'public',
        archived: false,
        template: false,
        fork: false,
        parent: undefined,
        topics: ['widgets'],
        license: undefined,
        defaultBranch: undefined,
        homepage: undefined,
        createdAt: undefined,
        pushedAt: new Date('2026-10-20T08:30:00Z'),
      });
      expect(
        summary({ name: 'acme/widget', homepage: 'http://widget.example/', parent: 'Up/Widget' })
          .repository,
      ).toEqual(
        expect.objectContaining({ homepage: 'http://widget.example/', parent: 'Up/Widget' }),
      );
    });

    it('says when GitHub says there is no such repository, or that it cannot be one', () => {
      const missing = summary(null, 404);
      expect([missing.notFound, missing.invalid, missing.failure, missing.path]).toEqual([
        true,
        false,
        undefined,
        undefined,
      ]);
      const invalid = summary(null, 400);
      expect([invalid.notFound, invalid.invalid, invalid.failure]).toEqual([
        false,
        true,
        undefined,
      ]);
    });

    it('says why GitHub keeps it from the viewer (FR-PAT-08)', () => {
      const sso = 'https://github.com/orgs/acme/sso?authorization_request=abc';
      expect(summary({ denied: 'sso', url: sso }, 403).denied).toEqual({ reason: 'sso', url: sso });
      // Only to GitHub itself.
      expect(summary({ denied: 'sso', url: 'https://evil.example/sso' }, 403).denied).toEqual({
        reason: 'sso',
        url: undefined,
      });
      expect(summary({ denied: 'token' }, 403)).toEqual(
        expect.objectContaining({ denied: { reason: 'token' }, failure: undefined }),
      );
      // A 403 that says nothing of why is a failure like any other.
      expect(summary(null, 403)).toEqual(
        expect.objectContaining({ denied: undefined, failure: 'github' }),
      );
    });

    it('says why BuhTig could show nothing, when it could not', () => {
      const failure = (status: number) => summary(null, status).failure;
      expect([failure(429), failure(503), failure(502), failure(500)]).toEqual([
        'held',
        'unavailable',
        'github',
        'github',
      ]);
    });

    it("asks for an organization's summary under its own URL", () => {
      const seen = outcome(resources.summary({ kind: 'organization', org: 'Acme' }));
      http.expectOne('/-/api/organizations/Acme').flush({ name: 'acme' });
      expect((seen.value as Summary).path).toBe('/acme');
      expect((seen.value as Summary).repository).toBeUndefined();
      expect((seen.value as Summary).organization?.login).toBe('acme');
    });
  });

  describe('refresh', () => {
    const refresh = (status: number, answer: object | null = null) => {
      const seen = outcome(
        resources.refresh({ kind: 'repository', owner: 'acme', repo: 'widget' }),
      );
      http
        .expectOne({ method: 'POST', url: `${WIDGET}/refresh` })
        .flush(answer, { status, statusText: `${status}` });
      return seen.value;
    };

    it('counts each refresh, so that what the dashboard shows is asked for again', () => {
      expect(resources.refreshes()).toBe(0);
      expect(refresh(204)).toEqual({ status: 'refreshed' });
      expect(resources.refreshes()).toBe(1);
    });

    it('says when it is too soon, and until when if the server says', () => {
      expect(refresh(429, { until: '2026-10-22T12:01:00Z' })).toEqual({
        status: 'too-soon',
        until: new Date('2026-10-22T12:01:00Z'),
      });
      expect(refresh(429)).toEqual({ status: 'too-soon', until: undefined });
      expect(refresh(502)).toEqual({ status: 'failed' });
      expect(resources.refreshes()).toBe(0);
    });
  });

  it('gives the stat cards, with the latest release if there is one', () => {
    const seen = outcome(resources.stats('acme', 'widget'));
    http.expectOne(`${WIDGET}/stats`).flush({
      stars: 1,
      forks: 2,
      watchers: 3,
      open_issues: 4,
      open_pull_requests: 5,
      latest_release: {
        tag: 'v2.1.0',
        published_at: '2026-10-01T12:00:00Z',
        url: 'javascript:alert(1)',
      },
    });
    expect(seen.value).toEqual({
      stars: 1,
      forks: 2,
      watchers: 3,
      openIssues: 4,
      openPullRequests: 5,
      latestRelease: {
        tag: 'v2.1.0',
        publishedAt: new Date('2026-10-01T12:00:00Z'),
        url: undefined,
      },
    });

    const none = outcome(resources.stats('acme', 'widget'));
    http.expectOne(`${WIDGET}/stats`).flush({
      stars: 0,
      forks: 0,
      watchers: 0,
      open_issues: 0,
      open_pull_requests: 0,
      latest_release: null,
    });
    expect(none.value?.latestRelease).toBeUndefined();
  });

  it('fails with Computing while GitHub computes a part (FR-REPO-10)', () => {
    const seen = outcome(resources.commitActivity('acme', 'widget'));
    http
      .expectOne(`${WIDGET}/commit-activity`)
      .flush(null, { status: 202, statusText: 'Accepted' });
    expect(seen.error).toBeInstanceOf(Computing);
  });

  it('totals the weeks of commit activity, leaving out those it cannot date', () => {
    const seen = outcome(resources.commitActivity('acme', 'widget'));
    http.expectOne(`${WIDGET}/commit-activity`).flush({
      weeks: [
        { week: '2026-10-11', commits: 3 },
        { week: 'someday', commits: 100 },
        { week: '2026-10-18', commits: 4 },
      ],
    });
    expect(seen.value).toEqual({
      weeks: [
        { start: new Date('2026-10-11'), commits: 3 },
        { start: new Date('2026-10-18'), commits: 4 },
      ],
      total: 7,
    });
  });

  it('totals the bytes of the languages, Other too', () => {
    const seen = outcome(resources.languages('acme', 'widget'));
    http.expectOne(`${WIDGET}/languages`).flush({
      languages: [
        { name: 'Rust', bytes: 600 },
        { name: 'Shell', bytes: 300 },
      ],
      other: 100,
    });
    expect(seen.value?.total).toBe(1_000);
  });

  it('gives the contributors, how many there are in all, and whether GitHub lists them', () => {
    const seen = outcome(resources.contributors('acme', 'widget'));
    http.expectOne(`${WIDGET}/contributors`).flush({
      contributors: [
        {
          login: 'alice',
          avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
          url: 'javascript:alert(1)',
          commits: 12,
        },
      ],
      too_large: false,
      count: 345,
    });
    expect(seen.value).toEqual({
      contributors: [
        {
          login: 'alice',
          avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
          url: undefined,
          commits: 12,
        },
      ],
      tooLarge: false,
      count: 345,
    });

    const unknown = outcome(resources.contributors('acme', 'widget'));
    http
      .expectOne(`${WIDGET}/contributors`)
      .flush({ contributors: [], too_large: true, count: null });
    expect(unknown.value).toEqual({ contributors: [], tooLarge: true, count: undefined });
  });

  it('gives the issues and pull requests, each with when it last changed', () => {
    const seen = outcome(resources.issues('acme', 'widget'));
    http.expectOne(`${WIDGET}/issues`).flush({
      issues: null,
      pull_requests: { open: 1, merged: 2, closed: 3 },
      recent: [
        {
          number: 49,
          title: 'Steady the widgets',
          kind: 'pull_request',
          state: 'merged',
          author: 'bob',
          created_at: '2026-10-19T08:00:00Z',
          updated_at: '2026-10-21T08:00:00Z',
          url: 'https://github.com/acme/widget/pull/49',
        },
        {
          number: 47,
          title: 'Widgets are too blue',
          kind: 'discussion',
          state: 'locked',
          author: '',
          created_at: null,
          url: null,
        },
      ],
    });
    expect(seen.value).toEqual({
      issues: undefined,
      pullRequests: { open: 1, merged: 2, closed: 3 },
      recent: [
        {
          number: 49,
          title: 'Steady the widgets',
          kind: 'pull_request',
          state: 'merged',
          author: 'bob',
          createdAt: new Date('2026-10-19T08:00:00Z'),
          updatedAt: new Date('2026-10-21T08:00:00Z'),
          url: 'https://github.com/acme/widget/pull/49',
        },
        // What it does not know is an open issue.
        {
          number: 47,
          title: 'Widgets are too blue',
          kind: 'issue',
          state: 'open',
          author: undefined,
          createdAt: undefined,
          updatedAt: undefined,
          url: undefined,
        },
      ],
    });
  });

  it("gives the latest commits, with their author's avatar", () => {
    const seen = outcome(resources.commits('acme', 'widget'));
    http.expectOne(`${WIDGET}/commits`).flush({
      commits: [
        {
          sha: 'abc1234def',
          message: 'Steady the widgets',
          author: 'alice',
          author_avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
          committed_at: '2026-10-21T08:00:00Z',
          url: 'https://github.com/acme/widget/commit/abc1234def',
        },
        { sha: 'def5678abc', message: '', author: null, committed_at: null, url: null },
      ],
    });
    expect(seen.value).toEqual([
      {
        sha: 'abc1234def',
        message: 'Steady the widgets',
        author: 'alice',
        authorAvatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
        committedAt: new Date('2026-10-21T08:00:00Z'),
        url: 'https://github.com/acme/widget/commit/abc1234def',
      },
      {
        sha: 'def5678abc',
        message: undefined,
        author: undefined,
        authorAvatarUrl: undefined,
        committedAt: undefined,
        url: undefined,
      },
    ]);
  });

  it('gives the latest releases, what each was made from, and how many there are', () => {
    const seen = outcome(resources.releases('acme', 'widget'));
    http.expectOne(`${WIDGET}/releases`).flush({
      releases: [
        {
          tag: 'v3.0.0-rc.1',
          name: '',
          published_at: '2026-10-11T12:00:00Z',
          prerelease: true,
          url: 'https://github.com/acme/widget/releases/tag/v3.0.0-rc.1',
          target: 'main',
        },
      ],
      count: 42,
    });
    expect(seen.value).toEqual({
      releases: [
        {
          tag: 'v3.0.0-rc.1',
          name: undefined,
          publishedAt: new Date('2026-10-11T12:00:00Z'),
          prerelease: true,
          url: 'https://github.com/acme/widget/releases/tag/v3.0.0-rc.1',
          target: 'main',
        },
      ],
      count: 42,
    });
  });

  it('counts at least the releases it lists, when the server does not say how many', () => {
    const seen = outcome(resources.releases('acme', 'widget'));
    http.expectOne(`${WIDGET}/releases`).flush({
      releases: [
        { tag: 'v2', name: null, published_at: null, prerelease: false, url: null },
        { tag: 'v1', name: 'One', published_at: null, prerelease: false, url: null, target: null },
      ],
    });
    expect(seen.value?.count).toBe(2);
    expect(seen.value?.releases.map((release) => release.target)).toEqual([undefined, undefined]);
  });

  it("gives an organization's repository's commit activity, or Computing", () => {
    const seen = outcome(resources.organizationActivity('acme', 'widget'));
    http
      .expectOne('/-/api/organizations/acme/repositories/widget/commit-activity')
      .flush({ weeks: [{ week: '2026-10-18', commits: 2 }] });
    expect(seen.value?.total).toBe(2);

    const computing = outcome(resources.organizationActivity('acme', 'widget'));
    http
      .expectOne('/-/api/organizations/acme/repositories/widget/commit-activity')
      .flush(null, { status: 202, statusText: 'Accepted' });
    expect(computing.error).toBeInstanceOf(Computing);
  });

  it("tells a user's account from an organization's, or that it cannot tell (FR-SRCH-06)", () => {
    const type = (answer: object | null, status = 200) => {
      const seen = outcome(resources.accountType('mona'));
      http.expectOne('/-/api/accounts/mona').flush(answer, { status, statusText: `${status}` });
      return seen.value;
    };
    expect(type({ type: 'user' })).toBe('user');
    expect(type({ type: 'organization' })).toBe('organization');
    expect(type({ type: 'bot' })).toBeUndefined();
    expect(type(null, 404)).toBeUndefined();
  });

  it("suggests a user's repositories, leaving out names no repository can have", () => {
    const seen = outcome(resources.userRepositories('mona'));
    http.expectOne('/-/api/users/mona/repositories').flush({
      repositories: [
        { name: 'mona/rocket' },
        { name: '../evil' },
        { name: 'mona' },
        { name: 'mona/x.git' },
      ],
    });
    expect(seen.value).toEqual(['mona/rocket']);
  });
});
