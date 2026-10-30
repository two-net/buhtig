import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Center } from '../center/center';
import { Header } from '../header/header';
import { signInUrl } from '../session/session';

/** Where a sign-in ends that did not succeed, to try again from. */
@Component({
  selector: 'app-sign-in-failed',
  imports: [Center, Header, RouterLink],
  templateUrl: './failed.html',
})
export class SignInFailed {
  /** The page the sign-in started from, to return to once it succeeds (FR-AUTH-05). */
  readonly returnTo = input<string | undefined>(undefined, { alias: 'return_to' });

  /** Why it did not succeed, when the server says: `too_many` sign-ins in a minute (NFR-SEC-08). */
  readonly reason = input<string | undefined>(undefined);

  protected readonly text = computed(() =>
    this.reason() === 'too_many'
      ? 'Too many sign-ins have come from your network in the last minute. Wait a minute, then ' +
        'try again.'
      : "BuhTig couldn't finish signing you in with GitHub. This can happen when signing in " +
        'takes longer than a few minutes, or when you started it in another tab. Signing in also ' +
        'needs your browser to accept cookies from this site.',
  );

  protected readonly tryAgain = computed(() => signInUrl(this.returnTo() ?? '/'));
}
