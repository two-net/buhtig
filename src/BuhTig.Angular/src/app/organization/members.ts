import { Component, inject, input, signal } from '@angular/core';
import { Resources } from '../dashboard/resources';
import { CompactNumber } from '../format/compact-number';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { membersLabel } from './messages';

/**
 * How many of an organization's members the viewer may see, and up to 24 of their avatars, each
 * linking to the member's profile on GitHub (FR-ORG-07). The avatars sit in a row across the
 * grid, below the repository table. Each shows its member's login as it is pointed at or has
 * focus, until Esc hides it (WCAG 1.4.13).
 */
@Component({
  selector: 'app-organization-members',
  imports: [CompactNumber, Loaded, Widget],
  templateUrl: './members.html',
  styleUrl: './members.css',
})
export class OrganizationMembers {
  private readonly resources = inject(Resources);

  /** The organization's login, as the URL has it. */
  readonly org = input.required<string>();

  protected readonly members = load(
    () => this.resources.members(this.org()),
    ({ count }) => count === 0,
  );

  /** The login of the member whose login Esc hid, until the pointer or focus leaves it. */
  protected readonly dismissed = signal<string | undefined>(undefined);

  protected readonly membersLabel = membersLabel;
}
