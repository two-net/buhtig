import { Component, inject, input } from '@angular/core';
import { IssuesAndPullRequests, Resources } from '../dashboard/resources';
import { CompactNumber } from '../format/compact-number';
import { RelativeTime } from '../format/relative-time';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { TURNED_OFF, issueLabel } from './messages';

/**
 * A repository's issues and pull requests (FR-REPO-06): how many issues are open and closed,
 * and how many pull requests are open, merged, and closed unmerged, then the 10 updated last,
 * each with its state, its number, its age and who opened it, linked to its page on GitHub
 * (FR-REPO-12). Issues or pull requests that the repository has turned off are said to be.
 */
@Component({
  selector: 'app-repository-issues',
  imports: [CompactNumber, Loaded, RelativeTime, Widget],
  templateUrl: './issues.html',
  styleUrl: './issues.css',
})
export class RepositoryIssues {
  private readonly resources = inject(Resources);

  /** The repository's names, as the URL has them. */
  readonly owner = input.required<string>();
  readonly repo = input.required<string>();

  protected readonly issues = load(() => this.resources.issues(this.owner(), this.repo()), isEmpty);

  protected readonly turnedOff = TURNED_OFF;
  protected readonly issueLabel = issueLabel;
}

/**
 * Whether a repository has no issues or pull requests at all (FR-REPO-11). One that has turned
 * either off is said to have, rather than to be empty.
 */
function isEmpty({ issues, pullRequests, recent }: IssuesAndPullRequests): boolean {
  if (issues === undefined || pullRequests === undefined) {
    return false;
  }
  const { open, closed } = issues;
  return (
    recent.length === 0 &&
    [open, closed, pullRequests.open, pullRequests.merged, pullRequests.closed].every(
      (count) => count === 0,
    )
  );
}
