import { Component, input, output } from '@angular/core';
import { RelativeTime } from '../format/relative-time';
import { Icon } from '../icon/icon';
import { Resource } from '../search/parse';
import { OPEN_ON_GITHUB, UPDATED } from './messages';
import { Pin } from './pin';
import { Refresh } from './refresh';

/**
 * What a dashboard's head offers beside its resource: when its data was fetched (FR-DATA-06),
 * Refresh and Pin for signed-in users (FR-DATA-07, FR-PERS-02), and its page on GitHub.
 */
@Component({
  selector: 'app-head-actions',
  imports: [Icon, Pin, Refresh, RelativeTime],
  template: `
    <div class="actions">
      <div class="freshness">
        @if (fetchedAt(); as fetchedAt) {
          <span>{{ UPDATED }} <app-relative-time [value]="fetchedAt" /></span>
        }
        <app-refresh [resource]="resource()" (refreshed)="refreshed.emit()" />
      </div>
      <app-pin [resource]="resource()" />
      <a class="btn sm" [href]="'https://github.com' + path()">
        <app-icon name="external" />{{ OPEN_ON_GITHUB }}
      </a>
    </div>
  `,
  styles: ':host { display: contents; }',
})
export class HeadActions {
  /** The dashboard's resource, with the names as GitHub spells them. */
  readonly resource = input.required<Resource>();
  /** The resource's path on GitHub, such as `/owner/repo`. */
  readonly path = input.required<string>();
  readonly fetchedAt = input<Date | undefined>(undefined);
  readonly refreshed = output();

  protected readonly UPDATED = UPDATED;
  protected readonly OPEN_ON_GITHUB = OPEN_ON_GITHUB;
}
