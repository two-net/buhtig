import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { MockInstance } from 'vitest';
import { Search } from './search';

describe('Search', () => {
  let fixture: ComponentFixture<Search>;
  let http: HttpTestingController;
  let navigate: MockInstance<Router['navigateByUrl']>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Search);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const input = () => element().querySelector('input')!;
  const message = () => element().querySelector('[role="alert"]')?.textContent?.trim();

  function type(text: string): void {
    input().value = text;
    input().dispatchEvent(new Event('input'));
  }

  /** Types `text` and presses "Show dashboard", as Enter in the input does. */
  function search(text: string): void {
    type(text);
    element().querySelector('button')!.click();
  }

  const USER_MESSAGE =
    "octocat is a GitHub user, not an organization. BuhTig shows repositories and organizations, so enter one of octocat's repositories, such as octocat/repository-name.";

  it('rejects other hosts inline, without navigating (AC-10)', async () => {
    search('gitlab.com/owner/repo');
    await fixture.whenStable();
    expect(message()).toBe('BuhTig supports github.com URLs only.');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().getAttribute('aria-describedby')).toBe('search-message');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('checks names before asking anyone (FR-SRCH-04)', async () => {
    search('https://github.com/-owner/repo');
    await fixture.whenStable();
    expect(message()).toContain('“-owner” is not a GitHub account name.');
    expect(navigate).not.toHaveBeenCalled();
    // `http.verify` checks that nothing was asked.
  });

  it('asks for something to search for', async () => {
    search('  ');
    await fixture.whenStable();
    expect(message()).toBe('Enter a GitHub repository or organization URL.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens a repository's dashboard at once (FR-SRCH-03)", async () => {
    search('https://github.com/owner/repo/tree/main');
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/owner/repo'));
    expect(message()).toBeUndefined();
  });

  it("opens an organization's dashboard once the server says it is one", async () => {
    search('github.com/orgs/acme/repositories');
    http.expectOne('/-/api/accounts/acme').flush({ type: 'organization' });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/acme'));
  });

  it('says when an account is a user, without navigating (FR-SRCH-06)', async () => {
    search('octocat');
    http.expectOne('/-/api/accounts/octocat').flush({ type: 'user' });
    await vi.waitFor(() => expect(message()).toBe(USER_MESSAGE));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens the dashboard anyway when the server cannot tell', async () => {
    search('nobody');
    http.expectOne('/-/api/accounts/nobody').flush(null, { status: 404, statusText: 'Not Found' });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/nobody'));

    search('acme');
    http.expectOne('/-/api/accounts/acme').flush(null, { status: 502, statusText: 'Bad Gateway' });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/acme'));

    search('offline');
    http.expectOne('/-/api/accounts/offline').error(new ProgressEvent('error'));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/offline'));
  });

  it('opens the dashboard anyway when the server takes too long', async () => {
    vi.useFakeTimers();
    search('slow');
    const request = http.expectOne('/-/api/accounts/slow');
    vi.advanceTimersByTime(2999);
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(request.cancelled).toBe(true);
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/slow'));
  });

  it('clears the message as the input is edited', async () => {
    search('gitlab.com/owner/repo');
    await fixture.whenStable();
    expect(message()).toBeDefined();
    type('gitlab.com/owner/rep');
    await fixture.whenStable();
    expect(message()).toBeUndefined();
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('ignores what it learns about an account once the input has changed', async () => {
    search('octocat');
    const request = http.expectOne('/-/api/accounts/octocat');
    type('octocat/hello-world');
    request.flush({ type: 'user' });
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    expect(message()).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
  });
});
