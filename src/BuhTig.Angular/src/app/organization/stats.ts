import { Component, inject, input } from '@angular/core';
import { Resources } from '../dashboard/resources';
import { CompactNumber } from '../format/compact-number';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { NO_LANGUAGE, internalCount, limited, privateCount } from './messages';

/**
 * An organization's stat cards (FR-ORG-02): its repositories, with how many of them are private
 * or internal (FR-ORG-09), their stars, forks, and open issues and pull requests, and their most
 * used primary language. When the organization has more repositories than BuhTig reads, they say
 * that the figures are of those pushed to most recently (FR-ORG-08). They are a widget that spans
 * the grid, which loads and fails apart from the others (FR-REPO-09).
 */
@Component({
  selector: 'app-organization-stats',
  imports: [CompactNumber, Loaded, Widget],
  templateUrl: './stats.html',
  styleUrl: './stats.css',
})
export class OrganizationStats {
  private readonly resources = inject(Resources);

  /** The organization's login, as the URL has it. */
  readonly org = input.required<string>();

  protected readonly stats = load(() => this.resources.organizationStats(this.org()));
  protected readonly noLanguage = NO_LANGUAGE;
  protected readonly privateCount = privateCount;
  protected readonly internalCount = internalCount;
  protected readonly limited = limited;
}
