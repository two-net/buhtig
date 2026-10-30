import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Tip } from '../tip/tip';
import { Segment, SplitBar } from './stack';

@Component({
  imports: [SplitBar],
  template: `<app-split-bar
    [segments]="segments()"
    [shares]="shares()"
    [label]="label()"
    unit="bytes"
    summary="TypeScript 75%, CSS 25%."
  />`,
})
class Host {
  readonly segments = signal<Segment[]>([
    { label: 'TypeScript', value: 3_000, color: '#3178c6' },
    { label: 'CSS', value: 1_000, color: '#663399' },
    { label: 'Shell', value: 0, color: '#89e051' },
  ]);
  readonly shares = signal(true);
  readonly label = signal('');
}

describe('SplitBar', () => {
  let fixture: ComponentFixture<Host>;
  let tip: Tip;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    tip = TestBed.inject(Tip);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const bar = () => element().querySelector<HTMLElement>('.stack')!;
  const parts = () => [...bar().querySelectorAll<HTMLElement>('i')];
  const legend = () =>
    [...element().querySelectorAll('.legend li')].map((item) => [
      item.querySelector('.nm')?.textContent,
      item.querySelector('.pc')?.textContent,
    ]);

  async function set(change: (host: Host) => void): Promise<void> {
    change(fixture.componentInstance);
    await fixture.whenStable();
  }

  it('is an image for assistive technology, which reads its summary', () => {
    expect(bar().getAttribute('role')).toBe('img');
    expect(bar().getAttribute('aria-label')).toBe('TypeScript 75%, CSS 25%.');
  });

  it('splits the bar by the parts with something to show, each in its color', () => {
    expect(parts().map((part) => [part.style.flexGrow, part.style.background])).toEqual([
      ['3000', 'rgb(49, 120, 198)'],
      ['1000', 'rgb(102, 51, 153)'],
    ]);
  });

  it('names every part in the legend, in the same order, with its share (NFR-UX-05)', () => {
    expect(legend()).toEqual([
      ['TypeScript', '75%'],
      ['CSS', '25%'],
      ['Shell', '0%'],
    ]);
    const swatches = [...element().querySelectorAll<HTMLElement>('.legend .sw')];
    expect(swatches.map((swatch) => swatch.style.background)).toEqual([
      'rgb(49, 120, 198)',
      'rgb(102, 51, 153)',
      'rgb(137, 224, 81)',
    ]);
  });

  it('names each part with its figure in place of its share, on request', async () => {
    await set((host) => host.shares.set(false));
    expect(legend()).toEqual([
      ['TypeScript', '3,000'],
      ['CSS', '1,000'],
      ['Shell', '0'],
    ]);
  });

  it('shares nothing out of nothing', async () => {
    await set((host) => host.segments.update((all) => all.map((s) => ({ ...s, value: 0 }))));
    expect(parts()).toEqual([]);
    expect(legend().map(([, share]) => share)).toEqual(['0%', '0%', '0%']);
  });

  it('says what it is of above it, if anything', async () => {
    expect(element().querySelector('.sublabel')).toBeNull();
    await set((host) => host.label.set('Issues'));
    expect(element().querySelector('.sublabel')?.textContent).toBe('Issues');
  });

  it('tells the figure and share of the part pointed at (FR-ANIM-06)', () => {
    parts()[1].dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 6 }));
    expect(tip.shown()).toMatchObject({
      value: '1,000 bytes (25%)',
      label: 'CSS',
      color: '#663399',
      point: { x: 5, y: 6 },
    });
    parts()[1].dispatchEvent(new MouseEvent('pointerleave'));
    expect(tip.shown()).toBeUndefined();
  });
});
