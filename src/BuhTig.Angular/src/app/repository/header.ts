import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Repository } from '../dashboard/resources';
import { RelativeTime } from '../format/relative-time';

/**
 * The head of a repository's dashboard (FR-REPO-01), after the wireframe in §3.1: the owner's
 * avatar, the name, badges for its visibility and for what else it is, and "Open on GitHub";
 * then its description and topics; then its license, default branch, homepage, when it was
 * created and last pushed to, and when BuhTig fetched it (FR-DATA-06).
 *
 * The name, from the URL, shows at once, and the rest once the server has said it.
 */
@Component({
  selector: 'app-repository-header',
  imports: [RelativeTime, RouterLink],
  templateUrl: './header.html',
  styleUrl: './header.css',
  host: { '[class.pending]': 'repository() === undefined' },
})
export class RepositoryHeader {
  /** `owner/repo`, as the URL has it. */
  readonly name = input.required<string>();
  readonly repository = input<Repository>();
  readonly fetchedAt = input<Date>();

  /** The homepage as people write it, such as `widget.example/docs`. */
  protected readonly site = computed(() =>
    this.repository()
      ?.homepage?.replace(/^https?:\/\//i, '')
      .replace(/\/$/, ''),
  );
}
