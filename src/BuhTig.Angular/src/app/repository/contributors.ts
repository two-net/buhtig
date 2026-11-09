import { Component, computed, inject } from '@angular/core';
import { Bar, BarChart } from '../chart/hbars';
import { ChartTable } from '../chart/table';
import { RepositoryData } from '../dashboard/data';
import { BRANCH_COLUMNS, branchCells, exportName } from '../export/provenance';
import { exactNumber } from '../format/format';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import {
  CONTRIBUTORS_HEADERS,
  NO_CONTRIBUTORS,
  TOO_MANY_CONTRIBUTORS,
  contributorsDescription,
} from './messages';

/**
 * A repository's Contributors tab: its top 10 contributors by commits (FR-REPO-05), as bars, each
 * with the contributor's avatar and login, linking to their profile on GitHub (FR-REPO-12). When
 * GitHub does not list them, as for its largest repositories, it says so. Its CSV file lists
 * them as its table does, with how many there are in all, when GitHub says, and when they were
 * fetched (FR-EXP-02).
 */
@Component({
  selector: 'app-repository-contributors-tab',
  imports: [BarChart, Loaded, Widget],
  template: `
    <div class="stack-v">
      <app-widget
        heading="Contributors"
        [empty]="NO_CONTRIBUTORS"
        emptyIcon="people"
        skeleton="bars"
        [summary]="summary()"
        [table]="table()"
      >
        <ng-template [appLoaded]="contributors" let-contributors>
          @if (contributors.tooLarge) {
            <p class="w-state">
              <span>{{ TOO_MANY }}</span>
            </p>
          } @else {
            <app-bar-chart [bars]="bars()" unit="commits" [summary]="summary() ?? ''" />
          }
        </ng-template>
      </app-widget>
    </div>
  `,
})
export class RepositoryContributorsTab {
  private readonly data = inject(RepositoryData);

  protected readonly contributors = emptyWhen(
    this.data.contributors(),
    (contributors) => contributors.contributors.length === 0 && !contributors.tooLarge,
  );

  private readonly ready = computed(() => {
    const state = this.contributors.state();
    return state.status === 'ready' ? state.data : undefined;
  });
  private readonly listed = computed(() => this.ready()?.contributors ?? []);

  protected readonly bars = computed((): Bar[] =>
    this.listed().map((contributor) => ({
      label: contributor.login,
      value: contributor.commits,
      href: contributor.url,
      avatar: { name: contributor.login, src: contributor.avatarUrl },
    })),
  );

  protected readonly summary = computed(() =>
    this.listed().length > 0
      ? contributorsDescription(this.listed().length, this.data.repository()?.defaultBranch)
      : undefined,
  );

  protected readonly table = computed((): ChartTable | undefined => {
    const ready = this.ready();
    if (!ready || ready.contributors.length === 0) {
      return undefined;
    }
    const name = this.data.name();
    const provenance = branchCells(name, this.data.repository()?.defaultBranch, ready);
    return {
      headers: CONTRIBUTORS_HEADERS,
      rows: ready.contributors.map((contributor) => ({
        label: `@${contributor.login}`,
        values: [exactNumber(contributor.commits)],
      })),
      csv: {
        name: exportName(name, 'contributors'),
        columns: [
          'rank',
          'login',
          'commits',
          'profile_url',
          'contributors_total',
          ...BRANCH_COLUMNS,
        ],
        rows: ready.contributors.map((contributor, index) => [
          index + 1,
          contributor.login,
          contributor.commits,
          contributor.url,
          ready.count,
          ...provenance,
        ]),
      },
    };
  });

  protected readonly NO_CONTRIBUTORS = NO_CONTRIBUTORS;
  protected readonly TOO_MANY = TOO_MANY_CONTRIBUTORS;
}
