import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Wordmark } from '../wordmark/wordmark';

/** A page of BuhTig's own, under `/-/`, that does not exist (FR-NAV-03). */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink, Wordmark],
  templateUrl: './not-found.html',
})
export class NotFound {}
