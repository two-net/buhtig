import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import { Personal, PinsAndHistory } from './personal';
import { Shortcut } from './pick';

describe('Personal', () => {
  let http: HttpTestingController;
  let personal: Personal;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    personal = TestBed.inject(Personal);
  });

  afterEach(() => {
    http.verify();
  });

  const WIDGET: Shortcut = { kind: 'repository', name: 'acme/widget' };
  const ACME: Shortcut = { kind: 'organization', name: 'acme' };

  /** What `answer` comes to: what it gives, or what it fails with. */
  function outcome<T>(answer: Observable<T>): { value?: T; error?: unknown; done: boolean } {
    const seen: { value?: T; error?: unknown; done: boolean } = { done: false };
    answer.subscribe({
      next: (value) => (seen.value = value),
      error: (error: unknown) => (seen.error = error),
      complete: () => (seen.done = true),
    });
    return seen;
  }

  it("lists the user's pins and the dashboards they viewed", () => {
    const answer: PinsAndHistory = {
      pins: [ACME],
      recent: [{ ...WIDGET, viewed_at: '2026-10-22T12:00:00Z' }],
    };
    const seen = outcome(personal.list());
    http.expectOne({ method: 'GET', url: '/-/api/shortcuts' }).flush(answer);
    expect(seen.value).toEqual(answer);
  });

  it('records a view of a repository or an organization under its own URL (FR-PERS-01)', () => {
    const repository = outcome(personal.record(WIDGET));
    http
      .expectOne({ method: 'POST', url: '/-/api/repositories/acme/widget/view' })
      .flush(null, { status: 204, statusText: 'No Content' });
    expect(repository.done).toBe(true);

    outcome(personal.record(ACME));
    http
      .expectOne({ method: 'POST', url: '/-/api/organizations/acme/view' })
      .flush(null, { status: 204, statusText: 'No Content' });
  });

  it('never fails to record a view, since the dashboard is the same either way', () => {
    const seen = outcome(personal.record(WIDGET));
    http
      .expectOne('/-/api/repositories/acme/widget/view')
      .flush(null, { status: 503, statusText: 'Unavailable' });
    expect(seen.error).toBeUndefined();
    expect(seen.done).toBe(true);
  });

  it('clears the history (FR-PERS-03)', () => {
    const seen = outcome(personal.clearHistory());
    http
      .expectOne({ method: 'DELETE', url: '/-/api/history' })
      .flush(null, { status: 204, statusText: 'No Content' });
    expect(seen.done).toBe(true);
  });

  it('pins and unpins a dashboard, and answers the pins (FR-PERS-02)', () => {
    const pinned = outcome(personal.pin(WIDGET));
    const pin = http.expectOne({ method: 'PUT', url: '/-/api/repositories/acme/widget/pin' });
    expect(pin.request.body).toBeNull();
    pin.flush({ pins: [ACME, WIDGET] });
    expect(pinned.value).toEqual([ACME, WIDGET]);

    const unpinned = outcome(personal.unpin(ACME));
    http
      .expectOne({ method: 'DELETE', url: '/-/api/organizations/acme/pin' })
      .flush({ pins: [WIDGET] });
    expect(unpinned.value).toEqual([WIDGET]);
  });

  it('puts the pins in the order given (FR-PERS-05)', () => {
    const seen = outcome(personal.reorder([WIDGET, ACME]));
    const request = http.expectOne({ method: 'PUT', url: '/-/api/pins' });
    expect(request.request.body).toEqual({ pins: [WIDGET, ACME] });
    request.flush({ pins: [WIDGET, ACME] });
    expect(seen.value).toEqual([WIDGET, ACME]);
  });

  it('says when the user has pinned as many as they may, or why else it did not pin', () => {
    const tooMany = outcome(personal.pin(WIDGET));
    http
      .expectOne('/-/api/repositories/acme/widget/pin')
      .flush({ error: 'too_many' }, { status: 409, statusText: 'Conflict' });
    expect(tooMany.error).toBe('too_many');

    const failed = outcome(personal.unpin(WIDGET));
    http
      .expectOne('/-/api/repositories/acme/widget/pin')
      .flush(null, { status: 503, statusText: 'Unavailable' });
    expect(failed.error).toBe('failed');

    const reordered = outcome(personal.reorder([WIDGET]));
    http.expectOne('/-/api/pins').flush(null, { status: 500, statusText: 'Error' });
    expect(reordered.error).toBe('failed');
  });
});
