import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

describe('routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it('shows the search box on the home page', async () => {
    const harness = await RouterTestingHarness.create('/');
    const page = harness.routeNativeElement!;
    expect(page.querySelector('h1')?.textContent).toBe('BuhTig');
    expect(page.querySelector('form[role="search"] input')).not.toBeNull();
  });

  it('has a dashboard for each repository and organization (FR-NAV-01)', async () => {
    const harness = await RouterTestingHarness.create();
    const heading = () => harness.routeNativeElement?.querySelector('h1')?.textContent?.trim();
    await harness.navigateByUrl('/vercel/next.js');
    expect(heading()).toBe('vercel/next.js');
    await harness.navigateByUrl('/angular');
    expect(heading()).toBe('angular');
  });
});
