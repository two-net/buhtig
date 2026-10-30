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
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, map, of, switchMap } from 'rxjs';
import { Header } from '../header/header';
import { Tab, Tabs } from '../header/tabs';
import { Glide } from '../motion/glide';
import { DashboardStyles } from '../styles/styles';
import { TipHost } from '../tip/tip';
import { OrganizationHead } from '../organization/head';
import { OrganizationOverview } from '../organization/overview';
import { OrganizationPeople } from '../organization/people';
import { OrganizationRepositoriesTab } from '../organization/repositories';
import { Resource } from '../search/parse';
import { Loader, load } from '../widget/load';
import { OrganizationData, once, sameName } from './data';
import { FailurePage } from './failure';
import { NotFoundOrPrivate } from './not-found-or-private';
import { Notices } from './notices';
import { Resources } from './resources';
import { followSummary } from './summary';
import { ORGANIZATION_TABS, OrganizationTab, organizationTabPath } from './tabs';
import { UserAccount } from './user-account';

/**
 * An organization's dashboard, at `/{org}`, `/orgs/{org}/repositories` and `/orgs/{org}/people`
 * (FR-NAV-01): the header with the search box filled in with the organization (UI-03), and its
 * tabs, Overview, Repositories and People, each with how many it has. Then the organization's
 * head (FR-ORG-01), when its data was fetched (FR-DATA-06), and the tab's widgets. Each part of
 * the organization loads once, as the first tab that shows it asks for it.
 *
 * When GitHub says there is no such organization, it may be a user, whose repositories it
 * offers instead (FR-SRCH-06). Otherwise it shows nothing of it, and says what the viewer can do
 * (FR-ACC-05).
 *
 * Opened from the home page, it fades in as the search box glides into its header (FR-ANIM-03).
 */
@Component({
  selector: 'app-organization-dashboard',
  imports: [
    DashboardStyles,
    FailurePage,
    Header,
    NotFoundOrPrivate,
    Notices,
    OrganizationHead,
    OrganizationOverview,
    OrganizationPeople,
    OrganizationRepositoriesTab,
    Tabs,
    TipHost,
    UserAccount,
  ],
  templateUrl: './organization.html',
  providers: [{ provide: OrganizationData, useExisting: forwardRef(() => OrganizationDashboard) }],
})
export class OrganizationDashboard implements OrganizationData {
  private readonly resources = inject(Resources);
  private readonly injector = inject(Injector);
  private readonly header = viewChild.required(Header);

  /** Where the search box was on the home page, if the dashboard is opened from there. */
  protected readonly glidingFrom = inject(Glide).take();

  /** The organization's login, as the URL has it, and the tab it shows. */
  readonly org = input.required<string>();
  readonly tab = input<OrganizationTab>('overview');

  /** The organization, as the URL names it, the same whatever the letter case of its login. */
  protected readonly resource = computed<Resource>(
    () => ({ kind: 'organization', org: this.org() }),
    {
      equal: (a, b) =>
        a.kind === 'organization' && b.kind === 'organization' && sameName(a.org, b.org),
    },
  );

  private readonly followed = followSummary(this.resource, (path) =>
    organizationTabPath(path.slice(1), this.tab()),
  );
  protected readonly summary = this.followed.summary;
  protected readonly refreshing = this.followed.refreshing;

  protected readonly organization = computed(() => this.summary()?.organization);
  readonly login = computed(() => this.organization()?.login ?? this.org());
  readonly displayName = computed(() => this.organization()?.displayName ?? this.login());

  /** Whether the name is a user's, once BuhTig knows, when GitHub has no organization of it. */
  protected readonly user = toSignal(
    toObservable(computed(() => (this.summary()?.notFound ? this.org() : undefined))).pipe(
      switchMap((name) =>
        name === undefined
          ? of(undefined)
          : this.resources.accountType(name).pipe(map((type) => type ?? 'unknown')),
      ),
    ),
  );

  readonly stats = this.part((org) => this.resources.organizationStats(org));
  readonly repositories = this.part((org) => this.resources.organizationRepositories(org));
  readonly languages = this.part((org) => this.resources.organizationLanguages(org));
  readonly topRepositories = this.part((org) => this.resources.topRepositories(org));
  readonly lastPush = this.part((org) => this.resources.lastPush(org));
  readonly createdPerYear = this.part((org) => this.resources.createdPerYear(org));
  readonly members = this.part((org) => this.resources.members(org));

  /** What the tabs count, and the colors of languages, loaded with the dashboard. */
  private readonly counted = {
    stats: this.stats(),
    members: this.members(),
    languages: this.languages(),
  };

  readonly languageColor = computed(() => {
    const languages = ready(this.counted.languages)?.languages ?? [];
    const colors = new Map(languages.map(({ name }, index) => [name, `var(--s${index + 1})`]));
    return (language: string) => colors.get(language) ?? 'var(--s-other)';
  });

  protected readonly crumbs = computed(() => [{ label: this.login(), link: `/${this.login()}` }]);

  /** Whether the dashboard shows its organization, or what keeps it from showing it. */
  protected readonly shown = computed(() => {
    const summary = this.summary();
    return !summary?.invalid && !summary?.notFound && !summary?.failure;
  });

  protected readonly tabs = computed((): Tab[] => {
    const counts: Partial<Record<OrganizationTab, number>> = {
      repositories: ready(this.counted.stats)?.repositories,
      people: ready(this.counted.members)?.count,
    };
    return ORGANIZATION_TABS.map(({ tab, label, icon }) => ({
      label,
      icon,
      link: organizationTabPath(this.login(), tab),
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
   * A part of the organization, loaded once its first tab asks for it, and again on each refresh,
   * or when the dashboard moves to another organization.
   */
  private part<T>(request: (org: string) => Observable<T>): () => Loader<T> {
    return once(this.injector, () =>
      load(() => {
        this.resources.refreshes();
        const resource = this.resource();
        return request(resource.kind === 'organization' ? resource.org : '');
      }),
    );
  }
}

/** The data of `loader`, once it has loaded. */
function ready<T>(loader: Loader<T>): T | undefined {
  const state = loader.state();
  return state.status === 'ready' ? state.data : undefined;
}
