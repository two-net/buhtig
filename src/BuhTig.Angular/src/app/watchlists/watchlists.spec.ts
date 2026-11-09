import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import {
  MAX_NAME_LENGTH,
  Watchlist,
  WatchlistProblem,
  Watchlists,
  nameProblem,
  sameRepository,
} from './watchlists';

describe('Watchlists', () => {
  let watchlists: Watchlists;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    watchlists = TestBed.inject(Watchlists);
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

  const DEPENDENCIES: Watchlist = {
    id: 7,
    name: 'Dependencies',
    repositories: ['acme/widget', 'octo/thing'],
  };
  const ANSWER = { watchlists: [DEPENDENCIES] };

  it("lists the user's watchlists", () => {
    const seen = outcome(watchlists.list());
    http.expectOne({ method: 'GET', url: '/-/api/watchlists' }).flush(ANSWER);
    expect(seen.value).toEqual([DEPENDENCIES]);
  });

  it('makes a watchlist, with repositories from the start if asked (FR-PERS-06)', () => {
    const plain = outcome(watchlists.create('Dependencies'));
    const made = http.expectOne({ method: 'POST', url: '/-/api/watchlists' });
    expect(made.request.body).toEqual({ name: 'Dependencies' });
    made.flush({ id: 7, ...ANSWER }, { status: 201, statusText: 'Created' });
    expect(plain.value).toEqual({ id: 7, watchlists: [DEPENDENCIES] });

    outcome(watchlists.create('Dependencies', ['acme/widget']));
    const filled = http.expectOne({ method: 'POST', url: '/-/api/watchlists' });
    expect(filled.request.body).toEqual({ name: 'Dependencies', repositories: ['acme/widget'] });
    filled.flush({ id: 8, ...ANSWER });
  });

  it('renames, deletes, adds to, takes out of, and reorders a watchlist (FR-PERS-06, FR-PERS-07)', () => {
    const asked: [string, string, unknown][] = [];
    const answer = () => {
      const request = http.expectOne(() => true);
      asked.push([request.request.method, request.request.url, request.request.body]);
      request.flush(ANSWER);
    };
    outcome(watchlists.rename(7, 'Deps'));
    answer();
    outcome(watchlists.remove(7));
    answer();
    outcome(watchlists.add(7, ['acme/widget', 'octo/thing']));
    answer();
    outcome(watchlists.drop(7, 'acme/widget'));
    answer();
    outcome(watchlists.reorder(7, ['octo/thing', 'acme/widget']));
    answer();
    expect(asked).toEqual([
      ['PUT', '/-/api/watchlists/7', { name: 'Deps' }],
      ['DELETE', '/-/api/watchlists/7', null],
      ['POST', '/-/api/watchlists/7/repositories', { repositories: ['acme/widget', 'octo/thing'] }],
      ['DELETE', '/-/api/watchlists/7/repositories/acme/widget', null],
      ['PUT', '/-/api/watchlists/7/repositories', { repositories: ['octo/thing', 'acme/widget'] }],
    ]);
  });

  it('fails with what the server says was wrong, or that it could not change them', () => {
    const problem = (status: number, body: object | null): WatchlistProblem => {
      const seen = outcome(watchlists.add(7, ['acme/widget']));
      http
        .expectOne('/-/api/watchlists/7/repositories')
        .flush(body, { status, statusText: `${status}` });
      expect(seen.value).toBeUndefined();
      return seen.error as WatchlistProblem;
    };
    expect(problem(409, { error: 'too_many_repositories' })).toBe('too_many_repositories');
    expect(problem(409, { error: 'too_many_watchlists' })).toBe('too_many_watchlists');
    expect(problem(409, { error: 'name_taken' })).toBe('name_taken');
    expect(problem(422, { error: 'invalid_name' })).toBe('invalid_name');
    expect(problem(422, { error: 'invalid_repositories' })).toBe('invalid_repositories');
    expect(problem(409, { error: 'something_else' })).toBe('failed');
    expect(problem(404, null)).toBe('not_found');
    expect(problem(503, null)).toBe('failed');

    const made = outcome(watchlists.create('Deps'));
    http
      .expectOne('/-/api/watchlists')
      .flush({ error: 'too_many_watchlists' }, { status: 409, statusText: 'Conflict' });
    expect(made.error).toBe('too_many_watchlists');
  });

  it('checks a name before the server is asked (FR-PERS-06)', () => {
    expect(nameProblem('  Dependencies  ', [])).toBeUndefined();
    expect(nameProblem('   ', [])).toBe('invalid_name');
    expect(nameProblem('x'.repeat(MAX_NAME_LENGTH), [])).toBeUndefined();
    expect(nameProblem('x'.repeat(MAX_NAME_LENGTH + 1), [])).toBe('invalid_name');
    // Characters, not UTF-16 code units, count.
    expect(nameProblem('🙂'.repeat(MAX_NAME_LENGTH), [])).toBeUndefined();
    expect(nameProblem('Deps\u0007', [])).toBe('invalid_name');
    expect(nameProblem('dependencies', [DEPENDENCIES])).toBe('name_taken');
  });

  it('tells the same repository whatever the case of its name', () => {
    expect(sameRepository('Acme/Widget', 'acme/widget')).toBe(true);
    expect(sameRepository('acme/widget', 'acme/widgets')).toBe(false);
  });
});
