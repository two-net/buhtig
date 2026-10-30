import { HttpClient, HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { map } from 'rxjs';
import { Computing, Load, Loader, RECHECK_MS, emptyWhen, failureOf, load } from './load';

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
    expect(loader.state()).toEqual({ status: 'error', failure: 'github' });
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
    expect(loader.state()).toEqual({ status: 'error', failure: 'github' });
    vi.advanceTimersByTime(60_000);
    http.expectNone('/activity/acme/widget');
  });

  it('tells why loading failed, as the server says (NFR-UX-06)', () => {
    for (const [status, failure] of [
      [429, 'held'],
      [503, 'unavailable'],
      [502, 'github'],
      [500, 'github'],
      [0, 'github'],
    ] as const) {
      const loader = activity();
      http.expectOne('/activity/acme/widget').flush(null, { status, statusText: 'Failed' });
      expect(loader.state(), String(status)).toEqual({ status: 'error', failure });
    }
  });
});

describe('failureOf (NFR-UX-06)', () => {
  const answered = (status: number) => new HttpErrorResponse({ status, statusText: 'Failed' });

  it('tells that the server asks GitHub for no more for visitors (FR-DATA-10)', () => {
    expect(failureOf(answered(429))).toBe('held');
  });

  it('tells that the server cannot reach its database', () => {
    expect(failureOf(answered(503))).toBe('unavailable');
  });

  it("puts any other failure down to GitHub's", () => {
    for (const status of [0, 400, 404, 500, 502, 504]) {
      expect(failureOf(answered(status)), String(status)).toBe('github');
    }
    for (const error of [new Computing(), new Error('odd'), 'odd', undefined]) {
      expect(failureOf(error), String(error)).toBe('github');
    }
  });
});

describe('emptyWhen', () => {
  /** A loader whose state the test sets, and which counts its retries. */
  function source() {
    const state = signal<Load<number[]>>({ status: 'loading' });
    const retry = vi.fn();
    return { state, retry, loader: { state: state.asReadonly(), retry } };
  }

  it('shows data that holds nothing for the widget as empty', () => {
    const { state, loader } = source();
    const shown = emptyWhen(loader, (data) => data.every((value) => value === 0));
    state.set({ status: 'ready', data: [0, 0] });
    expect(shown.state()).toEqual({ status: 'empty' });
    state.set({ status: 'ready', data: [0, 3] });
    expect(shown.state()).toEqual({ status: 'ready', data: [0, 3] });
  });

  it('leaves every other state be', () => {
    const { state, loader } = source();
    const shown = emptyWhen(loader, () => true);
    for (const other of [
      { status: 'loading' },
      { status: 'computing' },
      { status: 'empty' },
      { status: 'error', failure: 'held' },
    ] as Load<number[]>[]) {
      state.set(other);
      expect(shown.state()).toEqual(other);
    }
  });

  it('tries again by the loader it wraps', () => {
    const { retry, loader } = source();
    emptyWhen(loader, () => false).retry();
    expect(retry).toHaveBeenCalledOnce();
  });
});
