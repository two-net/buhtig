import { Component, input, output, signal } from '@angular/core';
import { CompareDialog } from '../compare/dialog';
import { COMPARE_WITH } from '../compare/messages';
import { RelativeTime } from '../format/relative-time';
import { Icon } from '../icon/icon';
import { Known } from '../search/parse';
import { OPEN_ON_GITHUB, UPDATED } from './messages';
import { Pin } from './pin';
import { Refresh } from './refresh';

/**
 * What a dashboard's head offers beside its resource: when its data was fetched (FR-DATA-06),
 * Refresh and Pin for signed-in users (FR-DATA-07, FR-PERS-02), "Compare with…", which asks what
 * to compare it with (FR-CMP-02), and its page on GitHub.
 */
@Component({
  selector: 'app-head-actions',
  imports: [CompareDialog, Icon, Pin, Refresh, RelativeTime],
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
      <a class="btn sm" [href]="'https://github.com' + path()">
        <app-icon name="external" />{{ OPEN_ON_GITHUB }}
      </a>
    </div>
    @if (comparing()) {
      <app-compare-dialog [from]="resource()" (closed)="comparing.set(false)" />
    }
  `,
  styles: ':host { display: contents; }',
})
export class HeadActions {
  /** The dashboard's resource, with the names as GitHub spells them. */
  readonly resource = input.required<Known>();
  /** The resource's path on GitHub, such as `/owner/repo`. */
  readonly path = input.required<string>();
  readonly fetchedAt = input<Date | undefined>(undefined);
  readonly refreshed = output();

  /** Whether the user is asked what to compare the resource with. */
  protected readonly comparing = signal(false);

  protected readonly UPDATED = UPDATED;
  protected readonly OPEN_ON_GITHUB = OPEN_ON_GITHUB;
  protected readonly COMPARE_WITH = COMPARE_WITH;
}
