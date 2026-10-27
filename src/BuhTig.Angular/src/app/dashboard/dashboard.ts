import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';
import { Account } from '../account/account';
import { DeniedNotice } from './denied';
import { NotFoundOrPrivate } from './not-found-or-private';
import { OrganizationCreated } from '../organization/created';
import { OrganizationHeader } from '../organization/header';
import { OrganizationLanguages } from '../organization/languages';
import { OrganizationLastPush } from '../organization/last-push';
import { OrganizationMembers } from '../organization/members';
import { OrganizationRepositories } from '../organization/repositories';
import { OrganizationStats } from '../organization/stats';
import { OrganizationTopRepositories } from '../organization/top-repositories';
import { RepositoryActivity } from '../repository/activity';
import { RepositoryCommits } from '../repository/commits';
import { RepositoryContributors } from '../repository/contributors';
import { RepositoryHeader } from '../repository/header';
import { RepositoryIssues } from '../repository/issues';
import { RepositoryLanguages } from '../repository/languages';
import { RepositoryReleases } from '../repository/releases';
import { RepositoryStats } from '../repository/stats';
import { Refresh } from './refresh';
import { Search } from '../search/search';
import { Resource, dashboardPath } from '../search/parse';
import { Resources, Summary } from './resources';

/**
 * A repository's or organization's dashboard, at `/{owner}/{repo}` or `/{org}` (FR-NAV-01),
 * after a search engine's results page (§3.1): a slim header with the wordmark, the search box
 * filled in with the resource, and "Sign in" or the avatar menu (UI-03), then the resource,
 * when its data was fetched (FR-DATA-06), and its widgets in a grid (UI-05). A repository's
 * head shows what else the server says of it (FR-REPO-01), and its stat cards lead the grid
 * (FR-REPO-02), before its commit activity (FR-REPO-03), languages (FR-REPO-04), top
 * contributors (FR-REPO-05), issues and pull requests (FR-REPO-06), recent commits (FR-REPO-07)
 * and releases (FR-REPO-08). An organization's head shows what the server says of it
 * (FR-ORG-01), and its stat cards lead the grid (FR-ORG-02), before its languages (FR-ORG-04),
 * top repositories (FR-ORG-05), last pushes and repositories created per year (FR-ORG-06), its
 * repository table (FR-ORG-03), and its members (FR-ORG-07).
 *
 * Once it knows how GitHub spells the names, it moves there, in place of the URL it was opened
 * at (FR-NAV-04, FR-NAV-05). When GitHub keeps the resource from the viewer's credential, it
 * says why, and how to get access (FR-PAT-08). When GitHub says there is no such resource, it
 * shows nothing of it, and says what the viewer can do (FR-ACC-05). A signed-in user may refresh
 * it (FR-DATA-07), and its header and widgets then ask for their data again.
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    Account,
    DeniedNotice,
    NotFoundOrPrivate,
    OrganizationCreated,
    OrganizationHeader,
    OrganizationLanguages,
    OrganizationLastPush,
    OrganizationMembers,
    OrganizationRepositories,
    OrganizationStats,
    OrganizationTopRepositories,
    Refresh,
    RepositoryActivity,
    RepositoryCommits,
    RepositoryContributors,
    RepositoryHeader,
    RepositoryIssues,
    RepositoryLanguages,
    RepositoryReleases,
    RepositoryStats,
    RouterLink,
    Search,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly router = inject(Router);
  private readonly resources = inject(Resources);

  /** How many times the viewer has refreshed a dashboard. */
  protected readonly refreshes = this.resources.refreshes;

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

  /** The organization's login, as the URL has it, if the dashboard is an organization's. */
  protected readonly organization = computed(() => {
    const resource = this.resource();
    return resource.kind === 'organization' ? resource : undefined;
  });

  /** What BuhTig knows of the resource, once it says, for each resource anew. */
  protected readonly summary = linkedSignal<Resource, Summary | undefined>({
    source: this.resource,
    computation: () => undefined,
  });

  constructor() {
    // Asked for again on each refresh.
    const asked = computed(() => ({ resource: this.resource(), refreshes: this.refreshes() }));
    toObservable(asked)
      .pipe(
        // A dashboard left behind no longer moves.
        switchMap(({ resource }) =>
          this.resources.summary(resource).pipe(map((summary) => ({ resource, summary }))),
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
