import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SignInFailed } from './failed';

describe('SignInFailed', () => {
  /** The page, for a sign-in that started from `returnTo`, if it says, and failed for `reason`. */
  async function page(returnTo?: string, reason?: string): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [SignInFailed],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(SignInFailed);
    if (returnTo !== undefined) {
      fixture.componentRef.setInput('return_to', returnTo);
    }
    if (reason !== undefined) {
      fixture.componentRef.setInput('reason', reason);
    }
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const tryAgain = (page: HTMLElement) =>
    [...page.querySelectorAll('main a')].find((link) => link.textContent?.trim() === 'Try again');

  it("says that sign-in didn't work, under the header, in the middle of the page", async () => {
    const shown = await page();
    expect(shown.querySelector('app-header + main#main app-center h1')?.textContent).toBe(
      "Sign-in didn't work",
    );
    const home = [...shown.querySelectorAll('main a')].find(
      (link) => link.textContent?.trim() === 'Go to the home page',
    );
    expect(home?.getAttribute('href')).toBe('/');
  });

  it('tries again from the page that sign-in started from (FR-AUTH-05)', async () => {
    expect(tryAgain(await page('/owner/repo'))!.getAttribute('href')).toBe(
      '/-/auth/sign-in?return_to=%2Fowner%2Frepo',
    );
  });

  it('tries again from the home page when it does not know that page', async () => {
    expect(tryAgain(await page())!.getAttribute('href')).toBe('/-/auth/sign-in?return_to=%2F');
  });

  it('says what may have gone wrong when the server does not say', async () => {
    for (const reason of [undefined, 'other']) {
      TestBed.resetTestingModule();
      const text = (await page('/owner/repo', reason)).querySelector('main')?.textContent;
      expect(text).toContain("BuhTig couldn't finish signing you in with GitHub.");
      // What the user can check before trying again (NFR-UX-06).
      expect(text?.replace(/\s+/g, ' ')).toContain(
        'Signing in also needs your browser to accept cookies from this site.',
      );
      expect(text).not.toContain('Too many sign-ins');
    }
  });

  it('says to wait after too many sign-ins in a minute (NFR-SEC-08)', async () => {
    const shown = await page('/owner/repo', 'too_many');
    expect(shown.textContent).toContain(
      'Too many sign-ins have come from your network in the last minute.',
    );
    expect(shown.textContent).not.toContain("BuhTig couldn't finish");
    expect(tryAgain(shown)!.getAttribute('href')).toBe('/-/auth/sign-in?return_to=%2Fowner%2Frepo');
  });
});
