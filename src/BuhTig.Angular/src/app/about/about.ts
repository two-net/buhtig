import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** What BuhTig is, and that it is not GitHub's (§1.2, UI-08). */
@Component({
  selector: 'app-about',
  imports: [RouterLink],
  templateUrl: './about.html',
})
export class About {}
