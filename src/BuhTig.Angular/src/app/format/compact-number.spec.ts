import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Entrance } from '../motion/entrance';
import { CompactNumber } from './compact-number';
import { compactNumber, exactNumber } from './format';

describe('CompactNumber', () => {
  let fixture: ComponentFixture<CompactNumber>;

  async function show(value: number): Promise<HTMLElement> {
    fixture = TestBed.createComponent(CompactNumber);
    fixture.componentRef.setInput('value', value);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a large number in short, with the exact number on hover and focus (UI-06)', async () => {
    const element = await show(12_345);
    const exact = element.querySelector('app-exact')!;
    const tooltip = exact.querySelector('[role="tooltip"]')!;
    expect(exact.firstChild?.textContent?.trim()).toBe(compactNumber(12_345));
    expect(tooltip.textContent).toBe(exactNumber(12_345));
    expect(exact.getAttribute('tabindex')).toBe('0');
    expect(exact.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('shows a short number as it is, without taking the focus', async () => {
    const element = await show(42);
    expect(element.textContent?.trim()).toBe('42');
    expect(element.querySelector('app-exact, [tabindex]')).toBeNull();
  });

  it('follows its value', async () => {
    const element = await show(42);
    fixture.componentRef.setInput('value', 1_234_567);
    await fixture.whenStable();
    expect(element.querySelector('[role="tooltip"]')?.textContent).toBe(exactNumber(1_234_567));
  });
});

describe('CompactNumber counting up (FR-ANIM-05)', () => {
  let fixture: ComponentFixture<CompactNumber>;
  let entrance: Entrance;
  /** The frames asked for, which `frame` draws. */
  let frames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    entrance = new Entrance();
    frames = new Map();
    let next = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++next, callback);
      return next;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Shows `value`, in a widget that makes its entrance as `entrance` says, if in one. */
  async function show(value: number, countUp: boolean, inWidget = true): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      providers: inWidget ? [{ provide: Entrance, useValue: entrance }] : [],
    });
    fixture = TestBed.createComponent(CompactNumber);
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('countUp', countUp);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /** Draws the frames asked for, at `time`. */
  async function frame(time: number): Promise<void> {
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) {
      callback(time);
    }
    await fixture.whenStable();
  }

  it('counts up to its value as the widget makes its entrance, which only it shows', async () => {
    const element = await show(12_345, true);
    const count = () => element.querySelector('.count');
    const value = () => element.querySelector('app-exact')!.firstChild?.textContent?.trim();
    expect(count()).toBeNull();

    entrance.playing.set(true);
    await fixture.whenStable();
    expect(count()?.textContent).toBe(compactNumber(0));
    // Assistive technology reads the value alone, which keeps its room under the count.
    expect(count()?.getAttribute('aria-hidden')).toBe('true');
    expect(value()).toBe(compactNumber(12_345));

    await frame(1_000);
    await frame(1_450);
    // Most of the way there halfway through, as it slows towards the value.
    expect(count()?.textContent).toBe(compactNumber(Math.round(12_345 * 0.875)));
    expect(value()).toBe(compactNumber(12_345));

    await frame(1_900);
    expect(count()).toBeNull();
    expect(value()).toBe(compactNumber(12_345));
    expect(frames.size).toBe(0);
  });

  it('stops counting as the entrance ends', async () => {
    const element = await show(12_345, true);
    entrance.playing.set(true);
    await fixture.whenStable();
    await frame(1_000);
    entrance.playing.set(false);
    await fixture.whenStable();
    expect(element.querySelector('.count')).toBeNull();
    expect(frames.size).toBe(0);
  });

  it('counts a short number up too', async () => {
    const element = await show(42, true);
    entrance.playing.set(true);
    await fixture.whenStable();
    await frame(1_000);
    await frame(1_450);
    expect(element.querySelector('.count')?.textContent).toBe('37');
    expect(element.textContent).toContain('42');
  });

  it('shows its value at once unless it is to count up, in a widget', async () => {
    entrance.playing.set(true);
    let element = await show(12_345, false);
    expect(element.querySelector('.count')).toBeNull();
    expect(frames.size).toBe(0);

    TestBed.resetTestingModule();
    element = await show(12_345, true, false);
    expect(element.querySelector('.count')).toBeNull();
    expect(frames.size).toBe(0);
  });
});
