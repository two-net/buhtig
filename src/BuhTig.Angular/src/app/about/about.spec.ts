import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Shortcut } from '../search/shortcut';
import { About } from './about';

describe('About', () => {
  let fixture: ComponentFixture<About>;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [About], providers: [provideRouter([])] });
    fixture = TestBed.createComponent(About);
    await fixture.whenStable();
  });

  afterEach(() => {
    localStorage.clear();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const box = () => element().querySelector<HTMLInputElement>('input[type="checkbox"]')!;

  it('names the keys that BuhTig answers to (NFR-UX-03)', () => {
    const keys = [...element().querySelectorAll('p kbd')].map((key) => key.textContent);
    expect(keys).toEqual(['/', 'Esc', '←', '→', 'Home', 'End']);
  });

  it('turns / off and on again (WCAG 2.1.4)', async () => {
    const shortcut = TestBed.inject(Shortcut);
    expect(box().closest('label')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Use / to jump to the search box',
    );
    expect(box().checked).toBe(true);

    box().click();
    await fixture.whenStable();
    expect(shortcut.enabled()).toBe(false);

    box().click();
    await fixture.whenStable();
    expect(shortcut.enabled()).toBe(true);
  });

  it('shows / as off once it has been turned off', async () => {
    TestBed.inject(Shortcut).set(false);
    const again = TestBed.createComponent(About);
    await again.whenStable();
    expect(
      (again.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input')!.checked,
    ).toBe(false);
  });
});
