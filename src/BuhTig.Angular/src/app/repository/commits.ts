import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Avatar } from '../avatar/avatar';
import { RepositoryData } from '../dashboard/data';
import { repositoryTabPath } from '../dashboard/tabs';
import { RelativeTime } from '../format/relative-time';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { NO_COMMITS, NO_MESSAGE, SEE_ACTIVITY } from './messages';

/**
 * The latest commits on a repository's default branch, `limit` of them (FR-REPO-07): the first
 * line of each message, its author and when it was committed, and its short SHA, each linking to
 * the commit on GitHub (FR-REPO-12). They come in one after another (FR-ANIM-08).
 */
@Component({
  selector: 'app-repository-commits',
  imports: [Avatar, Loaded, RelativeTime, RouterLink, Widget],
  template: `
    <app-widget
      heading="Recent commits"
      [empty]="NO_COMMITS"
      emptyIcon="code"
      skeleton="list"
      [flush]="true"
    >
      <ng-template [appLoaded]="commits" let-commits>
        <ul class="rows stagger" aria-label="Commits">
          @for (commit of commits.slice(0, limit()); track commit.sha) {
            <li [style.--i]="$index">
              <div class="t">
                @if (commit.url; as url) {
                  <a class="ttl" [href]="url">{{ commit.message ?? NO_MESSAGE }}</a>
                } @else {
                  <span class="ttl">{{ commit.message ?? NO_MESSAGE }}</span>
                }
                <div class="m">
                  @if (commit.author; as author) {
                    <span class="who">
                      <app-avatar
                        [name]="author"
                        [src]="commit.authorAvatarUrl"
                        [size]="16"
                        [round]="true"
                      />
                      <strong>{{ author }}</strong>
                    </span>
                  }
                  @if (commit.committedAt; as committedAt) {
                    <span>committed <app-relative-time [value]="committedAt" /></span>
                  }
                </div>
              </div>
              @if (commit.url; as url) {
                <a
                  class="sha"
                  [href]="url"
                  [attr.aria-label]="'Commit ' + commit.sha.slice(0, 7)"
                  >{{ commit.sha.slice(0, 7) }}</a
                >
              } @else {
                <span class="sha">{{ commit.sha.slice(0, 7) }}</span>
              }
            </li>
          }
        </ul>
      </ng-template>
      @if (footer()) {
        <div class="Box-footer" footer>
          <a [routerLink]="activityLink()">{{ SEE_ACTIVITY }}</a>
        </div>
      }
    </app-widget>
  `,
})
export class RepositoryCommits {
  private readonly data = inject(RepositoryData);

  /** How many to list, of the 10 the server gives. */
  readonly limit = input(10);
  /** Whether a link to the Activity tab goes below them. */
  readonly footer = input(false);

  protected readonly commits = emptyWhen(this.data.commits(), (commits) => commits.length === 0);
  protected readonly activityLink = computed(() => repositoryTabPath(this.data.name(), 'activity'));

  protected readonly NO_COMMITS = NO_COMMITS;
  protected readonly NO_MESSAGE = NO_MESSAGE;
  protected readonly SEE_ACTIVITY = SEE_ACTIVITY;
}
