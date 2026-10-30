import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { MockInstance } from 'vitest';
import { Session, noticeSignOut } from '../session/session';
import { Toasts } from '../toast/toasts';
import { DataDeletion } from './deletion';
import {
  CONFIRM_DELETION,
  DATA_DELETED,
  DELETE_FAILED,
  DELETION_PURPOSE,
  GITHUB_ACCESS,
  REVIEW_GITHUB_ACCESS,
  deletionWarning,
} from './messages';

describe('DataDeletion', () => {
  let fixture: ComponentFixture<DataDeletion>;
  let http: HttpTestingController;
  let navigate: MockInstance<Router['navigateByUrl']>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [DataDeletion],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([noticeSignOut])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
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
  /** The button that opens the dialog. */
  const opener = () => element().querySelector<HTMLButtonElement>('#data button')!;
  const dialog = () => element().querySelector<HTMLElement>('[role="dialog"]');
  /** The dialog's button labelled `label`. */
  const choice = (label: string) =>
    [...(dialog()?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent?.trim() === label,
    );
  const alert = () => dialog()?.querySelector('[role="alert"]')?.textContent?.trim();
  const toasts = () =>
    TestBed.inject(Toasts)
      .toasts()
      .map((toast) => toast.message);
  const session = () => TestBed.inject(Session);

  async function open(): Promise<void> {
    opener().focus();
    opener().click();
    await fixture.whenStable();
  }

  async function click(button: HTMLElement): Promise<void> {
    button.click();
    await fixture.whenStable();
  }

  it("says what goes, and where to revoke BuhTig's access on GitHub (FR-PERS-04)", () => {
    expect(element().querySelector('#data-heading')!.textContent?.trim()).toBe('Your data');
    expect(text()).toContain(DELETION_PURPOSE);
    expect(text()).toContain(GITHUB_ACCESS);
    expect(
      [...element().querySelectorAll('a')].map((link) => [
        link.textContent?.trim(),
        link.getAttribute('href'),
      ]),
    ).toEqual([[REVIEW_GITHUB_ACCESS, 'https://github.com/settings/applications']]);
    expect(opener().textContent?.trim()).toBe('Delete my data');
    expect(dialog()).toBeNull();
  });

  it('asks the user to confirm, naming their account, and deletes nothing meanwhile', async () => {
    await open();
    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    const heading = dialog()!.querySelector('h2')!;
    expect(heading.textContent?.trim()).toBe(CONFIRM_DELETION);
    expect(dialog()!.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(dialog()!.textContent).toContain(deletionWarning('mona'));
    expect(deletionWarning('mona')).toContain('@mona');
    // Focus goes to its first button, which deletes nothing (NFR-UX-03).
    expect(document.activeElement).toBe(choice('Cancel'));
    http.expectNone('/-/api/user');
  });

  it('closes without deleting anything on Cancel, with focus back on what opened it', async () => {
    await open();
    await click(choice('Cancel')!);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener());
    http.expectNone('/-/api/user');
    expect(session().user()).toEqual(MONA);
  });

  it('closes without deleting anything on Esc, or a click beside it', async () => {
    await open();
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener());

    await open();
    dialog()!.parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await fixture.whenStable();
    expect(dialog()).toBeNull();

    // A click in it is no click beside it.
    await open();
    dialog()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await fixture.whenStable();
    expect(dialog()).not.toBeNull();
    http.expectNone('/-/api/user');
  });

  it('keeps focus within the dialog as Tab goes round', async () => {
    await open();
    const cancel = choice('Cancel')!;
    const confirm = choice('Delete my data')!;
    confirm.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    confirm.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    cancel.dispatchEvent(back);
    expect(document.activeElement).toBe(confirm);
  });

  it("deletes all of the user's data once they confirm, signs them out and sends them home", async () => {
    await open();
    await click(choice('Delete my data')!);
    // Nothing more until the server answers.
    expect(choice('Cancel')!.disabled).toBe(true);
    expect(choice('Delete my data')!.disabled).toBe(true);
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(dialog()).not.toBeNull();
    const request = http.expectOne('/-/api/user');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(toasts()).toEqual([DATA_DELETED]);
    expect(DATA_DELETED).toBe('Your BuhTig data was deleted');
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/');
    expect(session().deleted()).toBe(true);
    expect(session().user()).toBeNull();
    // Signed out as they asked, which is no sign-out to warn of.
    expect(session().ended()).toBe(false);
  });

  it('says in the dialog when the data could not be deleted, and lets the user try again (NFR-UX-06)', async () => {
    await open();
    await click(choice('Delete my data')!);
    http.expectOne('/-/api/user').flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(alert()).toBe(DELETE_FAILED);
    expect(toasts()).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(session().user()).toEqual(MONA);
    expect(choice('Delete my data')!.disabled).toBe(false);

    await click(choice('Delete my data')!);
    expect(alert()).toBeUndefined();
    http.expectOne('/-/api/user').flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(session().deleted()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('forgets why it failed once the dialog is closed', async () => {
    await open();
    await click(choice('Delete my data')!);
    http.expectOne('/-/api/user').flush(null, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    expect(alert()).toBe(DELETE_FAILED);
    await click(choice('Cancel')!);
    await open();
    expect(alert()).toBeUndefined();
  });
});
