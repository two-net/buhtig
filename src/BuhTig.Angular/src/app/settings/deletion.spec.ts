import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Session, noticeSignOut } from '../session/session';
import { DataDeletion } from './deletion';
import { CONFIRM_DELETION, DELETE_FAILED, DELETION_PURPOSE, GITHUB_ACCESS } from './messages';

describe('DataDeletion', () => {
  let fixture: ComponentFixture<DataDeletion>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [DataDeletion],
      providers: [provideHttpClient(withInterceptors([noticeSignOut])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DataDeletion);
    fixture.autoDetectChanges();
    http.expectOne('/-/api/session').flush({ user: MONA, token: null });
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  const MONA = { login: 'mona', name: 'Mona Lisa', avatar_url: 'https://example.com/mona.png' };

  const element = () => fixture.nativeElement as HTMLElement;
  const text = () => element().textContent!.replace(/\s+/g, ' ');
  const button = (label: string) =>
    [...element().querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === label,
    );
  const question = () => element().querySelector<HTMLElement>('#deletion-question');
  const alert = () => element().querySelector('[role="alert"]')?.textContent?.trim();
  const session = () => TestBed.inject(Session);

  async function click(label: string): Promise<void> {
    button(label)!.click();
    await fixture.whenStable();
  }

  it("says what goes, and where to revoke BuhTig's access on GitHub (FR-PERS-04)", () => {
    expect(text()).toContain(DELETION_PURPOSE);
    expect(text()).toContain(GITHUB_ACCESS);
    const links = [...element().querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(links).toEqual(['https://github.com/settings/applications']);
  });

  it('deletes nothing until the user confirms', async () => {
    expect(question()).toBeNull();
    await click('Delete all my data…');
    expect(question()!.textContent?.trim()).toBe(CONFIRM_DELETION);
    expect(document.activeElement).toBe(question());
    http.expectNone('/-/api/user');

    await click('Cancel');
    expect(question()).toBeNull();
    expect(document.activeElement).toBe(button('Delete all my data…'));
    http.expectNone('/-/api/user');
    expect(session().user()).toEqual(MONA);
  });

  it("deletes all of the user's data once they confirm, which signs them out", async () => {
    await click('Delete all my data…');
    await click('Delete all my data');
    // Nothing more until the server answers.
    expect([...element().querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    const request = http.expectOne('/-/api/user');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(session().deleted()).toBe(true);
    expect(session().user()).toBeNull();
    expect(session().ended()).toBe(false);
  });

  it('says when the data could not be deleted, and lets the user try again (NFR-UX-06)', async () => {
    await click('Delete all my data…');
    await click('Delete all my data');
    http.expectOne('/-/api/user').flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(alert()).toBe(DELETE_FAILED);
    expect(session().user()).toEqual(MONA);
    expect(button('Delete all my data')!.disabled).toBe(false);

    await click('Delete all my data');
    expect(alert()).toBeUndefined();
    http.expectOne('/-/api/user').flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(session().deleted()).toBe(true);
  });
});
