import { Component, inject, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import { Glide } from '../motion/glide';
import { Motion } from '../motion/motion';
import { Recent } from '../recent/recent';
import { Search } from '../search/search';
import { Session } from '../session/session';
import { SignedInHome } from './signed-in';
import { VisitorHome } from './visitor';

/**
 * The home page: for a visitor, BuhTig's wordmark and what it does, around the search box
 * (UI-02); for a signed-in user, their dashboards, the search box, and what others opened on this
 * BuhTig lately (FR-SRCH-08).
 *
 * The wordmark makes an entrance on the first home page of a browser session (FR-ANIM-01). As
 * the page gives way to a dashboard, by whichever way it is opened, the search box glides into
 * the dashboard's header from where it is here (FR-ANIM-03).
 */
@Component({
  selector: 'app-home',
  imports: [SignedInHome, VisitorHome],
  template: `
    @if (user()) {
      <!-- Its code comes once the page knows the user is signed in, as most visitors are not. -->
      @defer (on immediate) {
        <app-signed-in-home #signedIn [recent]="recent()" />
      }
    } @else if (user() === null) {
      <app-visitor-home [recent]="recent()" [entrance]="entrance" />
    }
  `,
})
export class Home {
  protected readonly user = inject(Session).user;
  protected readonly recent = toSignal(inject(Recent).list());
  protected readonly entrance = isFirstOfSession() && inject(Motion).full();

  /** The page, once it has been shown, for its search box. */
  private readonly visitor = viewChild(VisitorHome);
  private readonly signedIn = viewChild<{ search(): Search }>('signedIn');

  constructor() {
    const glide = inject(Glide);
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const search: Search | undefined = (this.visitor() ?? this.signedIn())?.search();
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
