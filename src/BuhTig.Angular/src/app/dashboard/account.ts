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
import { NEVER, Observable } from 'rxjs';
import { Header } from '../header/header';
import { Tab, Tabs } from '../header/tabs';
import { Glide } from '../motion/glide';
import { DashboardStyles } from '../styles/styles';
import { TipHost } from '../tip/tip';
import { OrganizationHead } from '../organization/head';
import { OrganizationOverview } from '../organization/overview';
import { OrganizationPeople } from '../organization/people';
import { OrganizationRepositoriesTab } from '../organization/repositories';
import { Owner, Resource, dashboardPath } from '../search/parse';
import { UserHead } from '../user/head';
import { Loader, load } from '../widget/load';
import { AccountData, once } from './data';
import { FailurePage } from './failure';
import { NotFoundOrPrivate } from './not-found-or-private';
import { Notices } from './notices';
import { CommitActivity, Resources } from './resources';
import { followSummary, same } from './summary';
import { USER_TABS, accountTabUrl, urlOf } from './account-tabs';
import { AccountTab, ORGANIZATION_TABS, TabInfo } from './tabs';

/**
 * An account's dashboard, an organization's or a user's, at `/{name}`, and an organization's at
 * `/orgs/{org}/repositories` and `/orgs/{org}/people` too (FR-NAV-01): the header with the search
 * box filled in with the account (UI-03), and its tabs, each with how many it has. An
 * organization's are Overview, Repositories and People. A user's are Overview and Repositories,
 * at `/{user}?tab=repositories`, as on GitHub. Then the account's head (FR-ORG-01, FR-USER-01),
 * when its data was fetched (FR-DATA-06), and the tab's widgets. Each part of the account loads
 * once, as the first tab that shows it asks for it.
 *
 * GitHub tells whether an account named alone is an organization or a user (FR-SRCH-06), and
 * the dashboard is then the one of its kind. Its parts load once it knows, at once at an
 * organization's URL. When GitHub says there is no such account, it shows nothing of it, and says
 * what the viewer can do (FR-ACC-05).
 *
 * Opened from the home page, it fades in as the search box glides into its header (FR-ANIM-03).
 */
@Component({
  selector: 'app-account-dashboard',
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
    UserHead,
  ],
  templateUrl: './account.html',
  providers: [{ provide: AccountData, useExisting: forwardRef(() => AccountDashboard) }],
})
export class AccountDashboard implements AccountData {
  private readonly resources = inject(Resources);
  private readonly injector = inject(Injector);
  private readonly header = viewChild.required(Header);

  /** Where the search box was on the home page, if the dashboard is opened from there. */
  protected readonly glidingFrom = inject(Glide).take();

  /** The account's login, as the URL has it. */
  readonly name = input.required<string>();
  /**
   * What the URL says the account is: an organization, at `/orgs/{org}/…`, or an account of
   * either kind, named alone.
   */
  readonly kind = input<string | undefined>('account');
  /**
   * The tab the URL names: in the path of an organization's, as `/orgs/{org}/people`, or else in
   * the query, as a user's on GitHub, `?tab=repositories`, which may name any.
   */
  readonly tab = input<string | undefined>(undefined);

  /**
   * The account, as the URL names it, the same whatever the letter case of its login, and the
   * same whether the URL says it is an organization or names it alone, so that moving between
   * `/{org}` and `/orgs/{org}/people` asks for nothing new.
   */
  protected readonly resource = computed<Resource>(
    () =>
      this.kind() === 'organization'
        ? { kind: 'organization', org: this.name() }
        : { kind: 'account', name: this.name() },
    { equal: same },
  );

  private readonly followed = followSummary(this.resource, (known) =>
    urlOf(
      accountTabUrl(
        dashboardPath(known).slice(1),
        known.kind === 'user' ? 'user' : 'organization',
        this.shownTab(),
      ),
    ),
  );
  protected readonly summary = this.followed.summary;
  protected readonly refreshing = this.followed.refreshing;

  /**
   * The account whose parts load, of the kind that GitHub tells, once the dashboard knows: at
   * once at an organization's URL, until GitHub tells otherwise, and as soon as the server says
   * of an account named alone.
   */
  private readonly owner = computed<Owner | undefined>(
    () => {
      const known = this.summary()?.resource;
      if (known?.kind === 'organization' || known?.kind === 'user') {
        return known;
      }
      return this.kind() === 'organization' && this.summary() === undefined
        ? { kind: 'organization', org: this.name() }
        : undefined;
    },
    {
      equal: (a, b) =>
        a === b || (a !== undefined && b !== undefined && a.kind === b.kind && same(a, b)),
    },
  );

  readonly type = computed(() => this.owner()?.kind);

  protected readonly organization = computed(() => this.summary()?.organization);
  protected readonly user = computed(() => this.summary()?.user);
  readonly login = computed(() => this.organization()?.login ?? this.user()?.login ?? this.name());
  readonly displayName = computed(
    () => this.organization()?.displayName ?? this.user()?.displayName ?? this.login(),
  );

  /**
   * The tab shown. Repositories, at an organization's path, or at the query of a user's. People,
   * at an organization's path alone, unless GitHub tells it is a user's. Any other tab the query
   * names, as one of a user's on GitHub that BuhTig does not show, is the overview, where the
   * dashboard moves once it knows the account (FR-NAV-02).
   */
  protected readonly shownTab = computed((): AccountTab => {
    switch (this.tab()) {
      case 'repositories':
        return 'repositories';
      case 'people':
        return this.kind() === 'organization' && this.type() !== 'user' ? 'people' : 'overview';
      default:
        return 'overview';
    }
  });

  readonly stats = this.part((owner) => this.resources.accountStats(owner));
  readonly repositories = this.part((owner) => this.resources.accountRepositories(owner));
  readonly languages = this.part((owner) => this.resources.accountLanguages(owner));
  readonly topRepositories = this.part((owner) => this.resources.topRepositories(owner));
  readonly lastPush = this.part((owner) => this.resources.lastPush(owner));
  readonly createdPerYear = this.part((owner) => this.resources.createdPerYear(owner));
  /** An organization's members. A user has none, so nothing is asked for. */
  readonly members = this.part((owner) =>
    owner.kind === 'organization' ? this.resources.members(owner.org) : NEVER,
  );

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

  /** What the dashboard calls the account when GitHub says there is none. */
  protected readonly named = computed(() =>
    this.kind() === 'organization' ? 'organization' : 'account',
  );

  /** Whether the dashboard shows its account, or what keeps it from showing it. */
  protected readonly shown = computed(() => {
    const summary = this.summary();
    return !summary?.invalid && !summary?.notFound && !summary?.failure;
  });

  /**
   * The tabs of the account's kind, a user's until the dashboard knows, which an organization's
   * has too. Their Repositories then leads to the account's, of either kind.
   */
  protected readonly tabs = computed((): Tab[] => {
    const type = this.type();
    const counts: Partial<Record<AccountTab, number>> = {
      repositories: ready(this.counted.stats)?.repositories,
      people: ready(this.counted.members)?.count,
    };
    const tabs: TabInfo<AccountTab>[] = type === 'organization' ? ORGANIZATION_TABS : USER_TABS;
    return tabs.map(({ tab, label, icon }) => {
      const url = accountTabUrl(this.login(), type, tab);
      return {
        label,
        icon,
        link: url.link,
        query: url.query,
        current: tab === this.shownTab(),
        count: counts[tab],
      };
    });
  });

  constructor() {
    const from = this.glidingFrom;
    if (from !== undefined) {
      // Before the first paint, so that the search box is never seen in its place too soon.
      afterNextRender(() => this.header().search().glideFrom(from));
    }
  }

  activity(repo: string): Observable<CommitActivity> {
    const owner = this.owner();
    return owner !== undefined ? this.resources.accountActivity(owner, repo) : NEVER;
  }

  protected retry(): void {
    this.followed.retry();
  }

  /**
   * A part of the account, loaded once its first tab asks for it, and the dashboard knows which
   * the account is, and again on each refresh, or when the dashboard moves to another account.
   */
  private part<T>(request: (owner: Owner) => Observable<T>): () => Loader<T> {
    return once(this.injector, () =>
      load(() => {
        this.resources.refreshes();
        const owner = this.owner();
        return owner !== undefined ? request(owner) : NEVER;
      }),
    );
  }
}

/** The data of `loader`, once it has loaded. */
function ready<T>(loader: Loader<T>): T | undefined {
  const state = loader.state();
  return state.status === 'ready' ? state.data : undefined;
}
