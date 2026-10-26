import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { Session, signInUrl } from '../session/session';
import { ENDED } from './messages';

/**
 * The corner that says who is viewing (UI-02, UI-03): "Sign in" for a visitor, or the
 * user's avatar with a menu of Settings and Sign out. A user signed out while the page was open
 * is told so, and asked to sign in again (FR-AUTH-09).
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

  private readonly session = inject(Session);
  protected readonly user = this.session.user;
  protected readonly open = signal(false);

  protected readonly ENDED = ENDED;
  /** Whether the note that the user was signed out has been put away. */
  private readonly dismissed = signal(false);
  protected readonly ended = computed(() => this.session.ended() && !this.dismissed());

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

  /** Closes the menu, or the note, when a click or the focus lands outside it. */
  protected closeIfOutside(target: EventTarget | null): void {
    // No target is focus leaving the page, which is no reason to close.
    if (target instanceof Node && !this.host.nativeElement.contains(target)) {
      this.open.set(false);
      this.dismissed.set(this.session.ended());
    }
  }

  protected closeAndFocus(): void {
    if (this.open()) {
      this.open.set(false);
      this.button()?.nativeElement.focus();
    }
    this.dismissed.set(this.session.ended());
  }
}
