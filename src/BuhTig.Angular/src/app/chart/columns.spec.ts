import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Tip } from '../tip/tip';
import { Column, ColumnChart, Tick, niceMax } from './columns';
import { READ_WITH_KEYS } from './messages';

@Component({
  imports: [ColumnChart],
  template: `<app-column-chart
    [columns]="columns()"
    [ticks]="ticks()"
    [unit]="unit()"
    [caps]="caps()"
    summary="5,042 commits in 4 weeks. The busiest was the week of Oct 12, with 4,200."
  />`,
})
class Host {
  readonly columns = signal<Column[]>(
    [
      ['Oct 5', 1_234],
      ['Oct 12', 4_200],
      ['Oct 19', 0],
      ['Oct 26', 8],
    ].map(([week, value]) => ({ value: value as number, label: `Week of ${week}, 2026` })),
  );
  readonly ticks = signal<Tick[]>([
    { at: 0, label: 'Oct', minor: false },
    { at: 3, label: 'Nov', minor: true },
  ]);
  readonly unit = signal('commits');
  readonly caps = signal(false);
}

describe('niceMax', () => {
  it('rounds the tallest figure up to 1, 2, 2.5 or 5 of its power of ten, or the next', () => {
    expect([1, 2, 3, 7, 10, 42, 100, 101, 230, 4_200, 12_345].map(niceMax)).toEqual([
      1, 2, 5, 10, 10, 50, 100, 200, 250, 5_000, 20_000,
    ]);
  });

  it('gives a chart of nothing a top all the same', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-3)).toBe(1);
  });
});

describe('ColumnChart', () => {
  let fixture: ComponentFixture<Host>;
  let tip: Tip;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    tip = TestBed.inject(Tip);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const plot = () => element().querySelector<HTMLElement>('.plot')!;
  const columns = () => [...element().querySelectorAll<HTMLElement>('.col')];
  const active = () => columns().findIndex((column) => column.classList.contains('active'));
  const heights = () => columns().map((column) => column.style.getPropertyValue('--h'));
  const gridlines = () =>
    [...element().querySelectorAll<HTMLElement>('.gl')].map((line) => [
      line.textContent?.trim(),
      line.style.bottom,
      line.classList.contains('base'),
    ]);

  async function set(change: (host: Host) => void): Promise<void> {
    change(fixture.componentInstance);
    await fixture.whenStable();
  }

  async function press(key: string): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    plot().dispatchEvent(event);
    await fixture.whenStable();
    return event;
  }

  /** What the tooltip says, if it shows. */
  const told = () => {
    const shown = tip.shown();
    return shown && `${shown.value} · ${shown.label}`;
  };

  it('draws a column for each figure, as high against the top gridline as it is', () => {
    // The top is 5,000, a round figure above the tallest.
    expect(heights()).toEqual(['24.68%', '84.00%', '0.00%', '0.16%']);
  });

  it('draws gridlines at nothing, halfway and the top, with their figures in short', () => {
    expect(gridlines()).toEqual([
      ['0', '0%', true],
      ['2.5K', '50%', false],
      ['5K', '100%', false],
    ]);
  });

  it('leaves out a halfway gridline that would not be a whole figure', async () => {
    await set((host) => host.columns.set([{ value: 1, label: 'Week of Oct 5, 2026' }]));
    expect(gridlines()).toEqual([
      ['0', '0%', true],
      ['1', '100%', false],
    ]);
  });

  it('draws a chart of nothing flat, against a top of 1', async () => {
    await set((host) => host.columns.update((columns) => columns.map((c) => ({ ...c, value: 0 }))));
    expect(heights()).toEqual(['0.00%', '0.00%', '0.00%', '0.00%']);
    expect(gridlines().map(([label]) => label)).toEqual(['0', '1']);
  });

  it('labels its axis under the columns it marks, months but each quarter left out when narrow', () => {
    const ticks = [...element().querySelectorAll<HTMLElement>('.xaxis span')];
    expect(
      ticks.map((tick) => [
        tick.textContent?.trim(),
        tick.style.left,
        tick.classList.contains('minor'),
      ]),
    ).toEqual([
      ['Oct', '12.5%', false],
      ['Nov', '87.5%', true],
    ]);
  });

  it('shows each figure above its column on request, but none above nothing', async () => {
    expect(element().querySelector('.col b')).toBeNull();
    expect(plot().classList).not.toContain('capped');
    await set((host) => host.caps.set(true));
    expect(plot().classList).toContain('capped');
    expect(columns().map((column) => column.querySelector('b')?.textContent ?? null)).toEqual([
      '1.2K',
      '4.2K',
      null,
      '8',
    ]);
  });

  it('is an image for assistive technology, which reads its summary and how to read it (NFR-UX-04)', () => {
    expect(plot().getAttribute('role')).toBe('img');
    expect(plot().getAttribute('aria-label')).toBe(
      `5,042 commits in 4 weeks. The busiest was the week of Oct 12, with 4,200. ${READ_WITH_KEYS}`,
    );
    for (const part of element().querySelectorAll('.plot > div, .xaxis')) {
      expect(part.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('tells the figure of the column pointed at in full, by the pointer (FR-ANIM-06)', async () => {
    columns()[1].dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 90 }));
    await fixture.whenStable();
    expect(active()).toBe(1);
    expect(told()).toBe('4,200 commits · Week of Oct 12, 2026');
    expect(tip.shown()?.color).toBe('var(--s1)');
    expect(tip.shown()?.point).toEqual({ x: 40, y: 90 });
    expect(plot().classList).not.toContain('kbd');

    element().querySelector('.bars')!.dispatchEvent(new MouseEvent('pointerleave'));
    await fixture.whenStable();
    expect(active()).toBe(-1);
    expect(tip.shown()).toBeUndefined();
  });

  it('tells a figure without a unit as it is', async () => {
    await set((host) => host.unit.set(''));
    columns()[0].dispatchEvent(new MouseEvent('pointermove'));
    expect(told()).toBe('1,234 · Week of Oct 5, 2026');
  });

  it('is read along by keyboard once it has focus (NFR-UX-03)', async () => {
    expect(plot().getAttribute('tabindex')).toBe('0');
    // The first column first.
    expect((await press('ArrowRight')).defaultPrevented).toBe(true);
    expect([active(), told()]).toEqual([0, '1,234 commits · Week of Oct 5, 2026']);
    expect(plot().classList).toContain('kbd');
    // Above the column, rather than by a pointer.
    expect(tip.shown()?.point).toBeUndefined();

    await press('ArrowRight');
    expect(active()).toBe(1);
    await press('End');
    expect(told()).toBe('8 commits · Week of Oct 26, 2026');
    // No further than the last.
    await press('ArrowRight');
    expect(active()).toBe(3);
    await press('ArrowLeft');
    expect(told()).toBe('0 commits · Week of Oct 19, 2026');
    await press('Home');
    expect(active()).toBe(0);
    // No further than the first.
    await press('ArrowLeft');
    expect(active()).toBe(0);

    // Other keys do what they always do.
    expect((await press('Tab')).defaultPrevented).toBe(false);
    expect(active()).toBe(0);
  });

  it('starts from the last column with ←', async () => {
    await press('ArrowLeft');
    expect(active()).toBe(3);
  });

  it('stops on Esc, and as it loses focus', async () => {
    await press('End');
    await press('Escape');
    expect(active()).toBe(-1);
    expect(tip.shown()).toBeUndefined();
    expect(plot().classList).not.toContain('kbd');

    await press('Home');
    plot().dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();
    expect(active()).toBe(-1);
    expect(tip.shown()).toBeUndefined();
  });

  it('gives the pointer the say over the keyboard', async () => {
    await press('Home');
    columns()[2].dispatchEvent(new MouseEvent('pointermove'));
    await fixture.whenStable();
    expect(active()).toBe(2);
    expect(plot().classList).not.toContain('kbd');
  });

  it('grows its columns one after another as the widget makes its entrance (FR-ANIM-06)', () => {
    expect(columns().map((column) => column.style.getPropertyValue('--i'))).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
  });
});
