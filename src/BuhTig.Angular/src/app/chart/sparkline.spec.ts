import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Sparkline } from './sparkline';

describe('Sparkline', () => {
  let fixture: ComponentFixture<Sparkline>;

  async function draw(values: number[]): Promise<SVGElement> {
    fixture = TestBed.createComponent(Sparkline);
    fixture.componentRef.setInput('values', values);
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).querySelector('svg')!;
  }

  const line = (svg: SVGElement) => svg.querySelector('polyline')!.getAttribute('points');
  const area = (svg: SVGElement) => svg.querySelector('path')!.getAttribute('d');

  it('is for the eye alone, as what it shows is said beside it', async () => {
    const svg = await draw([1, 2]);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('viewBox')).toBe('0 0 155 30');
  });

  it('draws its figures from left to right, as high against the highest as they are', async () => {
    const svg = await draw([0, 5, 10]);
    expect(line(svg)).toBe('0.0,29.0 77.5,16.0 155.0,3.0');
    // And the area under the line, down to the bottom.
    expect(area(svg)).toBe('M0 30L0.0 29.0L77.5 16.0L155.0 3.0L155 30Z');
  });

  it('draws a flat line for nothing', async () => {
    expect(line(await draw([0, 0, 0]))).toBe('0.0,29.0 77.5,29.0 155.0,29.0');
  });

  it('draws one figure without dividing by nothing', async () => {
    expect(line(await draw([4]))).toBe('0.0,3.0');
  });

  it('draws nothing without figures, as for a repository without commits', async () => {
    const svg = await draw([]);
    expect(line(svg)).toBe('');
    expect(area(svg)).toBe('');
  });

  it('follows its figures', async () => {
    const svg = await draw([0, 5, 10]);
    fixture.componentRef.setInput('values', [10, 0]);
    await fixture.whenStable();
    expect(line(svg)).toBe('0.0,3.0 155.0,29.0');
  });
});
