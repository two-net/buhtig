import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Wordmark } from '../wordmark/wordmark';

/**
 * Where sign-in ends for a GitHub account that `access.allowed_users` does not list, which gets
 * no session (FR-AUTH-08).
 */
@Component({
  selector: 'app-not-allowed',
  imports: [RouterLink, Wordmark],
  templateUrl: './not-allowed.html',
})
export class NotAllowed {}
