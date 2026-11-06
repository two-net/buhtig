import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CompareDialog } from '../compare/dialog';
import { COMPARE_WITH } from '../compare/messages';
import { RelativeTime } from '../format/relative-time';
import { Icon } from '../icon/icon';
import { Known } from '../search/parse';
import { Session } from '../session/session';
import { OPEN_ON_GITHUB, SHARE_CARD, UPDATED } from './messages';
import { Pin } from './pin';
import { Refresh } from './refresh';
import { ShareCard } from './share-card';
import { GITHUB_HOST } from '../github/host';

/**
 * What a dashboard's head offers beside its resource: when its data was fetched (FR-DATA-06),
 * Refresh and Pin for signed-in users (FR-DATA-07, FR-PERS-02), "Compare with…", which asks what
 * to compare it with (FR-CMP-02), "Share card", which offers its card to embed elsewhere, if it is
 * public and BuhTig is (FR-NAV-08), and its page on GitHub.
 */
@Component({
  selector: 'app-head-actions',
  imports: [CompareDialog, Icon, Pin, Refresh, RelativeTime, ShareCard],
  template: `
    <div class="actions">
      <div class="freshness">
        @if (fetchedAt(); as fetchedAt) {
          <span>{{ UPDATED }} <app-relative-time [value]="fetchedAt" /></span>
        }
        <app-refresh [resource]="resource()" (refreshed)="refreshed.emit()" />
      </div>
      <app-pin [resource]="resource()" />
      <button type="button" class="btn sm" (click)="comparing.set(true)">
        <app-icon name="compare" />{{ COMPARE_WITH }}
      </button>
      @if (cardShown()) {
        <button type="button" class="btn sm" (click)="sharing.set(true)">
          <app-icon name="copy" />{{ SHARE_CARD }}
        </button>
      }
      <a class="btn sm" [href]="'https://' + gitHub + path()">
        <app-icon name="external" />{{ OPEN_ON_GITHUB }}
      </a>
    </div>
    @if (comparing()) {
      <app-compare-dialog [from]="resource()" (closed)="comparing.set(false)" />
    }
    @if (sharing()) {
      <app-share-card [resource]="resource()" (closed)="sharing.set(false)" />
    }
  `,
  styles: ':host { display: contents; }',
})
export class HeadActions {
  /** `github.host`, where GitHub's own pages are. */
  protected readonly gitHub = inject(GITHUB_HOST);
  /** The dashboard's resource, with the names as GitHub spells them. */
  readonly resource = input.required<Known>();
  /** The resource's path on GitHub, such as `/owner/repo`. */
  readonly path = input.required<string>();
  readonly fetchedAt = input<Date | undefined>(undefined);
  /** Whether the resource is public, which a card may show (FR-NAV-07). */
  readonly shareable = input(false);
  readonly refreshed = output();

  private readonly session = inject(Session);

  /** Whether the user is asked what to compare the resource with. */
  protected readonly comparing = signal(false);
  /** Whether the resource's card is offered. */
  protected readonly sharing = signal(false);
  /** Whether the resource has a card to share: if it is public, and BuhTig serves cards. */
  protected readonly cardShown = computed(
    () => this.shareable() && this.session.access() === 'public',
  );

  protected readonly UPDATED = UPDATED;
  protected readonly OPEN_ON_GITHUB = OPEN_ON_GITHUB;
  protected readonly COMPARE_WITH = COMPARE_WITH;
  protected readonly SHARE_CARD = SHARE_CARD;
}
