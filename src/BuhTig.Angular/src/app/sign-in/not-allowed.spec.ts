import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotAllowed } from './not-allowed';

describe('NotAllowed', () => {
  async function page(): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [NotAllowed],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(NotAllowed);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('says that the account is not allowed here, under the header (FR-AUTH-08)', async () => {
    const shown = await page();
    expect(shown.querySelector('app-header + main#main app-center h1')?.textContent).toBe(
      'Not allowed on this instance',
    );
  });

  it('says what the user can do about it (NFR-UX-06)', async () => {
    const text = (await page()).querySelector('app-center p')?.textContent;
    expect(text).toContain('ask the person who runs this instance to add it');
    expect(text).toContain('To sign in with another GitHub account, sign out of GitHub first.');
  });

  it('leads home', async () => {
    const link = (await page()).querySelector('main a')!;
    expect([link.textContent?.trim(), link.getAttribute('href')]).toEqual([
      'Go to the home page',
      '/',
    ]);
  });
});
