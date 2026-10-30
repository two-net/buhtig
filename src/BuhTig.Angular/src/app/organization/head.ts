import { Component, computed, inject, input, output } from '@angular/core';
import { Avatar } from '../avatar/avatar';
import { OrganizationData } from '../dashboard/data';
import { HeadActions } from '../dashboard/head-actions';
import { Organization } from '../dashboard/resources';
import { exactDay, exactNumber, exactTime } from '../format/format';
import { Icon } from '../icon/icon';
import { Resource } from '../search/parse';
import { ON_GITHUB_SINCE, VERIFIED, membersLabelOf } from './messages';

/**
 * An organization's head (FR-ORG-01): its avatar, display name and a badge when GitHub has
 * verified it, its description, how many members the viewer may see, its location and website,
 * and since when it is on GitHub. Then when its data was fetched, Refresh and Pin, and its page
 * on GitHub.
 */
@Component({
  selector: 'app-organization-head',
  imports: [Avatar, HeadActions, Icon],
  template: `
    @let shown = organization();
    <div class="orghead">
      <app-avatar class="org-av" [name]="shown.login" [src]="shown.avatarUrl" [size]="100" />
      <div class="oh-main">
        <div class="oh-title">
          <h1>{{ shown.displayName ?? shown.login }}</h1>
          @if (shown.verified) {
            <span class="label success"><app-icon name="verified" />{{ VERIFIED }}</span>
          }
        </div>
        @if (shown.description; as description) {
          <p class="oh-desc">{{ description }}</p>
        }
        <div class="rmeta">
          @if (members(); as members) {
            <span
              ><app-icon name="people" /><strong>{{ exactNumber(members.count) }}</strong
              >{{ membersLabelOf(members.count) }}</span
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
              ><app-icon name="calendar" />{{ ON_GITHUB_SINCE }}
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
        (refreshed)="refreshed.emit()"
      />
    </div>
  `,
  styles: '.org-av ::ng-deep .av { width: 100%; height: 100%; border-radius: inherit; }',
})
export class OrganizationHead {
  private readonly membersLoader = inject(OrganizationData).members();

  readonly organization = input.required<Organization>();
  readonly fetchedAt = input<Date | undefined>(undefined);
  readonly refreshed = output();

  protected readonly resource = computed((): Resource => ({
    kind: 'organization',
    org: this.organization().login,
  }));

  protected readonly members = computed(() => {
    const state = this.membersLoader.state();
    return state.status === 'ready' ? state.data : undefined;
  });

  /** A URL without its scheme or trailing slash, as GitHub shows websites. */
  protected bare(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  protected readonly exactNumber = exactNumber;
  protected readonly exactDay = exactDay;
  protected readonly exactTime = exactTime;
  protected readonly membersLabelOf = membersLabelOf;
  protected readonly ON_GITHUB_SINCE = ON_GITHUB_SINCE;
  protected readonly VERIFIED = VERIFIED;
}
