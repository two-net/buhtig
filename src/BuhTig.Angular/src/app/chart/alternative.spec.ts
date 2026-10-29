import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChartAlternative, Row } from './alternative';

@Component({
  imports: [ChartAlternative],
  template: `<app-chart-alternative
    summary="widget has the most stars, 12,345."
    [headers]="['Repository', 'Stars']"
    [rows]="rows()"
  />`,
})
class Host {
  readonly rows = signal<Row[]>([
    { label: 'widget', value: '12,345' },
    { label: 'gadget', value: '1' },
  ]);
}

describe('ChartAlternative', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const details = () => element().querySelector('details')!;
  const toggle = () => element().querySelector('summary')!;

  async function click(): Promise<void> {
    toggle().click();
    // The browser tells that the table is shown or hidden after it is.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }

  it('says what the chart shows in a sentence, for everyone (NFR-UX-04)', () => {
    const summary = element().querySelector('.summary')!;
    expect(summary.textContent?.trim()).toBe('widget has the most stars, 12,345.');
    expect(summary.getAttribute('aria-hidden')).toBeNull();
    expect(summary.closest('details')).toBeNull();
  });

  it('shows its data as a table on request, and hides it again', async () => {
    expect(details().open).toBe(false);
    expect(toggle().textContent?.trim()).toBe('Show as table');

    await click();
    expect(details().open).toBe(true);
    expect(toggle().textContent?.trim()).toBe('Hide table');

    await click();
    expect(details().open).toBe(false);
    expect(toggle().textContent?.trim()).toBe('Show as table');
  });

  it('heads each column, and each row with what it is of', () => {
    const headers = [...element().querySelectorAll('thead th')];
    expect(
      headers.map((header) => [header.textContent?.trim(), header.getAttribute('scope')]),
    ).toEqual([
      ['Repository', 'col'],
      ['Stars', 'col'],
    ]);
    const rows = [...element().querySelectorAll('tbody tr')];
    expect(
      rows.map((row) => [
        row.querySelector('th')?.textContent?.trim(),
        row.querySelector('th')?.getAttribute('scope'),
        row.querySelector('td')?.textContent?.trim(),
      ]),
    ).toEqual([
      ['widget', 'row', '12,345'],
      ['gadget', 'row', '1'],
    ]);
  });
});
