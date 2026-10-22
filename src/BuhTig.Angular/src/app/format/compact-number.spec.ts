import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CompactNumber } from './compact-number';
import { compactNumber, exactNumber } from './format';

describe('CompactNumber', () => {
  let fixture: ComponentFixture<CompactNumber>;

  async function show(value: number): Promise<HTMLElement> {
    fixture = TestBed.createComponent(CompactNumber);
    fixture.componentRef.setInput('value', value);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a large number in short, with the exact number on hover and focus (UI-06)', async () => {
    const element = await show(12_345);
    const exact = element.querySelector('app-exact')!;
    const tooltip = exact.querySelector('[role="tooltip"]')!;
    expect(exact.firstChild?.textContent?.trim()).toBe(compactNumber(12_345));
    expect(tooltip.textContent).toBe(exactNumber(12_345));
    expect(exact.getAttribute('tabindex')).toBe('0');
    expect(exact.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('shows a short number as it is, without taking the focus', async () => {
    const element = await show(42);
    expect(element.textContent?.trim()).toBe('42');
    expect(element.querySelector('app-exact, [tabindex]')).toBeNull();
  });

  it('follows its value', async () => {
    const element = await show(42);
    fixture.componentRef.setInput('value', 1_234_567);
    await fixture.whenStable();
    expect(element.querySelector('[role="tooltip"]')?.textContent).toBe(exactNumber(1_234_567));
  });
});
