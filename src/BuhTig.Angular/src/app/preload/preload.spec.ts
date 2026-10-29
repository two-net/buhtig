import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationError, Route, Router, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import {
  IDLE_TIMEOUT_MS,
  LOAD_PAGE,
  NO_IDLE_CALLBACK_MS,
  PreloadWhenIdle,
  reloadForNewRelease,
} from './preload';

describe('PreloadWhenIdle', () => {
  const strategy = new PreloadWhenIdle();
  let idle: { callback: () => void; options?: IdleRequestOptions } | undefined;
  const cancel = vi.fn();

  beforeEach(() => {
    idle = undefined;
    vi.stubGlobal('requestIdleCallback', (callback: () => void, options?: IdleRequestOptions) => {
      idle = { callback, options };
      return 7;
    });
    vi.stubGlobal('cancelIdleCallback', cancel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    cancel.mockReset();
  });

  /** What `preload` emits for `route`, given `load`, and whether it failed. */
  function preload(route: Route, load: () => Observable<unknown>) {
    const emitted: unknown[] = [];
    const errors: unknown[] = [];
    const subscription = strategy.preload(route, load).subscribe({
      next: (value) => emitted.push(value),
      error: (error) => errors.push(error),
    });
    return { emitted, errors, subscription };
  }

  it('leaves a route that does not ask for it to load as it is opened', () => {
    const load = vi.fn(() => of('loaded'));
    const { emitted } = preload({ path: '-/settings' }, load);
    expect(load).not.toHaveBeenCalled();
    expect(idle).toBeUndefined();
    expect(emitted).toEqual([null]);
  });

  it("loads the dashboard's code ahead of need once the browser is idle (NFR-PERF-04)", () => {
    const load = vi.fn(() => of('loaded'));
    const { emitted } = preload({ path: ':org', data: { preload: true } }, load);
    expect(load).not.toHaveBeenCalled();
    expect(idle?.options).toEqual({ timeout: IDLE_TIMEOUT_MS });
    idle!.callback();
    expect(load).toHaveBeenCalledOnce();
    expect(emitted).toEqual(['loaded']);
  });

  it('waits a moment instead where the browser does not tell when it is idle', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers();
    const load = vi.fn(() => of('loaded'));
    preload({ data: { preload: true } }, load);
    vi.advanceTimersByTime(NO_IDLE_CALLBACK_MS - 1);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledOnce();
  });

  it('leaves a route whose code fails to load to load as it is opened', () => {
    const failed = new TypeError('Failed to fetch dynamically imported module');
    const { emitted, errors } = preload({ data: { preload: true } }, () =>
      throwError(() => failed),
    );
    idle!.callback();
    expect(errors).toEqual([]);
    expect(emitted).toEqual([null]);
  });

  it('stops waiting once the router no longer needs it', () => {
    const load = vi.fn(() => of('loaded'));
    const { subscription } = preload({ data: { preload: true } }, load);
    subscription.unsubscribe();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(load).not.toHaveBeenCalled();
  });
});

@Component({ template: '' })
class Page {}

describe('reloadForNewRelease', () => {
  const loadPage = vi.fn();
  const failed = new TypeError(
    'Failed to fetch dynamically imported module: https://buhtig.example.com/chunk-DsnEGg7j.js',
  );

  beforeEach(() => {
    loadPage.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Page }]),
        { provide: LOAD_PAGE, useValue: loadPage },
      ],
    });
  });

  const fail = (error: unknown) =>
    TestBed.runInInjectionContext(() =>
      reloadForNewRelease(new NavigationError(2, '/owner/repo', error)),
    );

  it('loads the page afresh once a new release has replaced the code it came with', async () => {
    await TestBed.inject(Router).navigateByUrl('/');
    fail(failed);
    expect(loadPage).toHaveBeenCalledExactlyOnceWith('/owner/repo');
  });

  it('leaves other failures to the router', async () => {
    await TestBed.inject(Router).navigateByUrl('/');
    fail(new Error('a guard failed'));
    fail(new TypeError('x is not a function'));
    expect(loadPage).not.toHaveBeenCalled();
  });

  it('never loads afresh a page that has opened nothing yet, lest it do so over and over', () => {
    fail(failed);
    expect(loadPage).not.toHaveBeenCalled();
  });
});
