import { Component, inject } from '@angular/core';
import { Avatar } from '../avatar/avatar';
import { OrganizationData } from '../dashboard/data';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { NO_MEMBERS, moreMembers } from './messages';

/**
 * An organization's People tab (FR-ORG-07): up to 24 of the members the viewer may see, each
 * linking to their profile on GitHub, and how many more there are.
 */
@Component({
  selector: 'app-organization-people',
  imports: [Avatar, Loaded, Widget],
  template: `
    <div class="stack-v">
      <app-widget heading="People" [empty]="NO_MEMBERS" emptyIcon="people" skeleton="list">
        <ng-template [appLoaded]="members" let-members>
          <ul class="people-grid stagger">
            @for (member of members.members; track member.login) {
              <li [style.--i]="$index">
                <a [href]="member.url ?? 'https://github.com/' + member.login">
                  <app-avatar
                    [name]="member.login"
                    [src]="member.avatarUrl"
                    [size]="40"
                    [round]="true"
                  />&#64;{{ member.login }}
                </a>
              </li>
            }
          </ul>
          @if (members.count > members.members.length) {
            <p class="count-note">{{ moreMembers(members.count - members.members.length) }}</p>
          }
        </ng-template>
      </app-widget>
    </div>
  `,
})
export class OrganizationPeople {
  protected readonly members = emptyWhen(
    inject(OrganizationData).members(),
    (members) => members.members.length === 0,
  );

  protected readonly moreMembers = moreMembers;
  protected readonly NO_MEMBERS = NO_MEMBERS;
}
