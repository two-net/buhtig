import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Dialog } from './dialog';

@Component({
  imports: [Dialog],
  template: `
    <button id="opener">Delete my data</button>
    @if (open()) {
      <app-dialog heading="Delete all your data?" (closed)="closes = closes + 1">
        <p>This can't be undone.</p>
        <button actions id="cancel">Cancel</button>
        <button actions id="confirm">Delete</button>
      </app-dialog>
    }
  `,
})
class Host {
  readonly open = signal(false);
  closes = 0;
}

describe('Dialog (NFR-UX-03)', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    // Attached, so that what is in it can take the focus.
    document.body.append(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => {
    (fixture.nativeElement as HTMLElement).remove();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const dialog = () => element().querySelector<HTMLElement>('[role="dialog"]')!;
  const button = (id: string) => element().querySelector<HTMLButtonElement>(`#${id}`)!;

  /** Opens the dialog, from its opener, as a click on it would. */
  async function open(): Promise<void> {
    button('opener').focus();
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
  }

  async function close(): Promise<void> {
    fixture.componentInstance.open.set(false);
    await fixture.whenStable();
  }

  function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    (document.activeElement ?? dialog()).dispatchEvent(event);
    return event;
  }

  it('is a modal dialog, named by its heading', async () => {
    await open();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    const heading = dialog().querySelector('h2')!;
    expect(heading.textContent).toBe('Delete all your data?');
    expect(dialog().getAttribute('aria-labelledby')).toBe(heading.id);
    expect(dialog().querySelector('.body')?.textContent?.trim()).toBe("This can't be undone.");
    expect([...dialog().querySelectorAll('.acts button')].map((b) => b.textContent)).toEqual([
      'Cancel',
      'Delete',
    ]);
  });

  it('puts the focus on its first control', async () => {
    await open();
    expect(document.activeElement).toBe(button('cancel'));
  });

  it('keeps the focus within it with Tab and Shift+Tab', async () => {
    await open();
    expect(press('Tab').defaultPrevented).toBe(false);
    button('confirm').focus();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button('cancel'));
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button('confirm'));
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(false);
  });

  it('asks to be closed on Esc, which goes no further', async () => {
    await open();
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    try {
      press('Escape');
      expect(fixture.componentInstance.closes).toBe(1);
      expect(outside).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', outside);
    }
  });

  it('asks to be closed with a click beside it, not in it', async () => {
    await open();
    dialog().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    button('cancel').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(fixture.componentInstance.closes).toBe(0);
    element()
      .querySelector('.backdrop')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(fixture.componentInstance.closes).toBe(1);
  });

  it('takes no other key', async () => {
    await open();
    expect(press('Enter').defaultPrevented).toBe(false);
    expect(fixture.componentInstance.closes).toBe(0);
  });

  it('gives the focus back to what had it once closed', async () => {
    await open();
    await close();
    expect(document.activeElement).toBe(button('opener'));
  });

  it('leaves the focus be once closed if what had it is gone', async () => {
    await open();
    button('opener').remove();
    await close();
    expect(document.activeElement).toBe(document.body);
  });
});
