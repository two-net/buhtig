import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Privacy } from './privacy';

describe('Privacy', () => {
  async function page(): Promise<HTMLElement> {
    TestBed.configureTestingModule({ imports: [Privacy], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Privacy);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('says what BuhTig keeps of visitors and of signed-in users (NFR-PRIV-03)', async () => {
    const headings = [...(await page()).querySelectorAll('h2')].map((heading) =>
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
    const text = (await page()).textContent?.replace(/\s+/g, ' ');
    expect(text).toContain("notes in your browser's session storage that it has played");
    expect(text).toContain(
      "If you turn off the / shortcut on the About page, BuhTig notes that in your browser's " +
        'local storage, so that it stays off. That note never leaves your browser either.',
    );
  });

  it('says where to delete it all, and where to revoke access on GitHub (FR-PERS-04)', async () => {
    const links = [...(await page()).querySelectorAll('a')].map((link) => [
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
