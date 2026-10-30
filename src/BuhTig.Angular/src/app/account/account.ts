import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { Avatar } from '../avatar/avatar';
import { Icon } from '../icon/icon';
import { Session, signInUrl } from '../session/session';
import { TOKEN_STATES } from './messages';

/**
 * The corner that says who is viewing (UI-02, UI-03): "Sign in" for a visitor, or the user's
 * avatar with a menu: who they are, whether BuhTig has a personal access token of theirs that
 * GitHub accepts (FR-PAT-04), and Home, Settings and Sign out. ↑ and ↓ move through the menu,
 * and Esc closes it, with focus back on the avatar (NFR-UX-03).
 */
@Component({
  selector: 'app-account',
  imports: [Avatar, Icon, RouterLink],
  templateUrl: './account.html',
  host: {
    '(document:click)': 'closeIfOutside($event.target)',
    '(focusout)': 'closeIfOutside($event.relatedTarget)',
  },
})
export class Account {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);
  private readonly button = viewChild<ElementRef<HTMLButtonElement>>('button');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');

  private readonly session = inject(Session);
  protected readonly user = this.session.user;
  protected readonly open = signal(false);

  /** The page's URL, as of the last navigation. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Where signing in starts, with the page to return to afterwards (FR-AUTH-05). */
  protected readonly signIn = computed(() => signInUrl(this.url()));

  protected readonly token = computed(() => {
    const token = this.session.token();
    return TOKEN_STATES[!token ? 'none' : token.status];
  });

  /** Closes the menu when a click or the focus lands outside it. */
  protected closeIfOutside(target: EventTarget | null): void {
    // No target is focus leaving the page, which is no reason to close.
    if (target instanceof Node && !this.host.nativeElement.contains(target)) {
      this.open.set(false);
    }
  }

  protected toggle(): void {
    this.open.update((open) => !open);
    if (this.open()) {
      // Once it is shown.
      setTimeout(() => this.items()[0]?.focus());
    }
  }

  protected keydown(event: KeyboardEvent): void {
    const items = this.items();
    const at = items.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'Escape':
        this.open.set(false);
        this.button()?.nativeElement.focus();
        return;
      case 'ArrowDown':
        items[(at + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        items[(at - 1 + items.length) % items.length]?.focus();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private items(): HTMLElement[] {
    const menu = this.menu()?.nativeElement;
    return menu ? [...menu.querySelectorAll<HTMLElement>('a, button')] : [];
  }
}
