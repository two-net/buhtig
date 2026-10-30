import {
  Component,
  ElementRef,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { OrganizationData } from '../dashboard/data';
import { ListedRepository } from '../dashboard/resources';
import { exactNumber } from '../format/format';
import { Icon } from '../icon/icon';
import { Motion } from '../motion/motion';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import {
  ALL_LANGUAGES,
  FIND_REPOSITORY,
  NO_REPOSITORIES,
  SORTS,
  TYPES,
  listed,
  noMatch,
} from './messages';
import { RepositoryRow } from './repository-row';
import {
  Filter,
  NO_FILTER,
  RepositoryType,
  Sort,
  languagesOf,
  matches,
  pageOf,
  pagesAround,
  sorted,
} from './table';

/**
 * An organization's Repositories tab (FR-ORG-03): its repositories, found by name, filtered by
 * type and primary language, in the order the user picks, 25 to a page, each with what GitHub
 * says of it and its recent commits. Each opens its dashboard. How many match, and which page
 * shows, is announced as it changes.
 */
@Component({
  selector: 'app-organization-repositories-tab',
  imports: [Icon, Loaded, RepositoryRow, Widget],
  templateUrl: './repositories.html',
  styles: `
    .panel {
      padding-top: 8px;
    }
    .panel ::ng-deep .w {
      border: 0;
    }
    .panel ::ng-deep .w-head {
      display: none;
    }
    .panel ::ng-deep .w-body {
      padding: 0;
    }
  `,
})
export class OrganizationRepositoriesTab {
  private readonly data = inject(OrganizationData);
  private readonly motion = inject(Motion);
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly repositories = emptyWhen(
    this.data.repositories(),
    (repositories) => repositories.length === 0,
  );

  private readonly all = computed((): ListedRepository[] => {
    const state = this.repositories.state();
    return state.status === 'ready' ? state.data : [];
  });

  protected readonly filter = signal<Filter>(NO_FILTER);
  protected readonly sort = signal<Sort>('pushed');
  /** The page shown, back to the first whenever what the list holds changes. */
  protected readonly index = linkedSignal({
    source: () => ({ filter: this.filter(), sort: this.sort(), all: this.all() }),
    computation: () => 0,
  });

  protected readonly languages = computed(() => languagesOf(this.all()));
  protected readonly hasHidden = computed(() =>
    this.all().some((repository) => repository.visibility !== 'public'),
  );
  protected readonly types = computed(() =>
    (Object.keys(TYPES) as RepositoryType[]).filter(
      (type) => this.hasHidden() || (type !== 'public' && type !== 'private'),
    ),
  );

  protected readonly matching = computed(() =>
    sorted(
      this.all().filter((repository) => matches(repository, this.filter())),
      this.sort(),
    ),
  );
  protected readonly page = computed(() => pageOf(this.matching(), this.index()));
  protected readonly pages = computed(() => pagesAround(this.page().index, this.page().count));

  protected readonly status = computed(() => {
    const count = this.matching().length;
    const page = this.page();
    return count > 0 ? listed(count, this.filter().name.trim(), page.index + 1, page.count) : '';
  });

  protected readonly noMatch = computed(() => noMatch(this.data.displayName()));

  protected setFilter(change: Partial<Filter>): void {
    this.filter.update((filter) => ({ ...filter, ...change }));
  }

  protected setSort(sort: string): void {
    this.sort.set(sort as Sort);
  }

  /** Shows the page at `index`, from the top of the list. */
  protected go(index: number): void {
    this.index.set(index);
    this.search()?.nativeElement.scrollIntoView({
      block: 'start',
      behavior: this.motion.full() ? 'smooth' : 'auto',
    });
  }

  protected readonly page1 = (index: number) => exactNumber(index + 1);
  protected readonly TYPES = TYPES;
  protected readonly SORTS = SORTS;
  protected readonly sortKeys = Object.keys(SORTS) as Sort[];
  protected readonly ALL_LANGUAGES = ALL_LANGUAGES;
  protected readonly FIND_REPOSITORY = FIND_REPOSITORY;
  protected readonly NO_REPOSITORIES = NO_REPOSITORIES;
}
