import { Component, Injectable, inject, signal } from '@angular/core';
import { Icon, IconName } from '../icon/icon';

/** How long a toast shows, and then how long it takes to fade away. */
export const TOAST_MS = 3_200;
const LEAVE_MS = 250;

interface Toast {
  id: number;
  message: string;
  icon: IconName;
  leaving: boolean;
}

/**
 * Short notes of what just happened, such as "Pinned acme/rocket", in the bottom-left corner,
 * which go on their own. Assistive technology announces each (NFR-UX-02). Nothing that needs an
 * action is said only in a toast.
 */
@Injectable({ providedIn: 'root' })
export class Toasts {
  private next = 0;
  private readonly shown = signal<Toast[]>([]);
  readonly toasts = this.shown.asReadonly();

  show(message: string, icon: IconName = 'check'): void {
    const id = this.next++;
    this.shown.update((toasts) => [...toasts, { id, message, icon, leaving: false }]);
    setTimeout(() => {
      this.shown.update((toasts) =>
        toasts.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
      );
      setTimeout(
        () => this.shown.update((toasts) => toasts.filter((toast) => toast.id !== id)),
        LEAVE_MS,
      );
    }, TOAST_MS);
  }
}

/** Where toasts show, once for the whole app. */
@Component({
  selector: 'app-toasts',
  imports: [Icon],
  template: `
    <div class="toasts" role="status">
      @for (toast of toasts(); track toast.id) {
        <div class="toast" [class.leaving]="toast.leaving">
          <app-icon [name]="toast.icon" /><span>{{ toast.message }}</span>
        </div>
      }
    </div>
  `,
})
export class ToastHost {
  protected readonly toasts = inject(Toasts).toasts;
}
