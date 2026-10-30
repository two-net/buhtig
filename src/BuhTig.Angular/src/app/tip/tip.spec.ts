import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Tip, TipHost } from './tip';

describe('Tip (FR-ANIM-06)', () => {
  let tip: Tip;

  beforeEach(() => {
    tip = TestBed.inject(Tip);
  });

  /** A mark of a chart, laid out at `rect`. */
  function mark(rect: DOMRect): HTMLElement {
    const element = document.createElement('i');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect);
    return element;
  }

  it('shows what it is told of the mark it is at, by the pointer', () => {
    const at = new DOMRect(200, 300, 20, 50);
    tip.show(mark(at), { value: '1,234 commits', label: 'Week of Oct 26, 2025' }, {
      clientX: 210,
      clientY: 320,
    } as PointerEvent);
    expect(tip.shown()).toEqual({
      value: '1,234 commits',
      label: 'Week of Oct 26, 2025',
      anchor: at,
      point: { x: 210, y: 320 },
    });
  });

  it('shows above the mark, without a pointer, as from the keyboard', () => {
    tip.show(mark(new DOMRect(200, 300, 20, 50)), { value: '8', label: 'CSS', color: '#663399' });
    expect(tip.shown()?.point).toBeUndefined();
    expect(tip.shown()?.color).toBe('#663399');
  });

  it('hides', () => {
    tip.show(mark(new DOMRect()), { value: '8', label: 'CSS' });
    tip.hide();
    expect(tip.shown()).toBeUndefined();
  });
});

describe('TipHost', () => {
  let fixture: ComponentFixture<TipHost>;
  let tip: Tip;

  beforeEach(async () => {
    // jsdom lays nothing out: here the tooltip is 100 by 40 pixels, in a window 1,024 wide.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    fixture = TestBed.createComponent(TipHost);
    tip = TestBed.inject(Tip);
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const element = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.tip')!;
  const place = () => [element().style.left, element().style.top];

  /** Shows the tooltip at a mark laid out at `rect`, by the pointer at `point` if any. */
  async function show(
    rect: DOMRect,
    point?: { x: number; y: number },
    color?: string,
  ): Promise<void> {
    const mark = document.createElement('i');
    vi.spyOn(mark, 'getBoundingClientRect').mockReturnValue(rect);
    tip.show(
      mark,
      { value: '1,234 commits', label: 'Week of Oct 26, 2025', color },
      point && ({ clientX: point.x, clientY: point.y } as PointerEvent),
    );
    await fixture.whenStable();
  }

  it('is for the eye alone, as charts have their summaries and tables (NFR-UX-04)', () => {
    expect(element().getAttribute('aria-hidden')).toBe('true');
    expect(element().classList).not.toContain('on');
    expect(element().textContent?.trim()).toBe('');
  });

  it('tells the figure in full and what it is of, keyed to the color of the mark', async () => {
    await show(new DOMRect(200, 300, 20, 50), undefined, '#663399');
    expect(element().classList).toContain('on');
    expect(element().querySelector('strong')?.textContent).toBe('1,234 commits');
    expect(element().querySelector('span')?.textContent?.trim()).toBe('Week of Oct 26, 2025');
    expect(element().querySelector<HTMLElement>('.k')?.style.background).toBe('rgb(102, 51, 153)');
  });

  it('has no key for a mark without a color of its own', async () => {
    await show(new DOMRect(200, 300, 20, 50));
    expect(element().querySelector('.k')).toBeNull();
  });

  it('shows above the middle of the mark', async () => {
    await show(new DOMRect(200, 300, 20, 50));
    expect(place()).toEqual(['160px', '248px']);
  });

  it('shows above the pointer, as it points at the mark', async () => {
    await show(new DOMRect(200, 300, 20, 50), { x: 500, y: 320 });
    expect(place()).toEqual(['450px', '268px']);
  });

  it('shows below where there is no room above', async () => {
    await show(new DOMRect(200, 20, 20, 50));
    expect(place()).toEqual(['160px', '84px']);
    await show(new DOMRect(200, 20, 20, 50), { x: 210, y: 30 });
    expect(place()).toEqual(['160px', '44px']);
  });

  it('stays within the window', async () => {
    await show(new DOMRect(0, 300, 10, 50));
    expect(place()[0]).toBe('8px');
    await show(new DOMRect(1_020, 300, 4, 50));
    expect(place()[0]).toBe(`${innerWidth - 100 - 8}px`);
  });

  it('goes as the page scrolls', async () => {
    await show(new DOMRect(200, 300, 20, 50));
    window.dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    expect(tip.shown()).toBeUndefined();
    expect(element().classList).not.toContain('on');
  });
});
