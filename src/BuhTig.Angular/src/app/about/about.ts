import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Shortcut } from '../search/shortcut';
import { Wordmark } from '../wordmark/wordmark';

/**
 * What BuhTig is, and that it is not GitHub's (§1.2, UI-08). It names the keys that BuhTig
 * answers to, and lets the user turn `/` off (WCAG 2.1.4). It is open to everyone, even in
 * private mode (FR-ACC-03), so that everyone can.
 */
@Component({
  selector: 'app-about',
  imports: [RouterLink, Wordmark],
  templateUrl: './about.html',
  styleUrl: './about.css',
})
export class About {
  private readonly shortcut = inject(Shortcut);

  protected readonly slash = this.shortcut.enabled;

  protected setSlash(on: boolean): void {
    this.shortcut.set(on);
  }
}
