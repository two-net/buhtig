import { Component, input, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Account } from '../account/account';
import { Icon } from '../icon/icon';
import { RecentRepository } from '../recent/recent';
import { Search } from '../search/search';
import { Surprise } from '../surprise/surprise';
import { Wordmark } from '../wordmark/wordmark';
import { FEATURES, HEADLINE, LEDE, NOT_AFFILIATED, TRY } from './messages';

/**
 * The visitor's home page (UI-02): BuhTig's wordmark, what it does, and the search box with "Show
 * dashboard", repositories to try that others opened here lately, and "Surprise me"
 * (FR-SRCH-10). Below, what BuhTig shows, and a footer with About and Privacy, which says that
 * BuhTig is not GitHub's (UI-08).
 */
@Component({
  selector: 'app-visitor-home',
  imports: [Account, Icon, RouterLink, Search, Surprise, Wordmark],
  template: `
    <header class="site-hdr">
      <a class="brandmark" routerLink="/" aria-label="BuhTig home">BuhTig</a>
      <nav aria-label="Site">
        <a routerLink="/-/about">About</a>
        <a routerLink="/-/privacy">Privacy</a>
      </nav>
      <div class="hdr-right"><app-account /></div>
    </header>
    <main id="main" tabindex="-1">
      <section class="hero" aria-labelledby="hero-title">
        <app-wordmark [play]="entrance()" />
        <h1 id="hero-title">{{ HEADLINE }}</h1>
        <p class="lede">{{ LEDE }}</p>
        <div class="hero-form">
          <app-search variant="hero" [focusOnDesktop]="true" />
        </div>
        <div class="hero-more">
          @if (tries().length > 0) {
            <span>{{ TRY }}</span>
            @for (repository of tries(); track repository.name) {
              <a [routerLink]="'/' + repository.name">{{ repository.name }}</a>
            }
          }
          <app-surprise />
        </div>
      </section>
      <section class="features" aria-label="What BuhTig shows">
        @for (feature of FEATURES; track feature.title) {
          <div class="feature">
            <div class="f-icon"><app-icon [name]="feature.icon" /></div>
            <h2>{{ feature.title }}</h2>
            <p>{{ feature.text }}</p>
          </div>
        }
      </section>
    </main>
    <footer class="site-foot">
      <span class="brandmark" aria-hidden="true">BuhTig</span>
      <nav aria-label="About BuhTig">
        <a routerLink="/-/about">About</a>
        <a routerLink="/-/privacy">Privacy</a>
      </nav>
      <span>{{ NOT_AFFILIATED }}</span>
    </footer>
  `,
})
export class VisitorHome {
  /** What others opened here lately, once known. */
  readonly recent = input<RecentRepository[] | undefined>(undefined);
  /** Whether the wordmark makes its entrance. */
  readonly entrance = input(false);

  readonly search = viewChild.required(Search);

  /** The 3 repositories opened here last, to try. */
  protected tries(): RecentRepository[] {
    return (this.recent() ?? []).slice(0, 3);
  }

  protected readonly HEADLINE = HEADLINE;
  protected readonly LEDE = LEDE;
  protected readonly TRY = TRY;
  protected readonly FEATURES = FEATURES;
  protected readonly NOT_AFFILIATED = NOT_AFFILIATED;
}
