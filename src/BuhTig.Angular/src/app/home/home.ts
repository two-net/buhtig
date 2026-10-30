import { Component, inject, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, RouterLink, Router } from '@angular/router';
import { filter } from 'rxjs';
import { Account } from '../account/account';
import { Glide } from '../motion/glide';
import { Motion } from '../motion/motion';
import { Search } from '../search/search';
import { Shortcuts } from '../shortcuts/shortcuts';
import { Surprise } from '../surprise/surprise';
import { Wordmark } from '../wordmark/wordmark';

/**
 * The home page, after a search engine's (§3.1): the wordmark, the search box with "Surprise
 * me" (FR-SRCH-10), and the signed-in user's shortcuts, with "Sign in" or the avatar menu above
 * and links to About and Privacy below (UI-02, UI-08).
 *
 * The wordmark makes an entrance on the first home page of a browser session (FR-ANIM-01). As
 * the page gives way to a dashboard, by whichever way it is opened, the search box glides into
 * the dashboard's header from where it is here (FR-ANIM-03).
 */
@Component({
  selector: 'app-home',
  imports: [Account, RouterLink, Search, Shortcuts, Surprise, Wordmark],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  /** The search box, once the page has been shown. */
  private readonly search = viewChild(Search);

  protected readonly entrance = isFirstOfSession() && inject(Motion).full();

  constructor() {
    const glide = inject(Glide);
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const search = this.search();
        if (search !== undefined) {
          glide.leave(event.id, search.bounds());
        }
      });
  }
}

/** What the browser session keeps once its first home page has been shown. */
const ENTERED = 'buhtig.entered';

/** Whether the first home page has been shown, where the session's storage cannot say. */
let entered = false;

/**
 * Whether this is the browser session's first home page, which it notes. The session's storage
 * may be unavailable, as in a private window, or full; then it is the first of the page load.
 */
function isFirstOfSession(): boolean {
  const first = !entered;
  entered = true;
  try {
    if (sessionStorage.getItem(ENTERED) !== null) {
      return false;
    }
    sessionStorage.setItem(ENTERED, '');
    return true;
  } catch {
    return first;
  }
}
