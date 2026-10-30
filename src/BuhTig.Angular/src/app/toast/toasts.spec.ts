import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Icon } from '../icon/icon';
import { TOAST_MS, ToastHost, Toasts } from './toasts';

describe('Toasts (NFR-UX-02)', () => {
  let fixture: ComponentFixture<ToastHost>;
  let toasts: Toasts;

  beforeEach(() => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(ToastHost);
    toasts = TestBed.inject(Toasts);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const shown = () =>
    [...element().querySelectorAll('.toast')].map((toast) => [
      toast.textContent?.trim(),
      toast.classList.contains('leaving'),
    ]);
  const icons = () =>
    fixture.debugElement
      .queryAll(By.directive(Icon))
      .map((icon) => (icon.componentInstance as Icon).name());

  /** Lets `ms` go by. */
  function wait(ms: number): void {
    vi.advanceTimersByTime(ms);
    fixture.detectChanges();
  }

  it('shows each in a place that assistive technology announces', () => {
    const live = element().querySelector('.toasts')!;
    expect(live.getAttribute('role')).toBe('status');
    expect(live.children).toHaveLength(0);
    toasts.show('Pinned acme/rocket');
    fixture.detectChanges();
    expect(shown()).toEqual([['Pinned acme/rocket', false]]);
    expect(live.children).toHaveLength(1);
  });

  it('shows a check unless told of another icon', () => {
    toasts.show('Pinned acme/rocket');
    toasts.show('Your sign-in has ended.', 'logout');
    fixture.detectChanges();
    expect(icons()).toEqual(['check', 'logout']);
  });

  it('goes on its own, fading away for a moment first', () => {
    toasts.show('Pinned acme/rocket');
    fixture.detectChanges();
    wait(TOAST_MS - 1);
    expect(shown()).toEqual([['Pinned acme/rocket', false]]);
    wait(1);
    expect(shown()).toEqual([['Pinned acme/rocket', true]]);
    wait(249);
    expect(shown()).toEqual([['Pinned acme/rocket', true]]);
    wait(1);
    expect(shown()).toEqual([]);
    expect(toasts.toasts()).toEqual([]);
  });

  it('shows several at once, each going in its own time', () => {
    toasts.show('Pinned acme/rocket');
    wait(1_000);
    toasts.show('Refreshed acme/rocket');
    fixture.detectChanges();
    expect(shown().map(([message]) => message)).toEqual([
      'Pinned acme/rocket',
      'Refreshed acme/rocket',
    ]);
    wait(TOAST_MS - 1_000 + 250);
    expect(shown()).toEqual([['Refreshed acme/rocket', false]]);
    wait(1_000);
    expect(shown()).toEqual([]);
  });

  it('shows the same message again as a toast of its own', () => {
    toasts.show('Refreshed');
    toasts.show('Refreshed');
    fixture.detectChanges();
    expect(shown()).toHaveLength(2);
    expect(new Set(toasts.toasts().map((toast) => toast.id)).size).toBe(2);
  });
});
