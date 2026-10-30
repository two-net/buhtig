import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

let count = 0;

/** What can take focus in a dialog. */
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select, textarea';

/**
 * A modal dialog over the page, such as one that asks the user to confirm (NFR-UX-03): focus
 * goes to its first control and stays within it, Esc or a click beside it closes it, and focus
 * then goes back to what had it before. Its content goes in its body, and its buttons, marked
 * `actions`, below.
 */
@Component({
  selector: 'app-dialog',
  template: `
    <div class="backdrop" (mousedown)="closeIfBeside($event)">
      <div
        #dialog
        class="dialog"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="id"
        (keydown)="trap($event)"
      >
        <h2 [id]="id">{{ heading() }}</h2>
        <div class="body"><ng-content /></div>
        <div class="acts"><ng-content select="[actions]" /></div>
      </div>
    </div>
  `,
})
export class Dialog {
  readonly heading = input.required<string>();
  /** Asked for when the user closes the dialog without choosing, with Esc or beside it. */
  readonly closed = output();

  protected readonly id = `dialog-${count++}`;
  private readonly document = inject(DOCUMENT);
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

  constructor() {
    const opener = this.document.activeElement;
    afterNextRender(() => this.focusable()[0]?.focus());
    inject(DestroyRef).onDestroy(() => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    });
  }

  protected closeIfBeside(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }

  protected trap(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.closed.emit();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = this.focusable();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && this.document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  private focusable(): HTMLElement[] {
    return [...this.dialog().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)];
  }
}
