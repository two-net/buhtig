import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';
import { Account } from '../account/account';
import { RelativeTime } from '../format/relative-time';
import { RepositoryActivity } from '../repository/activity';
import { RepositoryContributors } from '../repository/contributors';
import { RepositoryHeader } from '../repository/header';
import { RepositoryLanguages } from '../repository/languages';
import { RepositoryStats } from '../repository/stats';
import { Search } from '../search/search';
import { Resource, dashboardPath } from '../search/parse';
import { Resources, Summary } from './resources';

/**
 * A repository's or organization's dashboard, at `/{owner}/{repo}` or `/{org}` (FR-NAV-01),
 * after a search engine's results page (§3.1): a slim header with the wordmark, the search box
 * filled in with the resource, and "Sign in" or the avatar menu (UI-03), then the resource,
 * when its data was fetched (FR-DATA-06), and its widgets in a grid (UI-05). A repository's
 * head shows what else the server says of it (FR-REPO-01), and its stat cards lead the grid
 * (FR-REPO-02), before its commit activity (FR-REPO-03), languages (FR-REPO-04) and top
 * contributors (FR-REPO-05).
 *
 * Once it knows how GitHub spells the names, it moves there, in place of the URL it was opened
 * at (FR-NAV-04, FR-NAV-05). The other widgets are still to come (#17 to #20).
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    Account,
    RelativeTime,
    RepositoryActivity,
    RepositoryContributors,
    RepositoryHeader,
    RepositoryLanguages,
    RepositoryStats,
    RouterLink,
    Search,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly router = inject(Router);

  readonly owner = input<string>();
  readonly repo = input<string>();
  readonly org = input<string>();

  protected readonly name = computed(() => this.org() ?? `${this.owner()}/${this.repo()}`);

  private readonly resource = computed<Resource>(() => {
    const org = this.org();
    return org !== undefined
      ? { kind: 'organization', org }
      : { kind: 'repository', owner: this.owner()!, repo: this.repo()! };
  });

  /** The repository's names, as the URL has them, if the dashboard is a repository's. */
  protected readonly repository = computed(() => {
    const resource = this.resource();
    return resource.kind === 'repository' ? resource : undefined;
  });

  /** What BuhTig knows of the resource, once it says, for each resource anew. */
  protected readonly summary = linkedSignal<Resource, Summary | undefined>({
    source: this.resource,
    computation: () => undefined,
  });

  constructor() {
    const resources = inject(Resources);
    toObservable(this.resource)
      .pipe(
        // A dashboard left behind no longer moves.
        switchMap((resource) =>
          resources.summary(resource).pipe(map((summary) => ({ resource, summary }))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ resource, summary }) => {
        if (summary === undefined) {
          return;
        }
        this.summary.set(summary);
        if (summary.path !== undefined && summary.path !== dashboardPath(resource)) {
          // In place of the URL in the history, so that Back does not lead to it again.
          void this.router.navigate([summary.path], {
            replaceUrl: true,
            queryParamsHandling: 'preserve',
            preserveFragment: true,
          });
        }
      });
  }
}
