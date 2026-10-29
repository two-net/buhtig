import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Session, signInUrl } from '../session/session';
import {
  ADD_TOKEN,
  ADD_TOKEN_TO_SEE,
  GO_HOME,
  NOT_FOUND_OR_PRIVATE,
  NO_SUCH_NAME,
  REPLACE_TOKEN,
  SIGN_IN,
  SIGN_IN_TO_SEE,
  TOKEN_INVALID_TO_SEE,
  invalidName,
  notFound,
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
  imports: [RouterLink],
  template: `
    @if (invalid()) {
      <h1>{{ NO_SUCH_NAME }}</h1>
      <p>{{ invalidName(name()) }}</p>
      <p>
        <a routerLink="/">{{ GO_HOME }}</a>
      </p>
    } @else {
      <h1>{{ NOT_FOUND_OR_PRIVATE }}</h1>
    }
    @switch (invalid() ? undefined : viewer()) {
      @case ('visitor') {
        <p>{{ notFound(name()) }} {{ SIGN_IN_TO_SEE }}</p>
        <p>
          <a class="action" [href]="signIn">{{ SIGN_IN }}</a>
        </p>
      }
      @case ('signed-in') {
        <p>{{ notFound(name()) }} {{ ADD_TOKEN_TO_SEE }}</p>
        <p>
          <a class="action" routerLink="/-/settings">{{ ADD_TOKEN }}</a>
        </p>
      }
      @case ('token-invalid') {
        <p>{{ notFound(name()) }} {{ TOKEN_INVALID_TO_SEE }}</p>
        <p>
          <a class="action" routerLink="/-/settings">{{ REPLACE_TOKEN }}</a>
        </p>
      }
      @case ('token-user') {
        <p>{{ notFoundWithToken(name()) }}</p>
        <p>
          <a routerLink="/">{{ GO_HOME }}</a>
        </p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 40rem;
    }

    .action {
      display: inline-block;
      padding: 0.5rem 1.25rem;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--text);
      text-decoration: none;
    }

    .action:hover {
      background: var(--raised);
    }
  `,
})
export class NotFoundOrPrivate {
  private readonly session = inject(Session);

  /** The resource's name, as the URL has it. */
  readonly name = input.required<string>();
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

  /** Signing in returns to this page (FR-AUTH-05). */
  protected readonly signIn = signInUrl(inject(Router).url);

  protected readonly invalidName = invalidName;
  protected readonly NO_SUCH_NAME = NO_SUCH_NAME;
  protected readonly notFound = notFound;
  protected readonly notFoundWithToken = notFoundWithToken;
  protected readonly NOT_FOUND_OR_PRIVATE = NOT_FOUND_OR_PRIVATE;
  protected readonly SIGN_IN_TO_SEE = SIGN_IN_TO_SEE;
  protected readonly SIGN_IN = SIGN_IN;
  protected readonly ADD_TOKEN_TO_SEE = ADD_TOKEN_TO_SEE;
  protected readonly ADD_TOKEN = ADD_TOKEN;
  protected readonly TOKEN_INVALID_TO_SEE = TOKEN_INVALID_TO_SEE;
  protected readonly REPLACE_TOKEN = REPLACE_TOKEN;
  protected readonly GO_HOME = GO_HOME;
}
