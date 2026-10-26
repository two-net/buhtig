import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { Clock } from '../format/clock';
import { timeUntil } from '../format/format';
import { Session, signInUrl } from '../session/session';
import { ENDED, REPLACE_TOKEN, TOKEN_INVALID, tokenExpires } from './messages';

/** FR-PAT-10: how long before a token expires the user is reminded to replace it. */
const EXPIRY_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The corner that says who is viewing (UI-02, UI-03): "Sign in" for a visitor, or the
 * user's avatar with a menu of Settings and Sign out. A user signed out while the page was open
 * is told so, and asked to sign in again (FR-AUTH-09). A user whose personal access token GitHub
 * no longer accepts (FR-PAT-07), or that expires within 7 days (FR-PAT-10), is asked to replace
 * it, until they put the note away. Settings, where they would, says so itself.
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
  private readonly clock = inject(Clock);
  protected readonly user = this.session.user;
  protected readonly open = signal(false);

  protected readonly ENDED = ENDED;
  /** Whether the note that the user was signed out has been put away. */
  private readonly dismissed = signal(false);
  protected readonly ended = computed(() => this.session.ended() && !this.dismissed());

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

  protected readonly REPLACE_TOKEN = REPLACE_TOKEN;
  /** What to tell the user about their token, if anything. */
  protected readonly tokenNote = computed(() => {
    const token = this.session.token();
    if (!token || this.session.tokenNoted() || this.url().startsWith('/-/settings')) {
      return undefined;
    }
    if (token.status === 'invalid') {
      return TOKEN_INVALID;
    }
    const expiresAt = token.expiresAt;
    const now = this.clock.now();
    return expiresAt && expiresAt.getTime() - now <= EXPIRY_NOTICE_MS
      ? tokenExpires(timeUntil(expiresAt, now))
      : undefined;
  });

  /** Closes the menu, or the note, when a click or the focus lands outside it. */
  protected closeIfOutside(target: EventTarget | null): void {
    // No target is focus leaving the page, which is no reason to close.
    if (target instanceof Node && !this.host.nativeElement.contains(target)) {
      this.open.set(false);
      this.putNotesAway();
    }
  }

  protected closeAndFocus(): void {
    if (this.open()) {
      this.open.set(false);
      this.button()?.nativeElement.focus();
    }
    this.putNotesAway();
  }

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  private putNotesAway(): void {
    this.dismissed.set(this.session.ended());
    if (this.tokenNote()) {
      this.session.dismissTokenNote();
    }
  }
}
