import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { map } from 'rxjs';
import { Computing, Loader, RECHECK_MS, load } from './load';

describe('load', () => {
  const repo = signal('acme/widget');
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    repo.set('acme/widget');
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  /**
   * Loads the commit activity of `repo`, which the server answers with 202 while GitHub is
   * still computing it, as BuhTig's does.
   */
  function activity(): Loader<number[]> {
    const client = TestBed.inject(HttpClient);
    const loader = TestBed.runInInjectionContext(() =>
      load(() =>
        client.get<number[]>(`/activity/${repo()}`, { observe: 'response' }).pipe(
          map((response) => {
            if (response.status === 202) {
              throw new Computing();
            }
            return response.body!;
          }),
        ),
      ),
    );
    TestBed.tick();
    return loader;
  }

  /** Answers the request for the commit activity of `repo` with "still computing". */
  function computing(repo = 'acme/widget'): void {
    http.expectOne(`/activity/${repo}`).flush(null, { status: 202, statusText: 'Accepted' });
  }

  it('waits a minute in all for GitHub, longer each time (FR-REPO-10)', () => {
    expect(RECHECK_MS.reduce((all, wait) => all + wait)).toBe(60_000);
    for (const [index, wait] of RECHECK_MS.slice(1).entries()) {
      expect(wait).toBeGreaterThan(RECHECK_MS[index]);
    }
  });

  it('asks again while GitHub is still computing the data, until it has it (FR-REPO-10)', () => {
    const loader = activity();
    expect(loader.state()).toEqual({ status: 'loading' });
    computing();
    expect(loader.state()).toEqual({ status: 'computing' });
    for (const wait of RECHECK_MS.slice(0, 3)) {
      vi.advanceTimersByTime(wait - 1);
      http.expectNone('/activity/acme/widget');
      vi.advanceTimersByTime(1);
      computing();
      expect(loader.state()).toEqual({ status: 'computing' });
    }
    vi.advanceTimersByTime(RECHECK_MS[3]);
    http.expectOne('/activity/acme/widget').flush([1, 2]);
    expect(loader.state()).toEqual({ status: 'ready', data: [1, 2] });
  });

  it('fails once GitHub has taken a minute, and starts over on "Try again" (FR-REPO-10)', () => {
    const loader = activity();
    computing();
    for (const wait of RECHECK_MS) {
      vi.advanceTimersByTime(wait);
      computing();
    }
    expect(loader.state()).toEqual({ status: 'error' });
    vi.advanceTimersByTime(60_000);
    http.expectNone('/activity/acme/widget');

    loader.retry();
    TestBed.tick();
    expect(loader.state()).toEqual({ status: 'loading' });
    computing();
    expect(loader.state()).toEqual({ status: 'computing' });
    vi.advanceTimersByTime(RECHECK_MS[0]);
    http.expectOne('/activity/acme/widget').flush([3]);
    expect(loader.state()).toEqual({ status: 'ready', data: [3] });
  });

  it('stops asking about a repository the dashboard has moved from', () => {
    const loader = activity();
    computing();
    repo.set('acme/gadget');
    TestBed.tick();
    http.expectOne('/activity/acme/gadget').flush([5]);
    vi.advanceTimersByTime(60_000);
    http.expectNone('/activity/acme/widget');
    expect(loader.state()).toEqual({ status: 'ready', data: [5] });
  });

  it('asks only once when loading fails otherwise (FR-REPO-09)', () => {
    const loader = activity();
    http.expectOne('/activity/acme/widget').flush(null, { status: 502, statusText: 'Bad Gateway' });
    expect(loader.state()).toEqual({ status: 'error' });
    vi.advanceTimersByTime(60_000);
    http.expectNone('/activity/acme/widget');
  });
});
