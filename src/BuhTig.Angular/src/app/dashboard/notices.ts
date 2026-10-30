import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Clock } from '../format/clock';
import { relativeTime, timeUntil } from '../format/format';
import { Icon } from '../icon/icon';
import { Session, signInUrl } from '../session/session';
import {
  AUTHORIZE_SSO,
  AUTHORIZE_TOKEN,
  REPLACE_BEFORE,
  REPLACE_TOKEN,
  SIGN_IN_FOR_FRESH,
  SSO_REQUIRED,
  TOKEN_REFUSED,
  TOKEN_REJECTED,
  heldData,
  staleData,
  tokenExpires,
} from './messages';
import { Denied, Stale } from './resources';

/** FR-PAT-10: how long before a token expires the user is reminded to replace it. */
const EXPIRY_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What a dashboard says above its head, when there is something to say: that GitHub no longer
 * accepts the user's personal access token (FR-PAT-07), or that it expires within 7 days
 * (FR-PAT-10); that the data is saved data, and why (FR-DATA-05); and why GitHub keeps the
 * resource from the viewer's credential, and how to get access (FR-PAT-08). Each says what to
 * do, and is marked by its icon as well as by its color (NFR-UX-05).
 */
@Component({
  selector: 'app-notices',
  imports: [Icon, RouterLink],
  template: `
    @switch (token()) {
      @case ('invalid') {
        <div class="notice crit" role="alert">
          <app-icon name="alert" />
          <div class="grow">
            {{ TOKEN_REJECTED }} <a routerLink="/-/settings">{{ REPLACE_TOKEN }}</a>
          </div>
        </div>
      }
      @case ('expiring') {
        <div class="notice" role="status">
          <app-icon name="clock" />
          <div class="grow">
            {{ expiry() }} <a routerLink="/-/settings">{{ REPLACE_BEFORE }}</a>
          </div>
        </div>
      }
    }
    @if (age(); as age) {
      @if (stale() === 'held') {
        <div class="notice warn" role="status">
          <app-icon name="gauge" />
          <div class="grow">
            {{ heldData(age) }} <a [href]="signIn()">{{ SIGN_IN_FOR_FRESH }}</a>
          </div>
        </div>
      } @else {
        <div class="notice warn" role="status">
          <app-icon name="cloudoff" />
          <div class="grow">{{ staleData(age) }}</div>
        </div>
      }
    }
    @if (denied(); as denied) {
      <div class="notice warn" role="alert">
        <app-icon name="lock" />
        <div class="grow">
          @if (denied.reason === 'sso') {
            {{ SSO_REQUIRED }}
            @if (denied.url; as url) {
              <a [href]="url">{{ AUTHORIZE_SSO }}</a>
            } @else {
              <a href="https://github.com/settings/tokens">{{ AUTHORIZE_TOKEN }}</a>
            }
          } @else {
            {{ TOKEN_REFUSED }} <a routerLink="/-/settings">{{ REPLACE_TOKEN }}</a>
          }
        </div>
      </div>
    }
  `,
  styles: ':host { display: block; }',
})
export class Notices {
  private readonly session = inject(Session);
  private readonly clock = inject(Clock);
  private readonly router = inject(Router);

  readonly stale = input<Stale | undefined>(undefined);
  /** When the data shown was fetched from GitHub. */
  readonly fetchedAt = input<Date | undefined>(undefined);
  readonly denied = input<Denied | undefined>(undefined);

  /** What to tell the user of their token, if anything. */
  protected readonly token = computed(() => {
    const token = this.session.token();
    if (!token) {
      return undefined;
    }
    if (token.status === 'invalid') {
      return 'invalid';
    }
    const expiresAt = token.expiresAt;
    return expiresAt && expiresAt.getTime() - this.clock.now() <= EXPIRY_NOTICE_MS
      ? 'expiring'
      : undefined;
  });

  protected readonly expiry = computed(() => {
    const expiresAt = this.session.token()?.expiresAt;
    return expiresAt ? tokenExpires(timeUntil(expiresAt, this.clock.now())) : '';
  });

  /** How old the saved data is, if it is saved data. */
  protected readonly age = computed(() => {
    const fetchedAt = this.fetchedAt();
    return this.stale() && fetchedAt ? relativeTime(fetchedAt, this.clock.now()) : undefined;
  });

  protected signIn(): string {
    return signInUrl(this.router.url);
  }

  protected readonly heldData = heldData;
  protected readonly staleData = staleData;
  protected readonly TOKEN_REJECTED = TOKEN_REJECTED;
  protected readonly REPLACE_TOKEN = REPLACE_TOKEN;
  protected readonly REPLACE_BEFORE = REPLACE_BEFORE;
  protected readonly SIGN_IN_FOR_FRESH = SIGN_IN_FOR_FRESH;
  protected readonly SSO_REQUIRED = SSO_REQUIRED;
  protected readonly AUTHORIZE_SSO = AUTHORIZE_SSO;
  protected readonly AUTHORIZE_TOKEN = AUTHORIZE_TOKEN;
  protected readonly TOKEN_REFUSED = TOKEN_REFUSED;
}
