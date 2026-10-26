import { Component, inject, input } from '@angular/core';
import { Resources } from '../dashboard/resources';
import { RelativeTime } from '../format/relative-time';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { PRERELEASE } from './messages';

/**
 * A repository's 5 latest releases (FR-REPO-08), each with its tag, which links to its page on
 * GitHub (FR-REPO-12), its name and its date. Pre-releases are marked, since the stat cards'
 * latest release is never one.
 */
@Component({
  selector: 'app-repository-releases',
  imports: [Loaded, RelativeTime, Widget],
  templateUrl: './releases.html',
  styleUrl: './releases.css',
})
export class RepositoryReleases {
  private readonly resources = inject(Resources);

  /** The repository's names, as the URL has them. */
  readonly owner = input.required<string>();
  readonly repo = input.required<string>();

  protected readonly releases = load(
    () => this.resources.releases(this.owner(), this.repo()),
    (releases) => releases.length === 0,
  );

  protected readonly prerelease = PRERELEASE;
}
