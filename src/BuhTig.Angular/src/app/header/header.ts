import { Component, input, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Account } from '../account/account';
import { Search } from '../search/search';

/** A step of the breadcrumbs, such as a repository's owner. */
export interface Crumb {
  label: string;
  /** The path it leads to. */
  link: string;
}

/**
 * The header of every page but the visitor's home page (UI-03): the wordmark, leading home, the
 * breadcrumbs of a dashboard, the search box, filled in with the dashboard's resource, and "Sign
 * in" or the avatar menu. A dashboard's tabs go below, as its content.
 */
@Component({
  selector: 'app-header',
  imports: [Account, RouterLink, Search],
  template: `
    <header class="app-hdr">
      <div class="hdr-bar">
        <a class="brandmark" routerLink="/" aria-label="BuhTig home">BuhTig</a>
        @if (crumbs().length > 0) {
          <nav class="crumbs" aria-label="Breadcrumb">
            @for (crumb of crumbs(); track crumb.link; let first = $first) {
              @if (!first) {
                <span class="slash" aria-hidden="true">/</span>
              }
              <a [routerLink]="crumb.link">{{ crumb.label }}</a>
            }
          </nav>
        }
        <div class="hdr-search">
          <app-search variant="header" [prefill]="prefill()" [slash]="slash()" />
        </div>
        <div class="hdr-right"><app-account /></div>
      </div>
      <ng-content />
    </header>
  `,
  styles: ':host { display: contents; }',
})
export class Header {
  readonly crumbs = input<Crumb[]>([]);
  /** What the search box holds until the user edits it. */
  readonly prefill = input('');
  /** Whether `/` focuses its search box, unless the page has another. */
  readonly slash = input(true);

  readonly search = viewChild.required(Search);
}
