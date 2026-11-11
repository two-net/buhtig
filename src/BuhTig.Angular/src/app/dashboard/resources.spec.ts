import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
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
      expect((seen.value as Summary).resource).toEqual({ kind: 'organization', org: 'acme' });
      expect((seen.value as Summary).repository).toBeUndefined();
      expect((seen.value as Summary).user).toBeUndefined();
      expect((seen.value as Summary).organization?.login).toBe('acme');
    });

    it("asks for a user's summary under their own URL", () => {
      const seen = outcome(resources.summary({ kind: 'user', login: 'Mona' }));
      http.expectOne('/-/api/users/Mona').flush({ name: 'mona', followers: 3, following: 1 });
      expect((seen.value as Summary).path).toBe('/mona');
      expect((seen.value as Summary).resource).toEqual({ kind: 'user', login: 'mona' });
      expect((seen.value as Summary).organization).toBeUndefined();
      expect((seen.value as Summary).user).toEqual(
        expect.objectContaining({ login: 'mona', followers: 3, following: 1 }),
      );
    });

    it('asks what an account named alone is, then for it, by the name the URL has (FR-SRCH-06)', () => {
      const user = outcome(resources.summary({ kind: 'account', name: 'Mona' }));
      http.expectOne('/-/api/accounts/Mona').flush({ type: 'user', login: 'mona' });
      http
        .expectOne('/-/api/users/Mona')
        .flush({ name: 'mona', fetched_at: '2026-10-22T12:00:00Z' });
      expect(user.value).toEqual(
        expect.objectContaining({
          path: '/mona',
          resource: { kind: 'user', login: 'mona' },
          fetchedAt: new Date('2026-10-22T12:00:00Z'),
          organization: undefined,
        }),
      );
      expect(user.value?.user?.login).toBe('mona');

      const organization = outcome(resources.summary({ kind: 'account', name: 'acme' }));
      http.expectOne('/-/api/accounts/acme').flush({ type: 'organization', login: 'acme' });
      http.expectOne('/-/api/organizations/acme').flush({ name: 'acme' });
      expect(organization.value?.resource).toEqual({ kind: 'organization', org: 'acme' });
      expect(organization.value?.organization?.login).toBe('acme');
    });

    it('says what keeps it from telling what an account named alone is, as of any resource', () => {
      const told = (answer: object | null, status = 200) => {
        const seen = outcome(resources.summary({ kind: 'account', name: 'mona' }));
        http.expectOne('/-/api/accounts/mona').flush(answer, { status, statusText: `${status}` });
        const { notFound, invalid, failure, path } = seen.value!;
        return [notFound, invalid, failure, path];
      };
      expect(told(null, 404)).toEqual([true, false, undefined, undefined]);
      expect(told(null, 400)).toEqual([false, true, undefined, undefined]);
      expect(told(null, 429)).toEqual([false, false, 'held', undefined]);
      expect(told(null, 503)).toEqual([false, false, 'unavailable', undefined]);
      expect(told(null, 502)).toEqual([false, false, 'github', undefined]);
      // An account of no kind BuhTig knows.
      expect(told({ type: 'bot', login: 'mona' })).toEqual([false, false, 'github', undefined]);
    });

    it("takes an organization's URL that names a user to the user, as GitHub tells", () => {
      const user = outcome(resources.summary({ kind: 'organization', org: 'mona' }));
      http.expectOne('/-/api/organizations/mona').flush(null, { status: 404, statusText: '404' });
      http.expectOne('/-/api/accounts/mona').flush({ type: 'user', login: 'mona' });
      http.expectOne('/-/api/users/mona').flush({ name: 'mona' });
      expect(user.value?.resource).toEqual({ kind: 'user', login: 'mona' });

      // Not when GitHub has no such account, nor says it is an organization after all.
      for (const answer of [{ status: 404 }, { status: 200, type: 'organization' }]) {
        const missing = outcome(resources.summary({ kind: 'organization', org: 'acme' }));
        http.expectOne('/-/api/organizations/acme').flush(null, { status: 404, statusText: '404' });
        http
          .expectOne('/-/api/accounts/acme')
          .flush(answer.status === 200 ? { type: answer.type } : null, {
            status: answer.status,
            statusText: `${answer.status}`,
          });
        expect([missing.value?.notFound, missing.value?.failure]).toEqual([true, undefined]);
      }
      // Nor asks what it is when the organization fails otherwise.
      const failed = outcome(resources.summary({ kind: 'organization', org: 'acme' }));
      http.expectOne('/-/api/organizations/acme').flush(null, { status: 502, statusText: '502' });
      expect(failed.value?.failure).toBe('github');
    });

    it('keeps only what it can show safely of a user (FR-USER-01, NFR-SEC-03)', () => {
      const seen = outcome(resources.summary({ kind: 'user', login: 'mona' }));
      http.expectOne('/-/api/users/mona').flush({
        name: 'mona',
        avatar_url: 'http://avatars.example/u/1',
        display_name: '',
        bio: 'Builds <b>things</b>',
        company: '@acme',
        location: null,
        website: 'javascript:alert(1)',
        created_at: 'yesterday',
        followers: -1,
        following: 'many',
      });
      expect(seen.value?.user).toEqual({
        login: 'mona',
        avatarUrl: undefined,
        displayName: undefined,
        bio: 'Builds <b>things</b>',
        company: '@acme',
        location: undefined,
        website: undefined,
        createdAt: undefined,
        followers: 0,
        following: 0,
      });
      const full = outcome(resources.summary({ kind: 'user', login: 'mona' }));
      http.expectOne('/-/api/users/mona').flush({
        name: 'mona',
        avatar_url: 'https://avatars.githubusercontent.com/u/1',
        display_name: 'Mona Lisa',
        website: 'http://mona.example/',
        created_at: '2011-01-25T18:44:36Z',
        followers: 1_234,
        following: 5,
      });
      expect(full.value?.user).toEqual(
        expect.objectContaining({
          avatarUrl: 'https://avatars.githubusercontent.com/u/1',
          displayName: 'Mona Lisa',
          website: 'http://mona.example/',
          createdAt: new Date('2011-01-25T18:44:36Z'),
          followers: 1_234,
          following: 5,
        }),
      );
    });

    it('shows nothing of an answer that names no such account', () => {
      for (const name of ['mona/rocket', '../evil', 'orgs', 'github.com/mona']) {
        const seen = outcome(resources.summary({ kind: 'user', login: 'mona' }));
        http.expectOne('/-/api/users/mona').flush({ name });
        expect([seen.value?.path, seen.value?.resource, seen.value?.user], name).toEqual([
          undefined,
          undefined,
          undefined,
        ]);
      }
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

  it('gives a page of the issues or pull requests that a view of a tab shows (FR-REPO-06)', () => {
    const view = {
      state: 'merged' as const,
      label: 'good first issue',
      sort: 'oldest' as const,
      page: 1,
    };
    const seen = outcome(resources.issueList('acme', 'widget', 'pull_request', view));
    const request = http.expectOne((request) => request.url === `${WIDGET}/pull-list`);
    // The view alone, never the URL's query.
    expect(request.request.urlWithParams).toBe(
      `${WIDGET}/pull-list?state=merged&sort=oldest&page=2&label=good%20first%20issue`,
    );
    request.flush({
      items: [
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
        // Of the other kind, as no answer should have.
        {
          number: 50,
          title: 'Widgets wobble',
          kind: 'issue',
          state: 'open',
          author: null,
          created_at: null,
          url: null,
        },
      ],
      total: 1234,
      page: 2,
      pages: 40,
      per_page: 25,
      capped: true,
      incomplete: false,
      off: false,
      fetched_at: '2026-10-22T12:00:00.000Z',
      stale: null,
    });
    expect(seen.value).toEqual({
      view,
      items: [
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
      ],
      total: 1234,
      page: 1,
      pages: 40,
      capped: true,
      incomplete: false,
      off: false,
      fetchedAt: new Date('2026-10-22T12:00:00.000Z'),
      stale: undefined,
    });

    // Issues, as the list starts, of a repository that has turned them off.
    const off = outcome(
      resources.issueList('acme', 'widget', 'issue', {
        state: 'open',
        label: undefined,
        sort: 'updated',
        page: 0,
      }),
    );
    http.expectOne(`${WIDGET}/issue-list?state=open&sort=updated&page=1`).flush({
      items: [],
      total: 0,
      page: 1,
      pages: 1,
      capped: false,
      incomplete: false,
      off: true,
    });
    expect(off.value).toEqual(
      expect.objectContaining({ items: [], total: 0, page: 0, pages: 1, off: true }),
    );
  });

  it("gives the repository's labels, leaving out what is no label's name", () => {
    const seen = outcome(resources.labels('acme', 'widget'));
    http
      .expectOne(`${WIDGET}/labels`)
      .flush({ labels: ['bug', '', 'good first issue', 7], truncated: true });
    expect(seen.value).toEqual({ names: ['bug', 'good first issue'], truncated: true });
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

  /** The server's answer of merge velocity for a few pull requests. */
  const MERGES = {
    sampled: 3,
    merged: 2,
    closed: 1,
    median_time_to_merge: 3_600,
    truncated: false,
  };

  it('gives how the pull requests updated last came to an end (FR-REPO-13)', () => {
    const seen = outcome(resources.mergeVelocity('acme', 'widget'));
    http.expectOne(`${WIDGET}/merge-velocity`).flush({
      sampled: 100,
      merged: 61,
      closed: 9,
      median_time_to_merge: 172_800,
      truncated: true,
    });
    expect(seen.value).toEqual({
      sampled: 100,
      merged: 61,
      closed: 9,
      medianTimeToMerge: 172_800,
      truncated: true,
    });

    const none = outcome(resources.mergeVelocity('acme', 'widget'));
    http.expectOne(`${WIDGET}/merge-velocity`).flush({
      sampled: 0,
      merged: -1,
      closed: 0,
      median_time_to_merge: null,
      truncated: false,
    });
    expect(none.value).toEqual({
      sampled: 0,
      merged: 0,
      closed: 0,
      medianTimeToMerge: undefined,
      truncated: false,
    });
  });

  it('gives how long the open issues updated last have been open (FR-REPO-13)', () => {
    const seen = outcome(resources.issueAge('acme', 'widget'));
    http
      .expectOne(`${WIDGET}/issue-age`)
      .flush({ sampled: 37, median_age: 5_184_000, truncated: true });
    expect(seen.value).toEqual({ sampled: 37, medianAge: 5_184_000, truncated: true });
  });

  it('gives how the latest workflow runs fared, linking only to GitHub (FR-REPO-14)', () => {
    const seen = outcome(resources.workflowRuns('acme', 'widget'));
    http.expectOne(`${WIDGET}/workflow-runs`).flush({
      branch: 'main',
      sampled: 50,
      passed: 45,
      failed: 3,
      average_duration: 252,
      latest: {
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-10-22T10:00:00Z',
        url: 'https://github.com/acme/widget/actions/runs/7',
      },
      hidden: false,
    });
    expect(seen.value).toEqual({
      branch: 'main',
      sampled: 50,
      passed: 45,
      failed: 3,
      averageDuration: 252,
      latest: {
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
        startedAt: new Date('2026-10-22T10:00:00Z'),
        url: 'https://github.com/acme/widget/actions/runs/7',
      },
      hidden: false,
    });

    const hidden = outcome(resources.workflowRuns('acme', 'widget'));
    http.expectOne(`${WIDGET}/workflow-runs`).flush({
      branch: null,
      sampled: 0,
      passed: 0,
      failed: 0,
      average_duration: null,
      latest: { name: '', status: null, conclusion: null, started_at: null, url: 'javascript:x' },
      hidden: true,
    });
    expect(hidden.value).toEqual({
      branch: undefined,
      sampled: 0,
      passed: 0,
      failed: 0,
      averageDuration: undefined,
      latest: {
        name: undefined,
        status: undefined,
        conclusion: undefined,
        startedAt: undefined,
        url: undefined,
      },
      hidden: true,
    });
  });

  it('totals the weeks of code frequency, leaving out those it cannot date, or fails with Computing (FR-REPO-15)', () => {
    const seen = outcome(resources.codeFrequency('acme', 'widget'));
    http.expectOne(`${WIDGET}/code-frequency`).flush({
      weeks: [
        { week: '2026-10-18', additions: 1_200, deletions: 340 },
        { week: 'soon', additions: 5, deletions: 5 },
        { week: '2026-10-25', additions: 3, deletions: 0 },
      ],
      too_large: false,
    });
    expect(seen.value).toEqual({
      weeks: [
        { start: new Date('2026-10-18T00:00:00Z'), additions: 1_200, deletions: 340 },
        { start: new Date('2026-10-25T00:00:00Z'), additions: 3, deletions: 0 },
      ],
      additions: 1_203,
      deletions: 340,
      tooLarge: false,
    });

    const large = outcome(resources.codeFrequency('acme', 'widget'));
    http.expectOne(`${WIDGET}/code-frequency`).flush({ weeks: [], too_large: true });
    expect(large.value?.tooLarge).toBe(true);

    const computing = outcome(resources.codeFrequency('acme', 'widget'));
    http.expectOne(`${WIDGET}/code-frequency`).flush(null, { status: 202, statusText: 'Accepted' });
    expect(computing.error).toBeInstanceOf(Computing);
  });

  it('gives how the figures changed, as observed, leaving out what it cannot date (FR-REPO-17)', () => {
    const seen = outcome(resources.trends('acme', 'widget'));
    const first = {
      day: '2026-11-02',
      observed_at: '2026-11-02T10:00:00.000Z',
      pull_requests_observed_at: '2026-11-02T10:01:00.000Z',
      stars: 100,
      forks: 10,
      open_issues: 50,
      open_pull_requests: 7,
    };
    const latest = {
      ...first,
      day: '2026-11-09',
      observed_at: '2026-11-09T09:00:00.000Z',
      pull_requests_observed_at: '2026-11-09T09:00:00.000Z',
      stars: 112,
      open_issues: 44,
    };
    http.expectOne(`${WIDGET}/trends`).flush({
      scope: 'private',
      kept_days: 90,
      tracking_since: '2026-11-02T10:00:00.000Z',
      observations: [first, { ...first, day: 'someday', observed_at: 'then' }, latest],
      gaps: [{ from: '2026-11-03', to: '2026-11-08' }],
      periods: [
        {
          days: 7,
          target: '2026-11-02T09:00:00.000Z',
          first_day: '2026-11-02',
          observed_days: 2,
          supported: true,
          from: first,
          to: latest,
          changes: { stars: 12, forks: 0, open_issues: -6, open_pull_requests: 0 },
        },
        {
          days: 30,
          target: '2026-10-10T09:00:00.000Z',
          first_day: '2026-10-10',
          observed_days: 2,
          supported: false,
          reason: 'tracked_later',
        },
        { days: 90, supported: false, reason: 'something new' },
      ],
      fetched_at: '2026-11-09T09:00:00.000Z',
      stale: null,
    });
    const observed = (day: string, at: string, prs: string, stars: number, issues: number) => ({
      day: new Date(`${day}T00:00:00Z`),
      observedAt: new Date(at),
      pullRequestsObservedAt: new Date(prs),
      figures: { stars, forks: 10, openIssues: issues, openPullRequests: 7 },
    });
    const [from, to] = [
      observed('2026-11-02', '2026-11-02T10:00:00Z', '2026-11-02T10:01:00Z', 100, 50),
      observed('2026-11-09', '2026-11-09T09:00:00Z', '2026-11-09T09:00:00Z', 112, 44),
    ];
    expect(seen.value).toEqual({
      scope: 'private',
      keptDays: 90,
      trackingSince: new Date('2026-11-02T10:00:00Z'),
      observations: [from, to],
      gaps: [{ from: new Date('2026-11-03T00:00:00Z'), to: new Date('2026-11-08T00:00:00Z') }],
      periods: [
        {
          days: 7,
          target: new Date('2026-11-02T09:00:00Z'),
          firstDay: new Date('2026-11-02T00:00:00Z'),
          observedDays: 2,
          supported: true,
          from,
          to,
          // A change may be down, which a count may not.
          changes: { stars: 12, forks: 0, openIssues: -6, openPullRequests: 0 },
        },
        {
          days: 30,
          target: new Date('2026-10-10T09:00:00Z'),
          firstDay: new Date('2026-10-10T00:00:00Z'),
          observedDays: 2,
          supported: false,
          reason: 'tracked_later',
        },
        // A reason it does not know is told as no observation near the period's start.
        {
          days: 90,
          target: undefined,
          firstDay: undefined,
          observedDays: 0,
          supported: false,
          reason: 'no_observation_then',
        },
      ],
      fetchedAt: new Date('2026-11-09T09:00:00Z'),
      stale: undefined,
    });

    const shared = outcome(resources.trends('acme', 'widget'));
    http.expectOne(`${WIDGET}/trends`).flush({
      scope: 'anyone',
      kept_days: 90,
      tracking_since: null,
      observations: [],
      gaps: [],
      periods: [],
    });
    expect(shared.value?.scope).toBe('shared');
    expect(shared.value?.trackingSince).toBeUndefined();
  });

  it('gives how often the repository was released, and downloaded (FR-REPO-16)', () => {
    const seen = outcome(resources.releaseCadence('acme', 'widget'));
    http.expectOne(`${WIDGET}/release-cadence`).flush({
      sampled: 100,
      stable: 80,
      prereleases: 20,
      average_interval: 1_036_800,
      assets: 240,
      downloads: 123_456,
      truncated: true,
    });
    expect(seen.value).toEqual({
      sampled: 100,
      stable: 80,
      prereleases: 20,
      averageInterval: 1_036_800,
      assets: 240,
      downloads: 123_456,
      truncated: true,
    });
  });

  it('tells when the data of each figure was fetched, and why it is no newer (FR-CMP-06)', () => {
    const fetchedAt = '2026-10-22T12:00:00.123Z';
    const velocity = outcome(resources.mergeVelocity('acme', 'widget'));
    http
      .expectOne(`${WIDGET}/merge-velocity`)
      .flush({ ...MERGES, fetched_at: fetchedAt, stale: null });
    expect(velocity.value).toMatchObject({ fetchedAt: new Date(fetchedAt), stale: undefined });

    const age = outcome(resources.issueAge('acme', 'widget'));
    http.expectOne(`${WIDGET}/issue-age`).flush({
      sampled: 1,
      median_age: 60,
      truncated: false,
      fetched_at: fetchedAt,
      stale: 'github',
    });
    expect(age.value).toMatchObject({ fetchedAt: new Date(fetchedAt), stale: 'github' });

    const runs = outcome(resources.workflowRuns('acme', 'widget'));
    http.expectOne(`${WIDGET}/workflow-runs`).flush({
      branch: 'main',
      sampled: 0,
      passed: 0,
      failed: 0,
      average_duration: null,
      latest: null,
      hidden: true,
      fetched_at: fetchedAt,
      stale: 'held',
    });
    expect(runs.value).toMatchObject({ fetchedAt: new Date(fetchedAt), stale: 'held' });

    // What the server does not tell, or tells in a form BuhTig does not know, is not told.
    const cadence = outcome(resources.releaseCadence('acme', 'widget'));
    http.expectOne(`${WIDGET}/release-cadence`).flush({
      sampled: 0,
      stable: 0,
      prereleases: 0,
      average_interval: null,
      assets: 0,
      downloads: 0,
      truncated: false,
      fetched_at: 'yesterday',
      stale: 'later',
    });
    expect(cadence.value).toMatchObject({ fetchedAt: undefined, stale: undefined });
  });

  describe('glance', () => {
    const FETCHED = '2026-11-09T10:00:00.000Z';
    const RUNS = {
      branch: 'main',
      sampled: 3,
      passed: 2,
      failed: 1,
      average_duration: 90,
      latest: {
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
        started_at: FETCHED,
        url: 'https://github.com/acme/widget/actions/runs/1',
      },
      hidden: false,
      fetched_at: '2026-11-09T09:00:00.000Z',
      stale: 'github',
    };
    const ANSWER = {
      name: 'Acme/Widget',
      fetched_at: FETCHED,
      stale: null,
      owner_avatar_url: 'https://avatars.githubusercontent.com/u/1',
      description: 'A widget',
      visibility: 'private',
      archived: true,
      fork: false,
      pushed_at: '2026-11-08T10:00:00Z',
      default_branch: 'main',
      latest_release: {
        release: {
          tag: 'v1.2.0',
          published_at: '2026-11-01T10:00:00Z',
          url: 'javascript:alert(1)',
        },
        fetched_at: FETCHED,
        stale: null,
      },
      workflow_runs: RUNS,
    };

    const glance = (answer: object | null, status = 200) => {
      const seen = outcome(resources.glance('acme', 'widget'));
      http.expectOne(`${WIDGET}/glance`).flush(answer, { status, statusText: `${status}` });
      return seen;
    };

    it('tells what a watchlist shows of the repository, each part with its own date (FR-PERS-08)', () => {
      const seen = glance(ANSWER).value;
      expect(seen?.status).toBe('found');
      const shown = seen?.status === 'found' ? seen.glance : undefined;
      expect(shown?.path).toBe('/Acme/Widget');
      expect(shown?.repository).toMatchObject({
        name: 'Acme/Widget',
        description: 'A widget',
        visibility: 'private',
        archived: true,
        fork: false,
        pushedAt: new Date('2026-11-08T10:00:00Z'),
        defaultBranch: 'main',
      });
      expect([shown?.fetchedAt, shown?.stale]).toEqual([new Date(FETCHED), undefined]);
      // Links only to http and https URLs (NFR-SEC-03).
      expect(shown?.latestRelease).toEqual({
        ok: true,
        release: { tag: 'v1.2.0', publishedAt: new Date('2026-11-01T10:00:00Z'), url: undefined },
        fetchedAt: new Date(FETCHED),
        stale: undefined,
      });
      expect(shown?.workflowRuns).toMatchObject({
        ok: true,
        branch: 'main',
        passed: 2,
        latest: { conclusion: 'success', url: RUNS.latest.url },
        fetchedAt: new Date(RUNS.fetched_at),
        stale: 'github',
      });
    });

    it('tells a repository without releases, and the parts that failed alone', () => {
      const seen = glance({
        ...ANSWER,
        latest_release: { release: null, fetched_at: FETCHED, stale: null },
        workflow_runs: { failure: 'unavailable' },
      }).value;
      const shown = seen?.status === 'found' ? seen.glance : undefined;
      expect(shown?.latestRelease).toMatchObject({ ok: true, release: undefined });
      expect(shown?.workflowRuns).toEqual({ ok: false, failure: 'unavailable' });

      const other = glance({ ...ANSWER, latest_release: { failure: 'whatever' } }).value;
      expect(other?.status === 'found' && other.glance.latestRelease).toEqual({
        ok: false,
        failure: 'github',
      });
    });

    it('says when GitHub shows the viewer none of it, or that it cannot be a repository', () => {
      expect(glance(null, 404).value).toEqual({ status: 'not-found' });
      expect(glance(null, 400).value).toEqual({ status: 'invalid' });
      expect(glance({ denied: 'token' }, 403).value).toEqual({
        status: 'denied',
        denied: { reason: 'token' },
      });
      expect(glance({ denied: 'sso', url: 'https://github.com/orgs/acme/sso' }, 403).value).toEqual(
        {
          status: 'denied',
          denied: { reason: 'sso', url: 'https://github.com/orgs/acme/sso' },
        },
      );
    });

    it('fails when BuhTig cannot tell now, for the row to try again', () => {
      const failed = glance(null, 502);
      expect(failed.value).toBeUndefined();
      expect(failed.error).toBeInstanceOf(HttpErrorResponse);
    });

    it('tells how its figures changed over a week, or that it could not (FR-PERS-10)', () => {
      const observed = (at: string, stars: number) => ({
        day: at.slice(0, 10),
        observed_at: at,
        pull_requests_observed_at: at,
        stars,
        forks: 5,
        open_issues: 7,
        open_pull_requests: 2,
      });
      const [from, to] = [observed('2026-11-02T10:00:00.000Z', 41), observed(FETCHED, 50)];
      const seen = glance({
        ...ANSWER,
        trend: {
          scope: 'private',
          tracking_since: from.observed_at,
          latest: to,
          period: {
            days: 7,
            target: '2026-11-02T10:00:00.000Z',
            first_day: '2026-11-02',
            observed_days: 2,
            supported: true,
            from,
            to,
            changes: { stars: 9, forks: 0, open_issues: 0, open_pull_requests: 0 },
          },
        },
      }).value;
      const trend = seen?.status === 'found' ? seen.glance.trend : undefined;
      expect(trend).toMatchObject({
        ok: true,
        scope: 'private',
        trackingSince: new Date(from.observed_at),
        latest: { observedAt: new Date(FETCHED), figures: { stars: 50 } },
        period: {
          days: 7,
          observedDays: 2,
          supported: true,
          from: { figures: { stars: 41 } },
          changes: { stars: 9, forks: 0, openIssues: 0, openPullRequests: 0 },
        },
      });

      const none = glance({
        ...ANSWER,
        trend: {
          scope: 'shared',
          tracking_since: null,
          latest: null,
          period: { days: 7, supported: false, reason: 'no_observations' },
        },
      }).value;
      expect(none?.status === 'found' && none.glance.trend).toMatchObject({
        ok: true,
        scope: 'shared',
        latest: undefined,
        period: { supported: false, reason: 'no_observations' },
      });
      const failed = glance({ ...ANSWER, trend: { failure: 'unavailable' } }).value;
      expect(failed?.status === 'found' && failed.glance.trend).toEqual({
        ok: false,
        failure: 'unavailable',
      });
      // Nothing from a read that GitHub did not just give or confirm.
      const saved = glance({ ...ANSWER, stale: 'github', trend: null }).value;
      expect(saved?.status === 'found' && saved.glance.trend).toBeUndefined();
    });

    it("asks for a watchlist's row what is new since it last showed it (FR-PERS-11)", () => {
      const seen = outcome(resources.glance('acme', 'widget', 7));
      const asked = http.expectOne(`${WIDGET}/glance?watchlist=7`);
      asked.flush({
        ...ANSWER,
        since: {
          release: { seen_at: FETCHED, tag: null, new: true },
          run: { seen_at: FETCHED, outcome: 'passed', new: false },
          push: { seen_at: FETCHED, pushed_at: 'not a time', new: true },
        },
      });
      const since = seen.value?.status === 'found' ? seen.value.glance.since : undefined;
      expect(since).toEqual({
        release: { seenAt: new Date(FETCHED), new: true, tag: undefined },
        run: { seenAt: new Date(FETCHED), new: false, outcome: 'passed' },
        // What the server does not say, as when, is not told.
        push: undefined,
      });
      // Without a watchlist, nothing is asked of one.
      expect(glance(ANSWER).value).toMatchObject({ glance: { since: undefined } });
    });
  });

  it("gives an organization's or a user's repository's commit activity, or Computing", () => {
    const seen = outcome(
      resources.accountActivity({ kind: 'organization', org: 'acme' }, 'widget'),
    );
    http
      .expectOne('/-/api/organizations/acme/repositories/widget/commit-activity')
      .flush({ weeks: [{ week: '2026-10-18', commits: 2 }] });
    expect(seen.value?.total).toBe(2);

    const computing = outcome(resources.accountActivity({ kind: 'user', login: 'mona' }, 'rocket'));
    http
      .expectOne('/-/api/users/mona/repositories/rocket/commit-activity')
      .flush(null, { status: 202, statusText: 'Accepted' });
    expect(computing.error).toBeInstanceOf(Computing);
  });

  it("asks for each part of a user's dashboard under their own URL, as of an organization's (FR-USER-02 to FR-USER-04)", () => {
    const mona = { kind: 'user', login: 'mona' } as const;
    const stats = outcome(resources.accountStats(mona));
    http.expectOne('/-/api/users/mona/stats').flush({
      repositories: 3,
      private: 1,
      internal: 0,
      stars: 5,
      forks: 2,
      open_issues_and_pull_requests: 4,
      top_language: null,
      truncated: false,
    });
    expect(stats.value).toEqual({
      repositories: 3,
      private: 1,
      internal: 0,
      stars: 5,
      forks: 2,
      openIssuesAndPullRequests: 4,
      topLanguage: undefined,
      truncated: false,
    });

    const repositories = outcome(resources.accountRepositories(mona));
    http.expectOne('/-/api/users/mona/repositories').flush({
      repositories: ['rocket', '../evil'].map((name) => ({
        name,
        description: null,
        language: null,
        stars: 0,
        forks: 0,
        open_issues_and_pull_requests: 0,
        pushed_at: null,
        fork: false,
        archived: false,
        visibility: 'private',
      })),
      truncated: true,
      repositories_read: 2,
      fetched_at: '2026-11-09T10:00:00.000Z',
      stale: 'github',
    });
    expect(
      repositories.value?.repositories.map(({ name, path, visibility }) => [
        name,
        path,
        visibility,
      ]),
    ).toEqual([['rocket', '/mona/rocket', 'private']]);
    // What the list covers, and when it was fetched, for an export of it (FR-EXP-04).
    expect(repositories.value).toMatchObject({
      truncated: true,
      repositoriesRead: 2,
      fetchedAt: new Date('2026-11-09T10:00:00.000Z'),
      stale: 'github',
    });

    const top = outcome(resources.topRepositories(mona));
    http
      .expectOne('/-/api/users/mona/top-repositories')
      .flush({ repositories: [{ name: 'rocket', stars: 5 }] });
    // A server that does not say what they cover is taken to have read none, of all there are.
    expect(top.value).toEqual({
      repositories: [{ name: 'rocket', path: '/mona/rocket', stars: 5 }],
      truncated: false,
      repositoriesRead: 0,
      fetchedAt: undefined,
      stale: undefined,
    });

    outcome(resources.accountLanguages(mona));
    http.expectOne('/-/api/users/mona/languages').flush({ languages: [], other: 0 });
    outcome(resources.lastPush(mona));
    http
      .expectOne('/-/api/users/mona/last-push')
      .flush({ last_7_days: 0, last_30_days: 0, last_12_months: 0, older: 0 });
    outcome(resources.createdPerYear(mona));
    http.expectOne('/-/api/users/mona/created-per-year').flush({ years: [] });
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
});
