import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Center } from '../center/center';
import { Session, signInUrl } from '../session/session';
import {
  ADD_TOKEN,
  NOT_FOUND_OR_PRIVATE,
  NO_SUCH_NAME,
  REPLACE_TOKEN,
  SEARCH_AGAIN,
  SIGN_IN_WITH_GITHUB,
  TOKEN_SETTINGS,
  invalidName,
  notFoundForSignedIn,
  notFoundForVisitor,
  notFoundWithInvalidToken,
  notFoundWithToken,
} from './messages';

/**
 * What a dashboard shows in place of its resource when GitHub says there is no such resource,
 * which GitHub says too of one that the viewer's credential may not see (FR-ACC-05). So it tells
 * neither apart, and shows nothing of the resource but the name it was opened at. It says what
 * the viewer can do: a visitor can sign in, and a signed-in user can add a personal access token,
 * or replace one that no longer works. A token user's token is what GitHub answered for.
 *
 * When the name cannot be a resource's at all, as in a URL typed by hand, it says so, and that
 * signing in or a token would not help (NFR-UX-06).
 */
@Component({
  selector: 'app-not-found-or-private',
  imports: [Center, RouterLink],
  template: `
    @if (invalid()) {
      <app-center icon="question" [heading]="NO_SUCH_NAME" [text]="invalidName(name())">
        <div class="row">
          <a class="btn" routerLink="/">{{ SEARCH_AGAIN }}</a>
        </div>
      </app-center>
    } @else {
      @switch (viewer()) {
        @case ('visitor') {
          <app-center icon="lock" [heading]="NOT_FOUND" [text]="visitorText()">
            <div class="row">
              <a class="btn primary" [href]="signIn">{{ SIGN_IN_WITH_GITHUB }}</a>
              <a class="btn" routerLink="/">{{ SEARCH_AGAIN }}</a>
            </div>
          </app-center>
        }
        @case ('signed-in') {
          <app-center icon="key" [heading]="NOT_FOUND" [text]="signedInText()">
            <div class="row">
              <a class="btn primary" routerLink="/-/settings">{{ ADD_TOKEN }}</a>
              <a class="btn" routerLink="/">{{ SEARCH_AGAIN }}</a>
            </div>
          </app-center>
        }
        @case ('token-invalid') {
          <app-center icon="key" [heading]="NOT_FOUND" [text]="invalidTokenText()">
            <div class="row">
              <a class="btn primary" routerLink="/-/settings">{{ REPLACE_TOKEN }}</a>
              <a class="btn" routerLink="/">{{ SEARCH_AGAIN }}</a>
            </div>
          </app-center>
        }
        @case ('token-user') {
          <app-center icon="lock" [heading]="NOT_FOUND" [text]="notFoundWithToken(name())">
            <div class="row">
              <a class="btn" routerLink="/-/settings">{{ TOKEN_SETTINGS }}</a>
              <a class="btn" routerLink="/">{{ SEARCH_AGAIN }}</a>
            </div>
          </app-center>
        }
      }
    }
  `,
})
export class NotFoundOrPrivate {
  private readonly session = inject(Session);

  /** The resource's name, as the URL has it. */
  readonly name = input.required<string>();
  /** What the resource is, such as "repository". */
  readonly kind = input.required<string>();
  /** Whether the name cannot be a resource's, as the server says without asking GitHub. */
  readonly invalid = input(false);

  /** Who is viewing, as far as what they can do about it goes, once BuhTig knows. */
  protected readonly viewer = computed(() => {
    const user = this.session.user();
    if (user === undefined) {
      return undefined;
    }
    if (user === null) {
      return 'visitor';
    }
    const token = this.session.token();
    if (!token) {
      return 'signed-in';
    }
    return token.status === 'valid' ? 'token-user' : 'token-invalid';
  });

  protected readonly visitorText = computed(() => notFoundForVisitor(this.kind(), this.name()));
  protected readonly signedInText = computed(() => notFoundForSignedIn(this.kind(), this.name()));
  protected readonly invalidTokenText = computed(() =>
    notFoundWithInvalidToken(this.kind(), this.name()),
  );

  /** Signing in returns to this page (FR-AUTH-05). */
  protected readonly signIn = signInUrl(inject(Router).url);

  protected readonly invalidName = invalidName;
  protected readonly notFoundWithToken = notFoundWithToken;
  protected readonly NO_SUCH_NAME = NO_SUCH_NAME;
  protected readonly NOT_FOUND = NOT_FOUND_OR_PRIVATE;
  protected readonly SIGN_IN_WITH_GITHUB = SIGN_IN_WITH_GITHUB;
  protected readonly ADD_TOKEN = ADD_TOKEN;
  protected readonly REPLACE_TOKEN = REPLACE_TOKEN;
  protected readonly TOKEN_SETTINGS = TOKEN_SETTINGS;
  protected readonly SEARCH_AGAIN = SEARCH_AGAIN;
}
