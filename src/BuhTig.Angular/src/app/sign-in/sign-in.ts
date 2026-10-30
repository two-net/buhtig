import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Center } from '../center/center';
import { Header } from '../header/header';
import { signInUrl } from '../session/session';

/**
 * Where a visitor is sent to sign in, from the page they opened, when this instance of BuhTig is
 * in private mode (FR-ACC-03). Signing in returns them to that page (FR-AUTH-05). The About and
 * Privacy pages stay open to them.
 */
@Component({
  selector: 'app-sign-in',
  imports: [Center, Header, RouterLink],
  templateUrl: './sign-in.html',
})
export class SignIn {
  /** The page the visitor opened, to return to once they have signed in. */
  readonly returnTo = input<string | undefined>(undefined, { alias: 'return_to' });

  protected readonly signIn = computed(() => signInUrl(this.returnTo() ?? '/'));

  protected readonly heading = 'This BuhTig instance is private';
  protected readonly text =
    'Sign in with your GitHub account to continue. BuhTig asks GitHub only who you are: it gets ' +
    "no access to your private repositories, and it can't change anything on GitHub.";
}
