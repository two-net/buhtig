import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon, IconName } from './icon';

describe('Icon', () => {
  let fixture: ComponentFixture<Icon>;

  async function show(name: IconName): Promise<HTMLElement> {
    fixture = TestBed.createComponent(Icon);
    fixture.componentRef.setInput('name', name);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const paths = (element: HTMLElement) =>
    [...element.querySelectorAll('path')].map((path) => path.getAttribute('d'));

  it('is decoration, which assistive technology skips and the keyboard never reaches', async () => {
    const element = await show('search');
    expect(element.getAttribute('aria-hidden')).toBe('true');
    const svg = element.querySelector('svg')!;
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('draws the strokes of the icon it is', async () => {
    const element = await show('x');
    expect(paths(element)).toEqual(['M6 6l12 12M18 6L6 18']);
    fixture.componentRef.setInput('name', 'search');
    await fixture.whenStable();
    // A circle and its handle.
    expect(paths(element)).toHaveLength(2);
    expect(paths(element)[1]).toBe('M16.2 16.2L21 21');
  });

  it('fills the pin of a pinned dashboard, and no other', async () => {
    expect((await show('pin-fill')).querySelector('svg')!.classList).toContain('fill');
    expect((await show('pin')).querySelector('svg')!.classList).not.toContain('fill');
  });
});
