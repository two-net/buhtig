import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NEVER } from 'rxjs';
import { RouterLink } from '@angular/router';
import { Sparkline } from '../chart/sparkline';
import { OrganizationData } from '../dashboard/data';
import { ListedRepository, Resources } from '../dashboard/resources';
import { CompactNumber } from '../format/compact-number';
import { exactNumber } from '../format/format';
import { RelativeTime } from '../format/relative-time';
import { Icon } from '../icon/icon';
import { VISIBILITY } from '../repository/head';
import { load } from '../widget/load';
import { NO_DESCRIPTION, OPEN_ISSUES_AND_PULL_REQUESTS, sparklineLabel } from './messages';

/** How many weeks of commits a repository's row shows. */
const WEEKS = 26;

/**
 * A repository's commits per week over the last 26 weeks, as a sparkline beside its row. It
 * loads only once the row comes into view, so that a page of repositories asks GitHub for no
 * more than the user sees, and counts as a load of the organization's dashboard
 * (FR-DATA-10). While GitHub computes it, it waits, and asks again (FR-REPO-10).
 */
@Component({
  selector: 'app-repository-sparkline',
  imports: [Sparkline],
  template: `
    @switch (activity.state().status) {
      @case ('ready') {
        <span class="spark-wrap" role="img" [attr.aria-label]="label()">
          <app-sparkline [values]="weeks()" />
        </span>
      }
      @case ('error') {}
      @case ('empty') {}
      @default {
        <span class="spark waiting" aria-hidden="true"></span>
      }
    }
  `,
  styles: ':host { display: contents; } .spark-wrap { display: contents; }',
})
export class RepositorySparkline {
  private readonly resources = inject(Resources);

  readonly org = input.required<string>();
  readonly repo = input.required<string>();

  /** Whether the row has come into view, after which it stays loaded. */
  private readonly seen = signal(false);

  protected readonly activity = load(() => {
    this.resources.refreshes();
    return this.seen() ? this.resources.organizationActivity(this.org(), this.repo()) : NEVER;
  });

  protected readonly weeks = computed(() => {
    const state = this.activity.state();
    return state.status === 'ready'
      ? state.data.weeks.slice(-WEEKS).map((week) => week.commits)
      : [];
  });

  protected readonly label = computed(() =>
    sparklineLabel(this.weeks().reduce((total, commits) => total + commits, 0)),
  );

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Where the browser cannot tell what is in view, as the tests' jsdom cannot, it loads at once.
      if (typeof IntersectionObserver !== 'function') {
        this.seen.set(true);
        return;
      }
      const row = host.parentElement ?? host;
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.seen.set(true);
          observer.disconnect();
        }
      });
      observer.observe(row);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}

/**
 * One of an organization's repositories, as a row of its lists (FR-ORG-03): its name, linking to
 * its dashboard, badges for its visibility and for Archived and Fork, its description, primary
 * language, stars, forks, open issues and pull requests and when it was last pushed to, and its
 * recent commits as a sparkline.
 */
@Component({
  selector: 'app-repository-row',
  imports: [CompactNumber, Icon, RelativeTime, RepositorySparkline, RouterLink],
  template: `
    @let shown = repository();
    <div class="t">
      <h3>
        <a [routerLink]="shown.path">{{ shown.name }}</a>
        <span class="label">{{ VISIBILITY[shown.visibility] }}</span>
        @if (shown.archived) {
          <span class="label attention">Archived</span>
        }
        @if (shown.fork) {
          <span class="label">Fork</span>
        }
      </h3>
      @if (shown.description; as description) {
        <p>{{ description }}</p>
      }
      <div class="rmeta">
        @if (shown.language; as language) {
          <span
            ><span class="lang-dot" [style.background]="data.languageColor()(language)"></span
            >{{ language }}</span
          >
        }
        <span [title]="exactNumber(shown.stars) + ' stars'"
          ><app-icon name="star" /><app-compact-number [value]="shown.stars" [plain]="true"
        /></span>
        <span [title]="exactNumber(shown.forks) + ' forks'"
          ><app-icon name="fork" /><app-compact-number [value]="shown.forks" [plain]="true"
        /></span>
        <span [title]="OPEN_ISSUES"
          ><app-icon name="issue" />{{ exactNumber(shown.openIssuesAndPullRequests) }}
          <span class="sr">{{ OPEN_ISSUES }}</span></span
        >
        @if (shown.pushedAt; as pushedAt) {
          <span>Updated <app-relative-time [value]="pushedAt" /></span>
        }
      </div>
    </div>
    <app-repository-sparkline [org]="data.login()" [repo]="shown.name" />
  `,
  host: { class: 'repo-row' },
})
export class RepositoryRow {
  protected readonly data = inject(OrganizationData);

  readonly repository = input.required<ListedRepository>();

  protected readonly exactNumber = exactNumber;
  protected readonly VISIBILITY = VISIBILITY;
  protected readonly OPEN_ISSUES = OPEN_ISSUES_AND_PULL_REQUESTS;
}

/**
 * One of an organization's most-starred repositories, as a card (FR-ORG-05): its name, linking to
 * its dashboard, its visibility, description, primary language, stars and forks.
 */
@Component({
  selector: 'app-repository-card',
  imports: [CompactNumber, Icon, RouterLink],
  template: `
    @let shown = repository();
    <div class="c-head">
      <app-icon name="repo" />
      <a [routerLink]="shown.path">{{ shown.name }}</a>
      <span class="label">{{ VISIBILITY[shown.visibility] }}</span>
    </div>
    <p>{{ shown.description ?? NO_DESCRIPTION }}</p>
    <div class="rmeta">
      @if (shown.language; as language) {
        <span
          ><span class="lang-dot" [style.background]="data.languageColor()(language)"></span
          >{{ language }}</span
        >
      }
      <span
        ><app-icon name="star" /><app-compact-number [value]="shown.stars" [plain]="true"
      /></span>
      <span
        ><app-icon name="fork" /><app-compact-number [value]="shown.forks" [plain]="true"
      /></span>
    </div>
  `,
  host: { class: 'card' },
})
export class RepositoryCard {
  protected readonly data = inject(OrganizationData);

  readonly repository = input.required<ListedRepository>();

  protected readonly VISIBILITY = VISIBILITY;
  protected readonly NO_DESCRIPTION = NO_DESCRIPTION;
}
