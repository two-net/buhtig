import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Wordmark } from '../wordmark/wordmark';

/** What BuhTig keeps, why, for how long, and how to delete it (NFR-PRIV-03). */
@Component({
  selector: 'app-privacy',
  imports: [RouterLink, Wordmark],
  templateUrl: './privacy.html',
})
export class Privacy {}
