import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clock } from './clock';
import { exactTime, relativeTime } from './format';
import { RelativeTime } from './relative-time';

describe('RelativeTime', () => {
  const time = new Date('2026-10-22T12:00:00.000Z');
  const now = signal(new Date('2026-10-22T12:04:30Z').getTime());
  let fixture: ComponentFixture<RelativeTime>;
  let element: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [{ provide: Clock, useValue: { now } }] });
    fixture = TestBed.createComponent(RelativeTime);
    fixture.componentRef.setInput('value', time);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  const shown = () => element.querySelector('app-exact')!.firstChild?.textContent?.trim();

  it('tells the time relative to now, with the exact time on hover and focus (UI-06)', () => {
    const exact = element.querySelector('time > app-exact')!;
    const tooltip = exact.querySelector('[role="tooltip"]')!;
    expect(element.querySelector('time')!.getAttribute('datetime')).toBe(
      '2026-10-22T12:00:00.000Z',
    );
    expect(shown()).toBe(relativeTime(time, now()));
    expect(tooltip.textContent).toBe(exactTime(time));
    expect(exact.getAttribute('tabindex')).toBe('0');
    expect(exact.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('moves on with the clock', async () => {
    const before = shown();
    now.set(new Date('2026-10-22T15:00:00Z').getTime());
    await fixture.whenStable();
    expect(shown()).toBe(relativeTime(time, now()));
    expect(shown()).not.toBe(before);
  });
});

describe('Clock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks, and stops once the app is gone', () => {
    vi.useFakeTimers({ now: new Date('2026-10-22T12:00:00Z') });
    const clock = TestBed.inject(Clock);
    const start = clock.now();
    vi.advanceTimersByTime(15_000);
    expect(clock.now()).toBe(start + 15_000);
    TestBed.resetTestingModule();
    expect(vi.getTimerCount()).toBe(0);
  });
});
