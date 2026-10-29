import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { compactNumber, exactNumber } from '../format/format';
import { Bar, OrganizationBars } from './bars';

@Component({
  imports: [OrganizationBars],
  template: `<app-organization-bars
    [bars]="bars()"
    [unit]="unit"
    summary="widget has the most things."
    [headers]="['Thing', 'Count']"
  />`,
})
class Host {
  readonly bars = signal<Bar[]>([]);
  readonly unit = (count: number) => (count === 1 ? 'thing' : 'things');
}

describe('OrganizationBars', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(Host);
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...element().querySelectorAll('li')];
  /** How long each bar is, unless it has none. */
  const lengths = () => rows().map((row) => row.querySelector<HTMLElement>('.bar')?.style.width);

  /** The text that `element` shows, without the tooltips that hover and focus show. */
  function shown(element: Element): string | undefined {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="tooltip"]').forEach((tooltip) => tooltip.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  }

  async function show(bars: Bar[]): Promise<void> {
    fixture.componentInstance.bars.set(bars);
    await fixture.whenStable();
  }

  it('draws each bar as long against the longest as its figure is', async () => {
    await show([
      { label: 'a', value: 200 },
      { label: 'b', value: 50 },
      { label: 'c', value: 0 },
    ]);
    // Nothing is drawn for 0.
    expect(lengths()).toEqual(['100%', '25%', undefined]);
  });

  it('says what each bar is of, and its figure in short, exact on hover (UI-06)', async () => {
    await show([
      { label: 'widget', value: 12_345 },
      { label: 'gadget', value: 1 },
    ]);
    expect(
      rows().map((row) => [
        row.querySelector('.label')?.textContent?.trim(),
        shown(row.querySelector('.value')!),
      ]),
    ).toEqual([
      ['widget', `${compactNumber(12_345)} things`],
      ['gadget', '1 thing'],
    ]);
    expect(rows()[0].querySelector('[role="tooltip"]')?.textContent).toBe(exactNumber(12_345));
  });

  it('leaves the bars to the words, for assistive technology (NFR-UX-04)', async () => {
    await show([{ label: 'widget', value: 3 }]);
    expect(element().querySelector('ol')).not.toBeNull();
    expect(element().querySelector('.track')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('says what it shows in a sentence, and its figures in full in a table (NFR-UX-04)', async () => {
    await show([
      { label: 'widget', value: 12_345 },
      { label: 'gadget', value: 1 },
    ]);
    expect(element().querySelector('.summary')?.textContent?.trim()).toBe(
      'widget has the most things.',
    );
    const cells = [...element().querySelectorAll('table tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent?.trim()),
    );
    expect(cells).toEqual([
      ['Thing', 'Count'],
      ['widget', exactNumber(12_345)],
      ['gadget', '1'],
    ]);
  });

  it("opens a bar's dashboard from its label, if it has one", async () => {
    await show([
      { label: 'widget', value: 3, path: '/acme/widget' },
      { label: 'Other', value: 1 },
    ]);
    expect(rows()[0].querySelector('a.label')?.getAttribute('href')).toBe('/acme/widget');
    expect(rows()[1].querySelector('a')).toBeNull();
  });
});
