import { Component, computed, input } from '@angular/core';
import { Organization } from '../dashboard/resources';
import { RelativeTime } from '../format/relative-time';

/**
 * The head of an organization's dashboard (FR-ORG-01), laid out as a repository's: its avatar,
 * the name it goes by and its login, a badge if GitHub has verified it, and "Open on GitHub";
 * then its description; then where it is, its website, when it was created, and when BuhTig
 * fetched it (FR-DATA-06).
 *
 * The name, from the URL, shows at once, and the rest once the server has said it.
 */
@Component({
  selector: 'app-organization-header',
  imports: [RelativeTime],
  templateUrl: './header.html',
  // The repository's head's look, and what only an organization's has.
  styleUrls: ['../repository/header.css', './header.css'],
})
export class OrganizationHeader {
  /** The organization's login, as the URL has it. */
  readonly name = input.required<string>();
  readonly organization = input<Organization>();
  readonly fetchedAt = input<Date>();

  /** The name the organization goes by, or else its login. */
  protected readonly title = computed(() => this.organization()?.displayName ?? this.name());

  /** Its login beside the name it goes by, unless that is its login. */
  protected readonly login = computed(() => {
    const organization = this.organization();
    return organization?.displayName !== undefined &&
      organization.displayName !== organization.login
      ? organization.login
      : undefined;
  });

  /** The website as people write it, such as `acme.example/blog`. */
  protected readonly site = computed(() =>
    this.organization()
      ?.website?.replace(/^https?:\/\//i, '')
      .replace(/\/$/, ''),
  );
}
