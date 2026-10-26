import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { signInUrl } from '../session/session';

/** Where a sign-in ends that did not succeed, to try again from. */
@Component({
  selector: 'app-sign-in-failed',
  imports: [RouterLink],
  templateUrl: './failed.html',
})
export class SignInFailed {
  /** The page the sign-in started from, to return to once it succeeds (FR-AUTH-05). */
  readonly returnTo = input<string | undefined>(undefined, { alias: 'return_to' });

  protected readonly tryAgain = computed(() => signInUrl(this.returnTo() ?? '/'));
}
