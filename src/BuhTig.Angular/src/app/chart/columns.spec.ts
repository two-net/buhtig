import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Column, ColumnChart } from './columns';

@Component({
  imports: [ColumnChart],
  template: `<app-column-chart
    [columns]="columns()"
    total="6 things in all"
    name="Things per day"
    summary="6 things in all. The busiest day was Tuesday, with 3."
    [headers]="['Day', 'Things']"
  >
    <p class="axis">Mon … Wed</p>
  </app-column-chart>`,
})
class Host {
  readonly columns = signal<Column[]>(
    [
      ['Monday', 1],
      ['Tuesday', 3],
      ['Wednesday', 0],
      ['Thursday', 2],
    ].map(([day, things]) => ({
      value: things as number,
      readout: `${day}: ${things}`,
      label: day as string,
      cell: String(things),
    })),
  );
}

describe('ColumnChart', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const svg = () => element().querySelector('svg')!;
  const caption = () => element().querySelector('.caption')!;
  const bars = () => [...element().querySelectorAll('rect.bar')];
  const columns = () => [...element().querySelectorAll('rect.column')];
  const pointed = () => bars().filter((bar) => bar.classList.contains('pointed'));

  async function press(key: string): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    svg().dispatchEvent(event);
    await fixture.whenStable();
    return event;
  }

  it('draws a bar for each figure but 0, scaled to the largest', () => {
    expect(columns()).toHaveLength(4);
    expect(bars().map((bar) => bar.getAttribute('height'))).toEqual([
      String((1 / 3) * 100),
      '100',
      String((2 / 3) * 100),
    ]);
    expect(caption().textContent?.trim()).toBe('6 things in all');
    expect(element().querySelector('svg + .axis')).not.toBeNull();
  });

  it('is named for assistive technology, which skips the caption (NFR-UX-04)', () => {
    expect(svg().getAttribute('role')).toBe('img');
    expect(svg().getAttribute('aria-label')).toBe('Things per day');
    expect(caption().getAttribute('aria-hidden')).toBe('true');
    expect(element().querySelector('.summary')?.textContent?.trim()).toBe(
      '6 things in all. The busiest day was Tuesday, with 3.',
    );
    expect(
      [...element().querySelectorAll('tbody tr')].map((row) =>
        [...row.children].map((cell) => cell.textContent?.trim()),
      ),
    ).toEqual([
      ['Monday', '1'],
      ['Tuesday', '3'],
      ['Wednesday', '0'],
      ['Thursday', '2'],
    ]);
  });

  it('tells the figure of the column pointed at, and the total again after', async () => {
    columns()[1].dispatchEvent(new Event('pointerenter'));
    await fixture.whenStable();
    expect(caption().textContent?.trim()).toBe('Tuesday: 3');
    expect(pointed()).toEqual([bars()[1]]);

    // One without a bar too.
    columns()[2].dispatchEvent(new Event('pointerenter'));
    await fixture.whenStable();
    expect(caption().textContent?.trim()).toBe('Wednesday: 0');
    expect(pointed()).toEqual([]);

    svg().dispatchEvent(new Event('pointerleave'));
    await fixture.whenStable();
    expect(caption().textContent?.trim()).toBe('6 things in all');
  });

  it('is pointed along by keyboard once it has focus (NFR-UX-03)', async () => {
    expect(svg().getAttribute('tabindex')).toBe('0');
    svg().focus();
    await fixture.whenStable();
    // The latest column first.
    expect(caption().textContent?.trim()).toBe('Thursday: 2');

    expect((await press('ArrowLeft')).defaultPrevented).toBe(true);
    expect(caption().textContent?.trim()).toBe('Wednesday: 0');
    await press('Home');
    expect(caption().textContent?.trim()).toBe('Monday: 1');
    // No further than the first.
    await press('ArrowLeft');
    expect(caption().textContent?.trim()).toBe('Monday: 1');
    await press('ArrowRight');
    expect(caption().textContent?.trim()).toBe('Tuesday: 3');
    await press('End');
    expect(caption().textContent?.trim()).toBe('Thursday: 2');
    await press('ArrowRight');
    expect(caption().textContent?.trim()).toBe('Thursday: 2');

    // Other keys do what they always do.
    expect((await press('Tab')).defaultPrevented).toBe(false);

    svg().blur();
    await fixture.whenStable();
    expect(caption().textContent?.trim()).toBe('6 things in all');
  });

  it('keeps the column pointed at as the chart takes focus from a click', async () => {
    columns()[1].dispatchEvent(new Event('pointerenter'));
    svg().focus();
    await fixture.whenStable();
    expect(caption().textContent?.trim()).toBe('Tuesday: 3');
  });
});
