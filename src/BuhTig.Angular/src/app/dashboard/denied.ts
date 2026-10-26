import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AUTHORIZE_SSO,
  AUTHORIZE_TOKEN,
  REPLACE_TOKEN,
  SSO_REQUIRED,
  THEN_RELOAD,
  TOKEN_REFUSED,
} from './messages';
import { Denied } from './resources';

/**
 * Why GitHub keeps a dashboard's resource from the viewer, and how to get access (FR-PAT-08):
 * by authorizing their access for an organization's single sign-on, or by a token that the
 * organization lets in.
 */
@Component({
  selector: 'app-denied',
  imports: [RouterLink],
  template: `
    @switch (denied().reason) {
      @case ('sso') {
        <p role="alert">
          {{ SSO_REQUIRED }}
          @if (url(); as url) {
            <a [href]="url">{{ AUTHORIZE_SSO }}</a
            >,
          } @else {
            <a href="https://github.com/settings/tokens">{{ AUTHORIZE_TOKEN }}</a
            >,
          }
          {{ THEN_RELOAD }}
        </p>
      }
      @case ('token') {
        <p role="alert">
          {{ TOKEN_REFUSED }} <a routerLink="/-/settings">{{ REPLACE_TOKEN }}</a>
        </p>
      }
    }
  `,
  styles: `
    /* Marked by a bar as well as by its words (NFR-UX-05). */
    p {
      margin: 0 0 1.5rem;
      padding: 0.75rem 1rem;
      border-left: 4px solid var(--accent);
      background: var(--raised);
    }
  `,
})
export class DeniedNotice {
  readonly denied = input.required<Denied>();

  protected url(): string | undefined {
    const denied = this.denied();
    return denied.reason === 'sso' ? denied.url : undefined;
  }

  protected readonly SSO_REQUIRED = SSO_REQUIRED;
  protected readonly AUTHORIZE_SSO = AUTHORIZE_SSO;
  protected readonly AUTHORIZE_TOKEN = AUTHORIZE_TOKEN;
  protected readonly THEN_RELOAD = THEN_RELOAD;
  protected readonly TOKEN_REFUSED = TOKEN_REFUSED;
  protected readonly REPLACE_TOKEN = REPLACE_TOKEN;
}
