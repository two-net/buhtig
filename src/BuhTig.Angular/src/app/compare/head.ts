import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Avatar } from '../avatar/avatar';
import { OPEN_ON_GITHUB, UPDATED } from '../dashboard/messages';
import { Notices } from '../dashboard/notices';
import { Summary } from '../dashboard/resources';
import { RelativeTime } from '../format/relative-time';
import { Icon } from '../icon/icon';
import { VISIBILITY } from '../repository/head';
import { KINDS } from '../search/messages';

/** What a side's head shows of its resource, whatever its kind. */
interface Shown {
  /** The login of the account that its avatar is of. */
  login: string;
  avatarUrl: string | undefined;
  /** What it is, such as "Public", a repository's visibility, or "Organization". */
  badge: string;
  /** Whether its avatar is round, as a user's and a repository owner's, or not, as an organization's. */
  round: boolean;
  description: string | undefined;
}

/**
 * One side of a comparison, above its figures: its avatar, its name, which leads to its
 * dashboard, what it is, its description, when its data was fetched (FR-DATA-06) and its page on
 * GitHub. Above them, what there is to say of its data, as on its dashboard: that it is saved
 * data (FR-DATA-05), or that GitHub keeps it from the viewer, and how to get access (FR-PAT-08).
 * A comparison has no Refresh or Pin: it is no dashboard (FR-CMP-05).
 */
@Component({
  selector: 'app-compare-head',
  imports: [Avatar, Icon, Notices, RelativeTime, RouterLink],
  template: `
    <section class="cmp-side" [attr.aria-label]="name()">
      @if (summary(); as summary) {
        <app-notices
          [stale]="summary.stale"
          [fetchedAt]="summary.fetchedAt"
          [denied]="summary.denied"
          [tokenNotices]="tokenNotices()"
        />
        @if (shown(); as shown) {
          <div class="cmp-who">
            <app-avatar
              [name]="shown.login"
              [src]="shown.avatarUrl"
              [size]="24"
              [round]="shown.round"
            />
            <a class="cmp-name" [routerLink]="'/' + name()">{{ name() }}</a>
            <span class="label">{{ shown.badge }}</span>
          </div>
          @if (shown.description; as description) {
            <p class="cmp-desc">{{ description }}</p>
          }
          <div class="cmp-meta">
            @if (summary.fetchedAt; as fetchedAt) {
              <span>{{ UPDATED }} <app-relative-time [value]="fetchedAt" /></span>
            }
            <a class="btn sm" [href]="'https://github.com/' + name()">
              <app-icon name="external" />{{ OPEN_ON_GITHUB }}
            </a>
          </div>
        } @else {
          <div class="cmp-who">
            <span class="cmp-name">{{ name() }}</span>
          </div>
        }
      } @else {
        <div aria-hidden="true"><span class="skel block cmp-head-skel"></span></div>
      }
    </section>
  `,
  styles: ':host { display: block; min-width: 0; }',
})
export class CompareHead {
  /** What BuhTig knows of the side's resource, once it says. */
  readonly summary = input.required<Summary | undefined>();
  /** Its name, as GitHub spells it once known, such as `owner/repo`. */
  readonly name = input.required<string>();
  /** Whether it says what there is to say of the user's token, as only one side does. */
  readonly tokenNotices = input(true);

  protected readonly shown = computed((): Shown | undefined => {
    const summary = this.summary();
    if (summary?.repository) {
      const repository = summary.repository;
      return {
        login: repository.name.split('/')[0],
        avatarUrl: repository.ownerAvatarUrl,
        badge: VISIBILITY[repository.visibility],
        round: true,
        description: repository.description,
      };
    }
    if (summary?.organization) {
      const organization = summary.organization;
      return {
        login: organization.login,
        avatarUrl: organization.avatarUrl,
        badge: KINDS.organization,
        round: false,
        description: organization.description,
      };
    }
    if (summary?.user) {
      const user = summary.user;
      return {
        login: user.login,
        avatarUrl: user.avatarUrl,
        badge: KINDS.user,
        round: true,
        description: user.bio,
      };
    }
    return undefined;
  });

  protected readonly UPDATED = UPDATED;
  protected readonly OPEN_ON_GITHUB = OPEN_ON_GITHUB;
}
