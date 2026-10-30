import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DataTable } from './table';

describe('DataTable (NFR-UX-04)', () => {
  let fixture: ComponentFixture<DataTable>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(DataTable);
    fixture.componentRef.setInput('table', {
      headers: ['Repository', 'Stars'],
      rows: [
        { label: 'widget', value: '12,345' },
        { label: 'gadget', value: '1' },
      ],
    });
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;

  it('heads each column', () => {
    const headers = [...element().querySelectorAll('thead th')];
    expect(
      headers.map((header) => [
        header.textContent?.trim(),
        header.getAttribute('scope'),
        header.classList.contains('num'),
      ]),
    ).toEqual([
      ['Repository', 'col', false],
      ['Stars', 'col', true],
    ]);
  });

  it('heads each row with what it is of, beside its figure in full', () => {
    const rows = [...element().querySelectorAll('tbody tr')];
    expect(
      rows.map((row) => [
        row.querySelector('th')?.textContent?.trim(),
        row.querySelector('th')?.getAttribute('scope'),
        row.querySelector('td')?.textContent?.trim(),
        row.querySelector('td')?.classList.contains('num'),
      ]),
    ).toEqual([
      ['widget', 'row', '12,345', true],
      ['gadget', 'row', '1', true],
    ]);
  });

  it('follows its data', async () => {
    fixture.componentRef.setInput('table', { headers: ['Language', 'Bytes'], rows: [] });
    await fixture.whenStable();
    expect(element().querySelector('thead th')?.textContent?.trim()).toBe('Language');
    expect(element().querySelectorAll('tbody tr')).toHaveLength(0);
  });
});
