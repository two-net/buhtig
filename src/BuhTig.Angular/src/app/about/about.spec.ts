import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Shortcut } from '../search/shortcut';
import { About } from './about';

describe('About', () => {
  let fixture: ComponentFixture<About>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [About],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(About);
    await fixture.whenStable();
  });

  afterEach(() => {
    localStorage.clear();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const box = () => element().querySelector<HTMLInputElement>('main input[type="checkbox"]')!;

  it('is a page of prose below the header, with the search box (UI-03)', () => {
    expect(element().querySelector('app-header + main#main .prose h1')?.textContent).toBe(
      'About BuhTig',
    );
    expect(element().querySelector('app-header form[role="search"]')).not.toBeNull();
  });

  it("says that BuhTig is not GitHub's (UI-08)", () => {
    expect(element().querySelector('main')?.textContent).toContain(
      'It is not affiliated with or endorsed by GitHub.',
    );
  });

  it('names the keys that BuhTig answers to (NFR-UX-03)', () => {
    const keys = [...element().querySelectorAll('main ul kbd')].map((key) => key.textContent);
    expect(keys).toEqual(['/', 'Enter', 'Esc', '←', '→', 'Home', 'End']);
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
      (again.nativeElement as HTMLElement).querySelector<HTMLInputElement>('main input')!.checked,
    ).toBe(false);
  });
});
