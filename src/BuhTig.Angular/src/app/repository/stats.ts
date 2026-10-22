import { Component, inject, input } from '@angular/core';
import { Resources } from '../dashboard/resources';
import { CompactNumber } from '../format/compact-number';
import { RelativeTime } from '../format/relative-time';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';

/**
 * A repository's stat cards (FR-REPO-02): its stars, forks, watchers, open issues and open pull
 * requests, and its latest release, which links to its page on GitHub (FR-REPO-12). They are a
 * widget that spans the grid, which loads and fails apart from the others (FR-REPO-09).
 */
@Component({
  selector: 'app-repository-stats',
  imports: [CompactNumber, Loaded, RelativeTime, Widget],
  templateUrl: './stats.html',
  styleUrl: './stats.css',
})
export class RepositoryStats {
  private readonly resources = inject(Resources);

  /** The repository's names, as the URL has them. */
  readonly owner = input.required<string>();
  readonly repo = input.required<string>();

  protected readonly stats = load(() => this.resources.stats(this.owner(), this.repo()));
}
