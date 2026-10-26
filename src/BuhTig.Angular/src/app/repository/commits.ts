import { Component, inject, input } from '@angular/core';
import { Resources } from '../dashboard/resources';
import { RelativeTime } from '../format/relative-time';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { NO_MESSAGE } from './messages';

/**
 * The 10 latest commits on a repository's default branch (FR-REPO-07), each with the first line
 * of its message, which links to its page on GitHub (FR-REPO-12), its author and its age.
 */
@Component({
  selector: 'app-repository-commits',
  imports: [Loaded, RelativeTime, Widget],
  templateUrl: './commits.html',
  styleUrl: './commits.css',
})
export class RepositoryCommits {
  private readonly resources = inject(Resources);

  /** The repository's names, as the URL has them. */
  readonly owner = input.required<string>();
  readonly repo = input.required<string>();

  protected readonly commits = load(
    () => this.resources.commits(this.owner(), this.repo()),
    (commits) => commits.length === 0,
  );

  protected readonly noMessage = NO_MESSAGE;
}
