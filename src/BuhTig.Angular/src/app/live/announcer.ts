import { Component, Injectable, inject, signal } from '@angular/core';

/**
 * What assistive technology is told of changes that it would not notice otherwise, such as a
 * dashboard that has loaded (NFR-UX-02).
 */
@Injectable({ providedIn: 'root' })
export class Announcer {
  private readonly said = signal('');
  readonly message = this.said.asReadonly();

  /** Says `message`, even if it is what was said last. */
  announce(message: string): void {
    this.said.set('');
    setTimeout(() => this.said.set(message), 30);
  }
}

/** Where the announcer speaks, once for the whole app. */
@Component({
  selector: 'app-announcer',
  template: `<p class="sr" role="status">{{ message() }}</p>`,
})
export class AnnouncerHost {
  protected readonly message = inject(Announcer).message;
}
