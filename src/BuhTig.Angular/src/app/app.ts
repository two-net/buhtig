import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ENDED } from './account/messages';
import { AnnouncerHost } from './live/announcer';
import { Session } from './session/session';
import { ToastHost, Toasts } from './toast/toasts';

/**
 * The app: the page the router shows, and what every page shares, which goes over it: toasts,
 * and what assistive technology is told.
 */
@Component({
  imports: [AnnouncerHost, RouterOutlet, ToastHost],
  selector: 'app-root',
  template: `
    <a class="sr skip" href="#main">Skip to content</a>
    <router-outlet />
    <app-toasts />
    <app-announcer />
  `,
})
export class App {
  constructor() {
    // The server may sign the user out while the page is open, as when GitHub rejects their
    // sign-in (FR-AUTH-09): they are told so once, and the page shows them signed out.
    const session = inject(Session);
    const toasts = inject(Toasts);
    effect(() => {
      if (session.ended()) {
        toasts.show(ENDED, 'logout');
      }
    });
  }
}
