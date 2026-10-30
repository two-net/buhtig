import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { compactNumber } from '../format/format';
import { Tip } from '../tip/tip';
import { Bar, BarChart } from './hbars';

@Component({ template: '' })
class Page {}

@Component({
  imports: [BarChart],
  template: `<app-bar-chart [bars]="bars()" [unit]="unit()" summary="Top contributors" />`,
})
class Host {
  readonly bars = signal<Bar[]>([
    { label: 'acme/widget', value: 12_345, link: '/acme/widget' },
    {
      label: 'mona',
      value: 6_000,
      href: 'https://github.com/mona',
      avatar: { name: 'mona', src: 'https://avatars.githubusercontent.com/u/1?v=4' },
      color: '#3178c6',
    },
    { label: 'Other', value: 0 },
  ]);
  readonly unit = signal('commits');
}

describe('BarChart', () => {
  let fixture: ComponentFixture<Host>;
  let tip: Tip;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Page }])],
    });
    fixture = TestBed.createComponent(Host);
    tip = TestBed.inject(Tip);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const rows = () => [...element().querySelectorAll<HTMLElement>('.hbar')];
  const fills = () => [...element().querySelectorAll<HTMLElement>('.track i')];

  /** What the tooltip says, if it shows. */
  const told = () => {
    const shown = tip.shown();
    return shown && `${shown.value} · ${shown.label}`;
  };

  it('is a list named for assistive technology, of a row for each bar', () => {
    const list = element().querySelector('ul')!;
    expect(list.getAttribute('aria-label')).toBe('Top contributors');
    expect([...list.querySelectorAll('li')]).toHaveLength(3);
    expect(rows().map((row) => row.querySelector('.lab')?.textContent?.trim())).toEqual([
      'acme/widget',
      'mona',
      'Other',
    ]);
  });

  it('draws each bar as long against the longest as its figure, with the figure in short', () => {
    expect(fills().map((fill) => fill.style.getPropertyValue('--w'))).toEqual([
      '1.0000',
      '0.4860',
      '0.0000',
    ]);
    expect(rows().map((row) => row.querySelector('.track b')?.textContent)).toEqual(
      [12_345, 6_000, 0].map((value) => compactNumber(value)),
    );
    // One after another (FR-ANIM-08).
    expect(fills().map((fill) => fill.style.getPropertyValue('--i'))).toEqual(['0', '1', '2']);
  });

  it("colors each bar in the chart's first color, unless it has its own", () => {
    expect(fills()[0].getAttribute('style')).toContain('var(--s1)');
    expect(fills()[1].style.background).toBe('rgb(49, 120, 198)');
  });

  it('draws bars of nothing flat', async () => {
    fixture.componentInstance.bars.set([
      { label: 'a', value: 0 },
      { label: 'b', value: 0 },
    ]);
    await fixture.whenStable();
    expect(fills().map((fill) => fill.style.getPropertyValue('--w'))).toEqual(['0.0000', '0.0000']);
  });

  it("leads to a page of BuhTig's, to a page elsewhere, or nowhere", async () => {
    const [own, elsewhere, nowhere] = rows();
    expect([own.tagName, own.getAttribute('href')]).toEqual(['A', '/acme/widget']);
    expect([elsewhere.tagName, elsewhere.getAttribute('href')]).toEqual([
      'A',
      'https://github.com/mona',
    ]);
    expect([nowhere.tagName, nowhere.getAttribute('href')]).toEqual(['DIV', null]);

    own.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/acme/widget');
  });

  it('shows the avatar of the account a bar is of', () => {
    const avatars = rows().map((row) => row.querySelector('app-avatar img')?.getAttribute('src'));
    expect(avatars).toEqual([
      undefined,
      'https://avatars.githubusercontent.com/u/1?v=4',
      undefined,
    ]);
  });

  it('tells the figure of the row pointed at in full (FR-ANIM-06)', async () => {
    rows()[1].dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 20 }));
    expect(told()).toBe('6,000 commits · mona');
    expect(tip.shown()?.color).toBe('#3178c6');
    expect(tip.shown()?.point).toEqual({ x: 10, y: 20 });
    rows()[1].dispatchEvent(new MouseEvent('pointerleave'));
    expect(tip.shown()).toBeUndefined();

    rows()[2].dispatchEvent(new MouseEvent('pointermove'));
    expect(told()).toBe('0 commits · Other');
    expect(tip.shown()?.color).toBe('var(--s1)');
    rows()[2].dispatchEvent(new MouseEvent('pointerleave'));
    expect(tip.shown()).toBeUndefined();
  });

  it('tells the figure of the link that has focus, as the keyboard moves to it', async () => {
    rows()[0].focus();
    expect(told()).toBe('12,345 commits · acme/widget');
    expect(tip.shown()?.point).toBeUndefined();
    rows()[1].focus();
    expect(told()).toBe('6,000 commits · mona');
    rows()[1].blur();
    expect(tip.shown()).toBeUndefined();
  });

  it('tells a figure without a unit as it is', async () => {
    fixture.componentInstance.unit.set('');
    await fixture.whenStable();
    rows()[0].dispatchEvent(new MouseEvent('pointermove'));
    expect(told()).toBe('12,345 · acme/widget');
  });
});
