import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { Session } from '../session/session';

/**
 * The corner that says who is viewing (UI-02, UI-03): "Sign in" for a visitor, or the
 * user's avatar with a menu of Settings and Sign out.
 */
@Component({
  selector: 'app-account',
  imports: [RouterLink],
  templateUrl: './account.html',
  styleUrl: './account.css',
  host: {
    '(document:click)': 'closeIfOutside($event.target)',
    '(focusout)': 'closeIfOutside($event.relatedTarget)',
    '(keydown.escape)': 'closeAndFocus()',
  },
})
export class Account {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);
  private readonly button = viewChild<ElementRef<HTMLButtonElement>>('button');

  protected readonly user = inject(Session).user;
  protected readonly open = signal(false);

  /** Where signing in starts, with the page to return to afterwards (FR-AUTH-05). */
  protected readonly signIn = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => signInUrl(this.router.url)),
    ),
    { initialValue: signInUrl(this.router.url) },
  );

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  /** Closes the menu when a click or the focus lands outside it. */
  protected closeIfOutside(target: EventTarget | null): void {
    // No target is focus leaving the page, which is no reason to close.
    if (target instanceof Node && !this.host.nativeElement.contains(target)) {
      this.open.set(false);
    }
  }

  protected closeAndFocus(): void {
    if (this.open()) {
      this.open.set(false);
      this.button()?.nativeElement.focus();
    }
  }
}

function signInUrl(returnTo: string): string {
  return `/-/auth/sign-in?return_to=${encodeURIComponent(returnTo)}`;
}
