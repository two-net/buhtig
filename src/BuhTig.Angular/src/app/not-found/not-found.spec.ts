import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotFound } from './not-found';

describe('NotFound (FR-NAV-03)', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [NotFound],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(NotFound);
    await fixture.whenStable();
    page = fixture.nativeElement as HTMLElement;
  });

  it('says that BuhTig has no page here, under the header', () => {
    expect(page.querySelector('app-header + main#main app-center h1')?.textContent).toBe(
      'Page not found',
    );
    expect(page.querySelector('app-center p')?.textContent).toBe(
      'BuhTig has no page at this address.',
    );
  });

  it('offers to search again, from the header or the home page', () => {
    expect(page.querySelector('app-header form[role="search"]')).not.toBeNull();
    const link = page.querySelector('main a')!;
    expect([link.textContent?.trim(), link.getAttribute('href')]).toEqual(['Search again', '/']);
  });
});
