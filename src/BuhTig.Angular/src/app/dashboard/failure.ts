import { Component, inject, input, output } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Center } from '../center/center';
import { Icon } from '../icon/icon';
import { signInUrl } from '../session/session';
import { Failure } from '../widget/load';
import {
  KEEP_EXPLORING,
  NOTHING_SAVED,
  SEARCH_AGAIN,
  SIGN_IN_WITH_GITHUB,
  TRY_AGAIN,
  TRY_LATER,
  UNAVAILABLE,
  UNREACHABLE,
  VISITORS_HELD,
} from './messages';

/**
 * What a dashboard shows when BuhTig could not load its resource and has none saved to show
 * (FR-DATA-05): the server asks GitHub for no more for visitors for now, so a visitor may sign in
 * (FR-DATA-10); or GitHub, or BuhTig's database, cannot be reached, so the user may try again.
 */
@Component({
  selector: 'app-failure',
  imports: [Center, Icon, RouterLink],
  template: `
    @switch (failure()) {
      @case ('held') {
        <app-center icon="gauge" [heading]="KEEP_EXPLORING" [text]="VISITORS_HELD">
          <div class="row">
            <a class="btn primary" [href]="signIn">{{ SIGN_IN_WITH_GITHUB }}</a>
            <a class="btn" routerLink="/">{{ SEARCH_AGAIN }}</a>
          </div>
        </app-center>
      }
      @case ('unavailable') {
        <app-center icon="cloudoff" [heading]="UNAVAILABLE" [text]="TRY_LATER">
          <div class="row">
            <button type="button" class="btn primary" (click)="retry.emit()">
              <app-icon name="refresh" />{{ TRY_AGAIN }}
            </button>
          </div>
        </app-center>
      }
      @default {
        <app-center icon="cloudoff" [heading]="UNREACHABLE" [text]="NOTHING_SAVED">
          <div class="row">
            <button type="button" class="btn primary" (click)="retry.emit()">
              <app-icon name="refresh" />{{ TRY_AGAIN }}
            </button>
            <a class="btn" routerLink="/">{{ SEARCH_AGAIN }}</a>
          </div>
        </app-center>
      }
    }
  `,
})
export class FailurePage {
  readonly failure = input.required<Failure>();
  readonly retry = output();

  /** Signing in returns to this page (FR-AUTH-05). */
  protected readonly signIn = signInUrl(inject(Router).url);

  protected readonly KEEP_EXPLORING = KEEP_EXPLORING;
  protected readonly VISITORS_HELD = VISITORS_HELD;
  protected readonly SIGN_IN_WITH_GITHUB = SIGN_IN_WITH_GITHUB;
  protected readonly SEARCH_AGAIN = SEARCH_AGAIN;
  protected readonly UNAVAILABLE = UNAVAILABLE;
  protected readonly TRY_LATER = TRY_LATER;
  protected readonly UNREACHABLE = UNREACHABLE;
  protected readonly NOTHING_SAVED = NOTHING_SAVED;
  protected readonly TRY_AGAIN = TRY_AGAIN;
}
