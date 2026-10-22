import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';
import { Account } from '../account/account';
import { RelativeTime } from '../format/relative-time';
import { Search } from '../search/search';
import { Resource, dashboardPath } from '../search/parse';
import { Resources } from './resources';

/**
 * A repository's or organization's dashboard, at `/{owner}/{repo}` or `/{org}` (FR-NAV-01),
 * after a search engine's results page (§3.1): a slim header with the wordmark, the search box
 * filled in with the resource, and "Sign in" or the avatar menu (UI-03), then the resource,
 * when its data was fetched (FR-DATA-06), and its widgets in a grid (UI-05).
 *
 * Once it knows how GitHub spells the names, it moves there, in place of the URL it was opened
 * at (FR-NAV-04, FR-NAV-05). The widgets are still to come (#15 to #20).
 */
@Component({
  selector: 'app-dashboard',
  imports: [Account, RelativeTime, RouterLink, Search],
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

  /** When BuhTig fetched the resource from GitHub, once it says, for each resource anew. */
  protected readonly fetchedAt = linkedSignal<Resource, Date | undefined>({
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
        this.fetchedAt.set(summary.fetchedAt);
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
