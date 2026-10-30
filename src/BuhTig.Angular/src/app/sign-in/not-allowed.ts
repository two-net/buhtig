import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Center } from '../center/center';
import { Header } from '../header/header';

/**
 * Where sign-in ends for a GitHub account that `access.allowed_users` does not list, which gets
 * no session (FR-AUTH-08).
 */
@Component({
  selector: 'app-not-allowed',
  imports: [Center, Header, RouterLink],
  templateUrl: './not-allowed.html',
})
export class NotAllowed {
  protected readonly text =
    "The GitHub account you signed in with isn't allowed on this instance of BuhTig. If you " +
    'think it should be, ask the person who runs this instance to add it. To sign in with ' +
    'another GitHub account, sign out of GitHub first.';
}
