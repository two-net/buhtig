import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** A page of BuhTig's own, under `/-/`, that does not exist (FR-NAV-03). */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  templateUrl: './not-found.html',
})
export class NotFound {}
