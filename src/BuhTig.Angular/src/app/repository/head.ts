import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Avatar } from '../avatar/avatar';
import { HeadActions } from '../dashboard/head-actions';
import { Repository } from '../dashboard/resources';
import { Icon } from '../icon/icon';
import { Resource } from '../search/parse';

/** What a repository's visibility is called. */
export const VISIBILITY = { public: 'Public', private: 'Private', internal: 'Internal' } as const;

/**
 * A repository's head (FR-REPO-01): the owner's avatar and the repository's name, badges for
 * its visibility, and for Archived and Template, and for Fork, with a link from Fork to the
 * parent's dashboard. Then when its data was fetched, Refresh and Pin, and its page on GitHub.
 */
@Component({
  selector: 'app-repository-head',
  imports: [Avatar, HeadActions, Icon, RouterLink],
  template: `
    @let shown = repository();
    <div class="repohead">
      <div class="title">
        <app-avatar [name]="owner()" [src]="shown.ownerAvatarUrl" [size]="24" [round]="true" />
        <h1>
          <a [routerLink]="'/' + shown.name">{{ repo() }}</a>
        </h1>
        <span class="label">{{ VISIBILITY[shown.visibility] }}</span>
        @if (shown.archived) {
          <span class="label attention"><app-icon name="archive" />Archived</span>
        }
        @if (shown.template) {
          <span class="label"><app-icon name="template" />Template</span>
        }
      </div>
      <app-head-actions
        [resource]="resource()"
        [path]="'/' + shown.name"
        [fetchedAt]="fetchedAt()"
        (refreshed)="refreshed.emit()"
      />
      @if (shown.parent; as parent) {
        <div class="forked">
          <app-icon name="fork" />Forked from <a [routerLink]="'/' + parent">{{ parent }}</a>
        </div>
      } @else if (shown.fork) {
        <div class="forked"><app-icon name="fork" />Fork</div>
      }
    </div>
  `,
})
export class RepositoryHead {
  readonly repository = input.required<Repository>();
  readonly fetchedAt = input<Date | undefined>(undefined);
  readonly refreshed = output();

  protected readonly owner = computed(() => this.repository().name.split('/')[0]);
  protected readonly repo = computed(() => this.repository().name.split('/')[1]);
  protected readonly resource = computed((): Resource => ({
    kind: 'repository',
    owner: this.owner(),
    repo: this.repo(),
  }));

  protected readonly VISIBILITY = VISIBILITY;
}
