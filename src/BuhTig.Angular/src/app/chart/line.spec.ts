import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LineChart } from './line';

describe('LineChart', () => {
  let fixture: ComponentFixture<LineChart>;

  async function draw(values: (number | null)[]): Promise<HTMLElement> {
    fixture = TestBed.createComponent(LineChart);
    fixture.componentRef.setInput('values', values);
    fixture.componentRef.setInput('summary', 'Stars, from 100 to 112.');
    fixture.componentRef.setInput('first', 'Nov 2, 2026');
    fixture.componentRef.setInput('last', 'Nov 9, 2026');
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const chart = () => fixture.componentInstance;
  const lines = (element: HTMLElement) =>
    [...element.querySelectorAll('path.line')].map((path) => path.getAttribute('d'));
  const dots = (element: HTMLElement) => element.querySelectorAll('path.pt').length;
  const labels = (element: HTMLElement) =>
    [...element.querySelectorAll('.yl span')].map((label) => label.textContent);

  it('is an image to assistive technology, which reads its summary (NFR-UX-04)', async () => {
    const element = await draw([1, 2]);
    const plot = element.querySelector('.plot')!;
    expect(plot.getAttribute('role')).toBe('img');
    expect(plot.getAttribute('aria-label')).toBe('Stars, from 100 to 112.');
    expect(element.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect([...element.querySelectorAll('.xaxis span')].map((day) => day.textContent)).toEqual([
      'Nov 2, 2026',
      'Nov 9, 2026',
    ]);
  });

  it('runs its scale from the lowest figure to the highest, not from zero', async () => {
    const element = await draw([100, 106, 112]);
    expect(labels(element)).toEqual(['112', '100']);
    expect(
      chart()
        .points()
        .map(({ y }) => y),
    ).toEqual([92, 50, 8]);
    expect(lines(element)).toEqual(['M0.00 92.00L50.00 50.00L100.00 8.00']);
  });

  it('breaks its line over days without a figure, and marks them, never as zero (FR-REPO-17)', async () => {
    const element = await draw([100, 104, null, null, 110, null, 112]);
    // Two days with a figure, then two without, then one alone, then one more after a gap.
    expect(lines(element)).toEqual(['M0.00 92.00L16.67 64.00']);
    expect(dots(element)).toBe(4);
    expect(chart().gaps()).toEqual([
      { from: expect.closeTo(25, 2), to: expect.closeTo(58.33, 2) },
      { from: expect.closeTo(75, 2), to: expect.closeTo(91.67, 2) },
    ]);
    expect(element.querySelectorAll('.gap')).toHaveLength(2);
    // The lowest figure is the lowest observed, not a zero for a day without one.
    expect(labels(element)).toEqual(['112', '100']);
  });

  it('draws a single figure as a dot in the middle, with one label', async () => {
    const element = await draw([42]);
    expect(lines(element)).toEqual([]);
    expect(chart().points()).toEqual([{ x: 50, y: 50 }]);
    expect(labels(element)).toEqual(['42']);
    expect(chart().gaps()).toEqual([]);
  });

  it('draws a flat line through the middle for a figure that did not change', async () => {
    const element = await draw([7, 7, 7]);
    expect(lines(element)).toEqual(['M0.00 50.00L50.00 50.00L100.00 50.00']);
    expect(labels(element)).toEqual(['7']);
  });

  it('draws nothing without figures', async () => {
    const element = await draw([null, null]);
    expect(lines(element)).toEqual([]);
    expect(dots(element)).toBe(0);
    expect(labels(element)).toEqual([]);
    expect(chart().gaps()).toEqual([{ from: 0, to: 100 }]);
  });
});
