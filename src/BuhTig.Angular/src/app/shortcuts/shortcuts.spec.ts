import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Shortcuts } from './shortcuts';

describe('Shortcuts', () => {
  let fixture: ComponentFixture<Shortcuts>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Shortcuts],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Shortcuts);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const links = () =>
    [...element().querySelectorAll('a')].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);

  async function signIn(): Promise<void> {
    http.expectOne('/-/api/session').flush({
      user: { login: 'mona', name: null, avatar_url: 'https://example.com/mona.png' },
    });
    await fixture.whenStable();
  }

  it('shows a visitor none, without asking for any', async () => {
    http.expectOne('/-/api/session').flush({ user: null });
    await fixture.whenStable();
    expect(element().querySelector('nav')).toBeNull();
    // `http.verify` checks that nothing else was asked.
  });

  it('shows a signed-in user their pins, then their recent dashboards (FR-SRCH-08)', async () => {
    await signIn();
    http.expectOne('/-/api/shortcuts').flush({
      pins: [{ kind: 'repository', name: 'owner/repo' }],
      recent: [
        { kind: 'organization', name: 'my-org' },
        { kind: 'repository', name: 'owner/repo' },
        { kind: 'repository', name: 'owner/another-repo' },
      ],
    });
    await fixture.whenStable();
    expect(element().querySelector('nav')!.getAttribute('aria-label')).toBe('Your dashboards');
    expect(links()).toEqual([
      ['owner/repo', '/owner/repo'],
      ['my-org', '/my-org'],
      ['owner/another-repo', '/owner/another-repo'],
    ]);
  });

  it('shows nothing for a user who has neither pins nor history', async () => {
    await signIn();
    http.expectOne('/-/api/shortcuts').flush({ pins: [], recent: [] });
    await fixture.whenStable();
    expect(element().querySelector('nav')).toBeNull();
  });

  it('shows nothing when the server cannot say', async () => {
    await signIn();
    http.expectOne('/-/api/shortcuts').flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(element().querySelector('nav')).toBeNull();
  });
});
