import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ListedRepository, Resources } from '../dashboard/resources';
import { CompactNumber } from '../format/compact-number';
import { RelativeTime } from '../format/relative-time';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { NO_MATCH, pageRange, repositoryCount } from './messages';
import {
  DEFAULT_SORT,
  Filter,
  NO_FILTER,
  RepositoryType,
  Sort,
  SortColumn,
  languagesOf,
  matches,
  pageOf,
  sorted,
} from './table';

let count = 0;

/**
 * An organization's repository table (FR-ORG-03): each repository's name, with badges for
 * private and internal ones (FR-ORG-09), forks and archived ones, and its description, primary
 * language, stars, forks, open issues and pull requests, and last push. It sorts by each figure
 * and the last push, pushed to most recently first to begin with, filters by name, type and
 * language, and shows 25 repositories at a time. Selecting a repository opens its dashboard.
 *
 * The server gives every repository the dashboard reads, so that sorting, filtering and paging
 * need no more requests. Each starts afresh for each organization.
 */
@Component({
  selector: 'app-organization-repositories',
  imports: [CompactNumber, Loaded, RelativeTime, RouterLink, Widget],
  templateUrl: './repositories.html',
  styleUrl: './repositories.css',
})
export class OrganizationRepositories {
  private readonly resources = inject(Resources);
  private readonly router = inject(Router);

  /** The organization's login, as the URL has it. */
  readonly org = input.required<string>();

  /** What the ids of its controls start with, so that their labels name them. */
  protected readonly id = `repositories-${count++}`;

  protected readonly repositories = load(
    () => this.resources.organizationRepositories(this.org()),
    (repositories) => repositories.length === 0,
  );

  protected readonly filter = linkedSignal<string, Filter>({
    source: this.org,
    computation: () => NO_FILTER,
  });
  protected readonly sort = linkedSignal<string, Sort>({
    source: this.org,
    computation: () => DEFAULT_SORT,
  });

  /** All the repositories, once they have loaded. */
  private readonly all = computed(() => {
    const state = this.repositories.state();
    return state.status === 'ready' ? state.data : [];
  });
  protected readonly languages = computed(() => languagesOf(this.all()));
  /** The repositories that the filter lets through, in the table's order. */
  protected readonly matching = computed(() =>
    sorted(
      this.all().filter((repository) => matches(repository, this.filter())),
      this.sort(),
    ),
  );
  /** The page shown, which is the first again whenever the filter or the order changes. */
  private readonly pageIndex = linkedSignal<ListedRepository[], number>({
    source: this.matching,
    computation: () => 0,
  });
  protected readonly page = computed(() => pageOf(this.matching(), this.pageIndex()));
  /** What the table shows, in words, for assistive technology too. */
  protected readonly status = computed(() => {
    const count = this.matching().length;
    const page = this.page();
    if (count === 0) {
      return NO_MATCH;
    }
    return page.count > 1 ? pageRange(page.first, page.last, count) : repositoryCount(count);
  });

  protected filterByName(name: string): void {
    this.filter.update((filter) => ({ ...filter, name }));
  }

  protected filterByType(type: string): void {
    this.filter.update((filter) => ({ ...filter, type: type as RepositoryType }));
  }

  protected filterByLanguage(language: string): void {
    this.filter.update((filter) => ({ ...filter, language: language || undefined }));
  }

  /** Sorts by `column`, the most or the latest first, or the other way round if it is already. */
  protected sortBy(column: SortColumn): void {
    this.sort.update((sort) => ({
      column,
      direction:
        sort.column === column && sort.direction === 'descending' ? 'ascending' : 'descending',
    }));
  }

  /** The order of `column`, as `aria-sort` names it. */
  protected order(column: SortColumn): Sort['direction'] | 'none' {
    const sort = this.sort();
    return sort.column === column ? sort.direction : 'none';
  }

  protected previous(): void {
    this.pageIndex.set(Math.max(this.page().index - 1, 0));
  }

  protected next(): void {
    this.pageIndex.set(Math.min(this.page().index + 1, this.page().count - 1));
  }

  /**
   * Opens the dashboard of the repository whose row was clicked, as its name's link does. Not
   * for a click on what does something else, such as a figure that shows its exact value, nor
   * for one that selects text or is meant for the browser.
   */
  protected open(event: MouseEvent, repository: ListedRepository): void {
    const target = event.target;
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      (target instanceof Element && target.closest('a, button, app-exact') !== null) ||
      (getSelection()?.toString() ?? '') !== ''
    ) {
      return;
    }
    void this.router.navigateByUrl(repository.path);
  }
}
