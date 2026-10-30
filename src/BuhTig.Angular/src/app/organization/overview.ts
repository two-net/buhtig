import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Avatar } from '../avatar/avatar';
import { ColumnChart, Tick } from '../chart/columns';
import { Bar, BarChart } from '../chart/hbars';
import { ChartTable } from '../chart/table';
import { OrganizationData } from '../dashboard/data';
import { LastPush, LanguageCount, ListedRepository, YearCount } from '../dashboard/resources';
import { organizationTabPath } from '../dashboard/tabs';
import { CompactNumber } from '../format/compact-number';
import { exactNumber } from '../format/format';
import { Icon } from '../icon/icon';
import { Enter } from '../motion/entrance';
import { emptyWhen } from '../widget/load';
import { FAILED } from '../widget/messages';
import { Loaded, Widget } from '../widget/widget';
import {
  ALL_REPOSITORIES,
  CREATED_HEADERS,
  LANGUAGES_HEADERS,
  LAST_PUSH,
  LAST_PUSH_HEADERS,
  LAST_PUSH_SUMMARY,
  NO_LANGUAGE,
  NO_LANGUAGES,
  NO_REPOSITORIES,
  NO_STARRED,
  OTHER,
  POPULAR,
  PUBLIC_ONLY,
  RECENTLY_PUSHED,
  TOP_REPOSITORIES_HEADERS,
  VIEW_ALL,
  VIEW_ALL_REPOSITORIES,
  VISIBLE_TO_YOU,
  createdDescription,
  createdIn,
  hiddenCount,
  languagesDescription,
  pushedLast,
  repositoryCount,
  topRepositoriesDescription,
  truncated,
} from './messages';
import { RepositoryCard, RepositoryRow } from './repository-row';

/**
 * An organization's stat cards (FR-ORG-02), over the repositories the viewer may see: how many
 * there are, and how many of them are private or internal (FR-ORG-09), their stars, forks, open
 * issues and pull requests, their most used primary language, and the members the viewer may
 * see. The figures count up as the box comes into view (FR-ANIM-05).
 */
@Component({
  selector: 'app-organization-pulse',
  imports: [CompactNumber, Enter, Icon],
  template: `
    @let shown = stats();
    <section
      class="Box"
      aria-labelledby="org-pulse-heading"
      appEnter="Organization stats"
      [appEnterReady]="shown !== undefined"
    >
      <div class="Box-header">
        <h2 class="Box-title" id="org-pulse-heading">Overview</h2>
        @if (shown) {
          <span class="muted small">{{
            shown.truncated ? pushedLast(shown.repositories) : ALL_REPOSITORIES
          }}</span>
        }
      </div>
      @if (shown) {
        <dl class="stats">
          <div class="stat">
            <dt><app-icon name="repo" />Repositories</dt>
            <dd class="val">
              <app-compact-number [value]="shown.repositories" [countUp]="true" />
            </dd>
            <dd class="sub">
              {{
                shown.private + shown.internal > 0
                  ? hiddenCount(shown.private + shown.internal)
                  : PUBLIC_ONLY
              }}
            </dd>
          </div>
          <div class="stat">
            <dt><app-icon name="star" />Total stars</dt>
            <dd class="val"><app-compact-number [value]="shown.stars" [countUp]="true" /></dd>
          </div>
          <div class="stat">
            <dt><app-icon name="fork" />Total forks</dt>
            <dd class="val"><app-compact-number [value]="shown.forks" [countUp]="true" /></dd>
          </div>
          <div class="stat">
            <dt><app-icon name="issue" />Open issues and PRs</dt>
            <dd class="val">
              <app-compact-number [value]="shown.openIssuesAndPullRequests" [countUp]="true" />
            </dd>
          </div>
          <div class="stat">
            <dt><app-icon name="code" />Top language</dt>
            <dd class="val">{{ shown.topLanguage ?? NO_LANGUAGE }}</dd>
            @if (topLanguage(); as top) {
              <dd class="sub">{{ repositoryCount(top.repositories) }}</dd>
            }
          </div>
          <div class="stat">
            <dt><app-icon name="people" />Members</dt>
            @if (members(); as members) {
              <dd class="val"><app-compact-number [value]="members.count" [countUp]="true" /></dd>
              <dd class="sub">{{ VISIBLE_TO_YOU }}</dd>
            } @else {
              <dd class="val muted">–</dd>
            }
          </div>
        </dl>
      } @else if (failed()) {
        <div class="pad">
          <div class="w-state">
            <app-icon name="alert" /><span>{{ FAILED }}</span>
            <button type="button" class="btn sm" (click)="statsLoader.retry()">
              <app-icon name="refresh" />Try again
            </button>
          </div>
        </div>
      } @else {
        <div class="pad" aria-hidden="true"><span class="skel block pulse-skel"></span></div>
      }
    </section>
  `,
  styles: '.pulse-skel { --sh: 70px; }',
})
export class OrganizationPulse {
  private readonly data = inject(OrganizationData);
  protected readonly statsLoader = this.data.stats();
  private readonly languages = this.data.languages();
  private readonly membersLoader = this.data.members();

  protected readonly stats = computed(() => ready(this.statsLoader.state()));
  protected readonly failed = computed(() => this.statsLoader.state().status === 'error');
  protected readonly members = computed(() => ready(this.membersLoader.state()));
  protected readonly topLanguage = computed(() => {
    const top = this.stats()?.topLanguage;
    return ready(this.languages.state())?.languages.find((language) => language.name === top);
  });

  protected readonly pushedLast = pushedLast;
  protected readonly hiddenCount = hiddenCount;
  protected readonly repositoryCount = repositoryCount;
  protected readonly ALL_REPOSITORIES = ALL_REPOSITORIES;
  protected readonly PUBLIC_ONLY = PUBLIC_ONLY;
  protected readonly NO_LANGUAGE = NO_LANGUAGE;
  protected readonly VISIBLE_TO_YOU = VISIBLE_TO_YOU;
  protected readonly FAILED = FAILED;
}

/**
 * An organization's Overview tab: a notice when it has more repositories than BuhTig reads
 * (FR-ORG-08), its stat cards, its 6 most-starred repositories as cards, its 10 most-starred as
 * bars (FR-ORG-05), its repositories by last push and by year created (FR-ORG-06), and the 5
 * pushed to last. Beside them, its members (FR-ORG-07), languages (FR-ORG-04) and most used
 * topics.
 */
@Component({
  selector: 'app-organization-overview',
  imports: [
    Avatar,
    BarChart,
    ColumnChart,
    CompactNumber,
    Enter,
    Icon,
    Loaded,
    OrganizationPulse,
    RepositoryCard,
    RepositoryRow,
    RouterLink,
    Widget,
  ],
  templateUrl: './overview.html',
})
export class OrganizationOverview {
  private readonly data = inject(OrganizationData);

  private readonly statsLoader = this.data.stats();
  protected readonly repositories = emptyWhen(
    this.data.repositories(),
    (repositories) => repositories.length === 0,
  );
  protected readonly topRepositories = emptyWhen(
    this.data.topRepositories(),
    (top) => top.length === 0,
  );
  protected readonly lastPush = emptyWhen(
    this.data.lastPush(),
    (pushes) => pushes.last7Days + pushes.last30Days + pushes.last12Months + pushes.older === 0,
  );
  protected readonly createdPerYear = emptyWhen(
    this.data.createdPerYear(),
    (years) => years.length === 0,
  );
  private readonly languagesLoader = this.data.languages();
  private readonly membersLoader = this.data.members();

  protected readonly allRepositories = computed(() =>
    organizationTabPath(this.data.login(), 'repositories'),
  );
  protected readonly allPeople = computed(() => organizationTabPath(this.data.login(), 'people'));

  /** The notice of an organization with more repositories than BuhTig reads, if it has. */
  protected readonly truncated = computed(() => {
    const stats = ready(this.statsLoader.state());
    return stats?.truncated ? truncated(this.data.displayName(), stats.repositories) : undefined;
  });

  private readonly listed = computed(() => ready(this.repositories.state()) ?? []);

  /** The 6 repositories with the most stars, for the cards. */
  protected readonly popular = computed(() =>
    [...this.listed()]
      .sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name))
      .slice(0, 6),
  );

  /** The 5 repositories pushed to last, as the server lists them. */
  protected readonly recent = computed(() => this.listed().slice(0, 5));

  /** The 8 topics of the most repositories, most first. */
  protected readonly topics = computed(() => topics(this.listed()));

  protected readonly members = computed(() => ready(this.membersLoader.state()));

  // Most-starred repositories (FR-ORG-05).
  private readonly top = computed(() => ready(this.topRepositories.state()) ?? []);
  protected readonly topBars = computed((): Bar[] =>
    this.top().map(({ name, path, stars }) => ({ label: name, value: stars, link: path })),
  );
  protected readonly topSummary = computed(() => {
    const [first] = this.top();
    return first ? topRepositoriesDescription(first.name, first.stars) : '';
  });
  protected readonly topTable = computed(() =>
    table(
      TOP_REPOSITORIES_HEADERS,
      this.top().map(({ name, stars }) => [name, stars]),
    ),
  );

  // Last push (FR-ORG-06).
  private readonly pushes = computed(() => ready(this.lastPush.state()));
  protected readonly pushBars = computed((): Bar[] => {
    const pushes = this.pushes();
    return pushes
      ? (Object.keys(LAST_PUSH) as (keyof LastPush)[]).map((period) => ({
          label: LAST_PUSH[period],
          value: pushes[period],
        }))
      : [];
  });
  protected readonly pushTable = computed(() =>
    table(
      LAST_PUSH_HEADERS,
      this.pushBars().map(({ label, value }) => [label, value]),
    ),
  );

  // Created per year (FR-ORG-06).
  private readonly years = computed(() => ready(this.createdPerYear.state()) ?? []);
  protected readonly yearColumns = computed(() =>
    this.years().map(({ year, repositories }) => ({ value: repositories, label: createdIn(year) })),
  );
  protected readonly yearTicks = computed(() => yearTicks(this.years()));
  protected readonly yearSummary = computed(() =>
    this.years().length > 0 ? createdDescription(this.years()) : '',
  );
  protected readonly yearTable = computed(() =>
    table(
      CREATED_HEADERS,
      this.years().map(({ year, repositories }) => [String(year), repositories]),
    ),
  );

  // Top languages (FR-ORG-04).
  protected readonly languages = computed(() => ready(this.languagesLoader.state()));
  protected readonly languageBars = computed((): Bar[] => {
    const languages = this.languages();
    if (!languages) {
      return [];
    }
    const bars: Bar[] = languages.languages.map(({ name, repositories }) => ({
      label: name,
      value: repositories,
      color: this.data.languageColor()(name),
    }));
    if (languages.other > 0) {
      bars.push({ label: OTHER, value: languages.other, color: 'var(--s-other)' });
    }
    return bars;
  });
  protected readonly languagesSummary = computed(() => {
    const languages = this.languages();
    const [top] = languages?.languages ?? [];
    return top ? languagesDescription(top, total(languages!.languages, languages!.other)) : '';
  });

  protected readonly LANGUAGES_HEADERS = LANGUAGES_HEADERS;
  protected readonly LAST_PUSH_SUMMARY = LAST_PUSH_SUMMARY;
  protected readonly POPULAR = POPULAR;
  protected readonly RECENTLY_PUSHED = RECENTLY_PUSHED;
  protected readonly VIEW_ALL_REPOSITORIES = VIEW_ALL_REPOSITORIES;
  protected readonly VIEW_ALL = VIEW_ALL;
  protected readonly NO_REPOSITORIES = NO_REPOSITORIES;
  protected readonly NO_STARRED = NO_STARRED;
  protected readonly NO_LANGUAGES = NO_LANGUAGES;
}

/** The data of a loader's `state`, once it has loaded. */
export function ready<T>(state: { status: string; data?: T }): T | undefined {
  return state.status === 'ready' ? state.data : undefined;
}

/** A chart's table, of `rows` of a label and a count. */
function table(
  headers: readonly [string, string],
  rows: [string, number][],
): ChartTable | undefined {
  return rows.length > 0
    ? { headers, rows: rows.map(([label, value]) => ({ label, value: exactNumber(value) })) }
    : undefined;
}

/** How many repositories have a primary language, those of `languages` and the `other`. */
function total(languages: LanguageCount[], other: number): number {
  return languages.reduce((total, language) => total + language.repositories, other);
}

/** The labels of the years, short when there are many, every other one minor when more. */
function yearTicks(years: YearCount[]): Tick[] {
  const many = years.length > 6;
  return years.map(({ year }, at) => ({
    at,
    label: many ? `’${String(year).slice(-2)}` : String(year),
    minor: years.length > 8 && at % 2 === 1,
  }));
}

/** The 8 topics of the most of `repositories`, most first, then by name. */
function topics(repositories: ListedRepository[]): string[] {
  const counts = new Map<string, number>();
  for (const repository of repositories) {
    for (const topic of repository.topics) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, 8)
    .map(([topic]) => topic);
}
