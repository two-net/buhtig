import { Component, inject, input } from '@angular/core';
import { Resources } from '../dashboard/resources';
import { CompactNumber } from '../format/compact-number';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { TOO_MANY_CONTRIBUTORS, commitsLabel } from './messages';

/**
 * Up to 10 of a repository's top contributors by commits (FR-REPO-05), each with their avatar,
 * their login, which links to their profile on GitHub (FR-REPO-12), and their commits. GitHub
 * does not list the contributors of its largest repositories, and the widget then says so.
 */
@Component({
  selector: 'app-repository-contributors',
  imports: [CompactNumber, Loaded, Widget],
  templateUrl: './contributors.html',
  styleUrl: './contributors.css',
})
export class RepositoryContributors {
  private readonly resources = inject(Resources);

  /** The repository's names, as the URL has them. */
  readonly owner = input.required<string>();
  readonly repo = input.required<string>();

  protected readonly contributors = load(
    () => this.resources.contributors(this.owner(), this.repo()),
    ({ contributors, tooLarge }) => contributors.length === 0 && !tooLarge,
  );

  protected readonly tooLarge = TOO_MANY_CONTRIBUTORS;
  protected readonly commitsLabel = commitsLabel;
}
