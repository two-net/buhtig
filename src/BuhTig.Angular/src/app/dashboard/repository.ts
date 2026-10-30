import {
  Component,
  Injector,
  afterNextRender,
  computed,
  forwardRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Observable } from 'rxjs';
import { Header } from '../header/header';
import { Tab, Tabs } from '../header/tabs';
import { Glide } from '../motion/glide';
import { DashboardStyles } from '../styles/styles';
import { TipHost } from '../tip/tip';
import { RepositoryActivityTab } from '../repository/activity-tab';
import { RepositoryContributorsTab } from '../repository/contributors';
import { RepositoryHead } from '../repository/head';
import { RepositoryIssuesTab } from '../repository/issues';
import { RepositoryOverview } from '../repository/overview';
import { RepositoryReleasesTab } from '../repository/releases';
import { Resource } from '../search/parse';
import { Loader, load } from '../widget/load';
import { RepositoryData, once, sameName } from './data';
import { FailurePage } from './failure';
import { NotFoundOrPrivate } from './not-found-or-private';
import { Notices } from './notices';
import { Resources } from './resources';
import { followSummary } from './summary';
import { REPOSITORY_TABS, RepositoryTab, repositoryTabPath } from './tabs';

/**
 * A repository's dashboard, at `/{owner}/{repo}` and its tabs below (FR-NAV-01): the header with
 * the search box filled in with the repository (UI-03), and its tabs, Overview, Activity,
 * Issues, Pull requests, Contributors and Releases, each with how many items it has. Then the
 * repository's head (FR-REPO-01), when its data was fetched (FR-DATA-06), and the tab's widgets.
 * Each part of the repository loads once, as the first tab that shows it asks for it, so that
 * moving between tabs is instant.
 *
 * When GitHub keeps the repository from the viewer's credential, it says why, and how to get
 * access (FR-PAT-08). When GitHub says there is no such repository, it shows nothing of it, and
 * says what the viewer can do (FR-ACC-05).
 *
 * Opened from the home page, it fades in as the search box glides into its header (FR-ANIM-03).
 */
@Component({
  selector: 'app-repository-dashboard',
  imports: [
    DashboardStyles,
    FailurePage,
    Header,
    NotFoundOrPrivate,
    Notices,
    RepositoryActivityTab,
    RepositoryContributorsTab,
    RepositoryHead,
    RepositoryIssuesTab,
    RepositoryOverview,
    RepositoryReleasesTab,
    Tabs,
    TipHost,
  ],
  templateUrl: './repository.html',
  providers: [{ provide: RepositoryData, useExisting: forwardRef(() => RepositoryDashboard) }],
})
export class RepositoryDashboard implements RepositoryData {
  private readonly resources = inject(Resources);
  private readonly injector = inject(Injector);
  private readonly header = viewChild.required(Header);

  /**
   * Where the search box was on the home page, if the dashboard is opened from there. Taken as
   * the dashboard is made, while the navigation that opens it is in progress.
   */
  protected readonly glidingFrom = inject(Glide).take();

  /** The repository's names, as the URL has them, and the tab it shows. */
  readonly owner = input.required<string>();
  readonly repo = input.required<string>();
  readonly tab = input<RepositoryTab>('overview');

  /** The repository, as the URL names it, the same whatever the letter case of its names. */
  protected readonly resource = computed<Resource>(
    () => ({ kind: 'repository', owner: this.owner(), repo: this.repo() }),
    {
      equal: (a, b) =>
        a.kind === 'repository' &&
        b.kind === 'repository' &&
        sameName(a.owner, b.owner) &&
        sameName(a.repo, b.repo),
    },
  );

  private readonly followed = followSummary(this.resource, (path) =>
    repositoryTabPath(path.slice(1), this.tab()),
  );
  protected readonly summary = this.followed.summary;
  protected readonly refreshing = this.followed.refreshing;

  readonly repository = computed(() => this.summary()?.repository);
  readonly name = computed(() => this.repository()?.name ?? `${this.owner()}/${this.repo()}`);

  readonly stats = this.part((owner, repo) => this.resources.stats(owner, repo));
  readonly activity = this.part((owner, repo) => this.resources.commitActivity(owner, repo));
  readonly languages = this.part((owner, repo) => this.resources.languages(owner, repo));
  readonly contributors = this.part((owner, repo) => this.resources.contributors(owner, repo));
  readonly issues = this.part((owner, repo) => this.resources.issues(owner, repo));
  readonly commits = this.part((owner, repo) => this.resources.commits(owner, repo));
  readonly releases = this.part((owner, repo) => this.resources.releases(owner, repo));

  /** What the tabs count, loaded with the dashboard, whatever its tab. */
  private readonly counted = {
    stats: this.stats(),
    contributors: this.contributors(),
    releases: this.releases(),
  };

  protected readonly crumbs = computed(() => {
    const [owner, repo] = this.name().split('/');
    return [
      { label: owner, link: `/${owner}` },
      { label: repo, link: `/${owner}/${repo}` },
    ];
  });

  /** Whether the dashboard shows its repository, or what keeps it from showing it. */
  protected readonly shown = computed(() => {
    const summary = this.summary();
    return !summary?.invalid && !summary?.notFound && !summary?.failure;
  });

  protected readonly tabs = computed((): Tab[] => {
    const stats = ready(this.counted.stats);
    const contributors = ready(this.counted.contributors);
    const releases = ready(this.counted.releases);
    const counts: Partial<Record<RepositoryTab, number>> = {
      issues: stats?.openIssues,
      pulls: stats?.openPullRequests,
      contributors: contributors?.count,
      releases: releases?.count,
    };
    return REPOSITORY_TABS.map(({ tab, label, icon }) => ({
      label,
      icon,
      link: repositoryTabPath(this.name(), tab),
      current: tab === this.tab(),
      count: counts[tab],
    }));
  });

  constructor() {
    const from = this.glidingFrom;
    if (from !== undefined) {
      // Before the first paint, so that the search box is never seen in its place too soon.
      afterNextRender(() => this.header().search().glideFrom(from));
    }
  }

  protected retry(): void {
    this.followed.retry();
  }

  /**
   * A part of the repository, loaded once its first tab asks for it, and again on each refresh,
   * or when the dashboard moves to another repository.
   */
  private part<T>(request: (owner: string, repo: string) => Observable<T>): () => Loader<T> {
    return once(this.injector, () =>
      load(() => {
        this.resources.refreshes();
        const resource = this.resource();
        return resource.kind === 'repository'
          ? request(resource.owner, resource.repo)
          : request('', '');
      }),
    );
  }
}

/** The data of `loader`, once it has loaded. */
function ready<T>(loader: Loader<T>): T | undefined {
  const state = loader.state();
  return state.status === 'ready' ? state.data : undefined;
}
