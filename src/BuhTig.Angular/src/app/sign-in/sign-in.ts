import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { signInUrl } from '../session/session';
import { Wordmark } from '../wordmark/wordmark';

/**
 * Where a visitor is sent to sign in, from the page they opened, when this instance of BuhTig is
 * in private mode (FR-ACC-03). Signing in returns them to that page (FR-AUTH-05). The About and
 * Privacy pages stay open to them.
 */
@Component({
  selector: 'app-sign-in',
  imports: [RouterLink, Wordmark],
  templateUrl: './sign-in.html',
  styles: `
    .sign-in {
      display: inline-block;
      padding: 0.5rem 1.25rem;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--text);
      text-decoration: none;
    }

    .sign-in:hover {
      background: var(--raised);
    }

    nav {
      display: flex;
      gap: 1.5rem;
      margin-top: 2rem;
    }
  `,
})
export class SignIn {
  /** The page the visitor opened, to return to once they have signed in. */
  readonly returnTo = input<string | undefined>(undefined, { alias: 'return_to' });

  protected readonly signIn = computed(() => signInUrl(this.returnTo() ?? '/'));
}
