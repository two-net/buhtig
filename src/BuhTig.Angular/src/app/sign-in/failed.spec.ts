import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SignInFailed } from './failed';

describe('SignInFailed', () => {
  /** The page, for a sign-in that started from `returnTo`, if it says. */
  async function page(returnTo?: string): Promise<HTMLElement> {
    TestBed.configureTestingModule({ imports: [SignInFailed], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(SignInFailed);
    if (returnTo !== undefined) {
      fixture.componentRef.setInput('return_to', returnTo);
    }
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const tryAgain = (page: HTMLElement) =>
    [...page.querySelectorAll('a')].find((link) => link.textContent?.trim() === 'Try again');

  it('tries again from the page that sign-in started from (FR-AUTH-05)', async () => {
    expect(tryAgain(await page('/owner/repo'))!.getAttribute('href')).toBe(
      '/-/auth/sign-in?return_to=%2Fowner%2Frepo',
    );
  });

  it('tries again from the home page when it does not know that page', async () => {
    expect(tryAgain(await page())!.getAttribute('href')).toBe('/-/auth/sign-in?return_to=%2F');
  });
});
