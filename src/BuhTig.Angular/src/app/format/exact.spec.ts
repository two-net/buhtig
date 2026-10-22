import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Exact } from './exact';

@Component({
  imports: [Exact],
  template: `
    <app-exact value="12,345">12.3K</app-exact>
    <app-exact value="1,234,567">1.2M</app-exact>
  `,
})
class Host {}

describe('Exact', () => {
  let fixture: ComponentFixture<Host>;
  let first: HTMLElement;
  let second: HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    [first, second] = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      'app-exact',
    );
  });

  async function press(key: string, target: EventTarget = document): Promise<void> {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await fixture.whenStable();
  }

  it('describes the short text with the exact one, in a tooltip of its own (UI-06)', () => {
    const tooltips = [first, second].map((exact) => exact.querySelector('[role="tooltip"]')!);
    expect(tooltips.map((tooltip) => tooltip.textContent)).toEqual(['12,345', '1,234,567']);
    expect([first, second].map((exact) => exact.getAttribute('aria-describedby'))).toEqual(
      tooltips.map((tooltip) => tooltip.id),
    );
    expect(tooltips[0].id).not.toBe(tooltips[1].id);
  });

  it('takes the focus, so that the keyboard reaches the exact value (NFR-UX-03)', () => {
    expect(first.getAttribute('tabindex')).toBe('0');
    first.focus();
    expect(document.activeElement).toBe(first);
  });

  it('hides its tooltip on Esc, until hovered or focused again (WCAG 1.4.13)', async () => {
    await press('Escape', first);
    expect([first, second].map((exact) => exact.classList.contains('dismissed'))).toEqual([
      true,
      true,
    ]);

    first.dispatchEvent(new MouseEvent('mouseenter'));
    second.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await fixture.whenStable();
    expect([first, second].map((exact) => exact.classList.contains('dismissed'))).toEqual([
      false,
      false,
    ]);

    await press('Enter', first);
    expect(first.classList.contains('dismissed')).toBe(false);
  });
});
