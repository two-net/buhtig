import { Component, computed, input, output } from '@angular/core';
import { Avatar } from '../avatar/avatar';
import { HeadActions } from '../dashboard/head-actions';
import { User } from '../dashboard/resources';
import { CompactNumber } from '../format/compact-number';
import { exactDay, exactTime } from '../format/format';
import { Icon } from '../icon/icon';
import { Known } from '../search/parse';
import { COMPANY, FOLLOWING, JOINED, followersLabelOf } from './messages';

/**
 * A user's head (FR-USER-01): their avatar, round as people's are, the name they go by and their
 * login, their bio, how many follow them and they follow, their company, location and website,
 * and since when they are on GitHub. Then when their data was fetched, Refresh and Pin, and their
 * page on GitHub. All they say is shown as plain text (NFR-SEC-03).
 */
@Component({
  selector: 'app-user-head',
  imports: [Avatar, CompactNumber, HeadActions, Icon],
  template: `
    @let shown = user();
    <div class="orghead">
      <app-avatar
        class="org-av user-av"
        [name]="shown.login"
        [src]="shown.avatarUrl"
        [size]="100"
        [round]="true"
      />
      <div class="oh-main">
        <div class="oh-title">
          <h1>{{ shown.displayName ?? shown.login }}</h1>
          @if (shown.displayName) {
            <span class="login">{{ shown.login }}</span>
          }
        </div>
        @if (shown.bio; as bio) {
          <p class="oh-desc">{{ bio }}</p>
        }
        <div class="rmeta">
          <span
            ><app-icon name="people" /><strong
              ><app-compact-number [value]="shown.followers" /></strong
            >{{ followersLabelOf(shown.followers) }}</span
          >
          <span
            ><strong><app-compact-number [value]="shown.following" /></strong>{{ FOLLOWING }}</span
          >
          @if (shown.company; as company) {
            <span
              ><app-icon name="org" /><span class="sr">{{ COMPANY }}: </span>{{ company }}</span
            >
          }
          @if (shown.location; as location) {
            <span><app-icon name="location" />{{ location }}</span>
          }
          @if (shown.website; as website) {
            <a [href]="website"><app-icon name="link" />{{ bare(website) }}</a>
          }
          @if (shown.createdAt; as createdAt) {
            <span
              ><app-icon name="calendar" />{{ JOINED }}
              <time [attr.datetime]="createdAt.toISOString()" [title]="exactTime(createdAt)">{{
                exactDay(createdAt)
              }}</time></span
            >
          }
        </div>
      </div>
      <app-head-actions
        [resource]="resource()"
        [path]="'/' + shown.login"
        [fetchedAt]="fetchedAt()"
        [shareable]="true"
        (refreshed)="refreshed.emit()"
      />
    </div>
  `,
  styles: `
    .user-av {
      border-radius: 50%;
    }
    .org-av ::ng-deep .av {
      width: 100%;
      height: 100%;
      border-radius: inherit;
    }
    .login {
      color: var(--fg-muted);
      font-size: 20px;
      font-weight: 300;
      line-height: 1.25;
    }
  `,
})
export class UserHead {
  readonly user = input.required<User>();
  readonly fetchedAt = input<Date | undefined>(undefined);
  readonly refreshed = output();

  protected readonly resource = computed((): Known => ({ kind: 'user', login: this.user().login }));

  /** A URL without its scheme or trailing slash, as GitHub shows websites. */
  protected bare(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  protected readonly exactDay = exactDay;
  protected readonly exactTime = exactTime;
  protected readonly followersLabelOf = followersLabelOf;
  protected readonly FOLLOWING = FOLLOWING;
  protected readonly JOINED = JOINED;
  protected readonly COMPANY = COMPANY;
}
