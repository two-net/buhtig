import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Privacy } from './privacy';

describe('Privacy', () => {
  async function page(): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [Privacy],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(Privacy);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('is a page of prose below the header, with the search box (UI-03)', async () => {
    const shown = await page();
    expect(shown.querySelector('app-header + main#main .prose h1')?.textContent).toBe('Privacy');
    expect(shown.querySelector('app-header form[role="search"]')).not.toBeNull();
  });

  it('says what BuhTig keeps of visitors and of signed-in users (NFR-PRIV-03)', async () => {
    const headings = [...(await page()).querySelectorAll('main h2')].map((heading) =>
      heading.textContent?.trim(),
    );
    expect(headings).toEqual([
      'Cookies',
      "If you don't sign in",
      'If you sign in',
      'GitHub data',
      'Deleting your data',
    ]);
  });

  it('names the only two cookies BuhTig sets (NFR-PRIV-01)', async () => {
    const cookies = [...(await page()).querySelectorAll('li strong')]
      .map((label) => label.textContent?.trim())
      .filter((label) => label?.startsWith('buhtig_'));
    expect(cookies).toEqual(['buhtig_session', 'buhtig_sign_in']);
  });

  it("says what BuhTig notes in the browser's storage, and that it stays there", async () => {
    const shown = await page();
    const text = shown.querySelector('main')?.textContent?.replace(/\s+/g, ' ');
    // Where the / shortcut is turned off.
    expect(shown.querySelector('main a[href="/-/about"]')?.textContent).toBe('About');
    expect(text).toContain("notes in your browser's session storage that it has played");
    expect(text).toContain(
      "If you turn off the / shortcut on the About page, BuhTig notes that in your browser's " +
        'local storage, so that it stays off. That note never leaves your browser either.',
    );
  });

  it('says where to delete it all, and where to revoke access on GitHub (FR-PERS-04)', async () => {
    const links = [...(await page()).querySelectorAll('main a')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);
    expect(links).toContainEqual(['Settings', '/-/settings']);
    expect(links).toContainEqual([
      'Review your authorized apps on GitHub',
      'https://github.com/settings/applications',
    ]);
  });
});
