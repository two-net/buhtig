import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SignIn } from './sign-in';

describe('SignIn', () => {
  /** The page, for a visitor who opened `returnTo`, if it says. */
  async function page(returnTo?: string): Promise<HTMLElement> {
    TestBed.configureTestingModule({ imports: [SignIn], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(SignIn);
    if (returnTo !== undefined) {
      fixture.componentRef.setInput('return_to', returnTo);
    }
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const link = (page: HTMLElement, text: string) =>
    [...page.querySelectorAll('a')]
      .find((link) => link.textContent?.trim() === text)
      ?.getAttribute('href');

  it('signs in and returns to the page the visitor opened (FR-ACC-03)', async () => {
    expect(link(await page('/owner/repo?tab=x'), 'Sign in with GitHub')).toBe(
      '/-/auth/sign-in?return_to=%2Fowner%2Frepo%3Ftab%3Dx',
    );
  });

  it('returns to the home page when it does not know that page', async () => {
    expect(link(await page(), 'Sign in with GitHub')).toBe('/-/auth/sign-in?return_to=%2F');
  });

  it('leads to the About and Privacy pages, which need no sign-in', async () => {
    const shown = await page();
    expect([link(shown, 'About'), link(shown, 'Privacy')]).toEqual(['/-/about', '/-/privacy']);
  });
});
