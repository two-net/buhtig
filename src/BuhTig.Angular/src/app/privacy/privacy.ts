import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** What BuhTig keeps, why, and for how long (NFR-PRIV-03). */
@Component({
  selector: 'app-privacy',
  imports: [RouterLink],
  templateUrl: './privacy.html',
})
export class Privacy {}
