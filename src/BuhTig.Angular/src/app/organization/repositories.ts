import {
  Component,
  DOCUMENT,
  ElementRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, NavigationStart, Router } from '@angular/router';
import { AccountData } from '../dashboard/data';
import { ListedRepository } from '../dashboard/resources';
import { exactNumber } from '../format/format';
import { Icon } from '../icon/icon';
import { Motion } from '../motion/motion';
import { Toasts } from '../toast/toasts';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import {
  ALL_LANGUAGES,
  COPY_LINK,
  COPY_LINK_FAILED,
  FIND_REPOSITORY,
  LINK_COPIED,
  NO_REPOSITORIES,
  SORTS,
  TYPES,
  listed,
  noMatch,
} from './messages';
import { LIST_PARAMS, ListView, queryOf, viewOf } from './query';
import { RepositoryRow } from './repository-row';
import {
  Filter,
  RepositoryType,
  Sort,
  languagesOf,
  matches,
  pageOf,
  pagesAround,
  sameLanguage,
  sorted,
} from './table';

/** What marks the navigations that the list starts itself, as the user changes what it shows. */
const LIST_EDIT = Symbol('repository list edit');

/**
 * An organization's Repositories tab (FR-ORG-03), and a user's (FR-USER-04): its repositories, found by name, filtered by
 * type and primary language, in the order the user picks, 25 to a page, each with what GitHub
 * says of it and its recent commits. Each opens its dashboard. How many match, and which page
 * shows, is announced as it changes.
 *
 * What the list shows is in its URL's query, as on GitHub, so that it can be bookmarked, shared
 * with "Copy link", reloaded, and stepped through with Back and Forward. Each filter, order or
 * page the user picks is a step of the history. What they type in the search box is one step,
 * whatever its length. A new filter or order shows the first page again. A page past the last is
 * the last, once the list knows how many there are. What only the sender could see, such as a
 * language of private repositories alone, stays chosen, and nothing matches it: the list is the
 * viewer's own, with their credentials and cache (FR-ACC-06, FR-DATA-04).
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
  private readonly data = inject(AccountData);
  private readonly motion = inject(Motion);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  private readonly toasts = inject(Toasts);
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly repositories = emptyWhen(
    this.data.repositories(),
    (repositories) => repositories.length === 0,
  );

  private readonly all = computed((): ListedRepository[] => {
    const state = this.repositories.state();
    return state.status === 'ready' ? state.data : [];
  });

  /**
   * What the list shows, as its URL says, and as the user changes it at once, without waiting for
   * the URL to follow.
   */
  private readonly view = signal<ListView>(viewOf(this.route.snapshot.queryParamMap));
  protected readonly filter = computed(() => this.view().filter);
  protected readonly sort = computed(() => this.view().sort);
  /** Whether what the user types in the search box takes the place of the step before. */
  private typing = false;
  /** Whether the browser would not copy the link, until the list shows something else. */
  protected readonly copyFailed = linkedSignal({ source: this.view, computation: () => false });

  /** The languages of the repositories, and the one chosen, even if none of them has it. */
  protected readonly languages = computed(() => {
    const languages = languagesOf(this.all());
    const chosen = this.filter().language;
    return chosen === undefined || languages.some((language) => sameLanguage(language, chosen))
      ? languages
      : [...languages, chosen].sort((a, b) => a.localeCompare(b));
  });
  protected readonly hasHidden = computed(() =>
    this.all().some((repository) => repository.visibility !== 'public'),
  );
  /** The types, public and private ones only for a viewer who has any, or who chose one. */
  protected readonly types = computed(() =>
    (Object.keys(TYPES) as RepositoryType[]).filter(
      (type) =>
        this.hasHidden() ||
        (type !== 'public' && type !== 'private') ||
        type === this.filter().type,
    ),
  );

  protected readonly matching = computed(() =>
    sorted(
      this.all().filter((repository) => matches(repository, this.filter())),
      this.sort(),
    ),
  );
  protected readonly page = computed(() => pageOf(this.matching(), this.view().page));
  protected readonly pages = computed(() => pagesAround(this.page().index, this.page().count));

  protected readonly status = computed(() => {
    const count = this.matching().length;
    const page = this.page();
    return count > 0 ? listed(count, this.filter().name.trim(), page.index + 1, page.count) : '';
  });

  protected readonly noMatch = computed(() => noMatch(this.data.displayName()));

  constructor() {
    this.spellInUrl();
    // Back and Forward, and links to the list, show what their URL says. The list's own
    // navigations show what it already shows.
    let own = false;
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        own = this.router.currentNavigation()?.extras.info === LIST_EDIT;
      } else if (event instanceof NavigationEnd && !own) {
        this.typing = false;
        this.view.set(viewOf(this.route.snapshot.queryParamMap));
        this.spellInUrl();
      }
    });

    // A page past the last is the last, in the URL too, once the list knows how many there are,
    // as when a link names one, or a refresh brings fewer.
    effect(() => {
      const status = this.repositories.state().status;
      const view = this.view();
      const shown = this.page().index;
      if ((status === 'ready' || status === 'empty') && view.page !== shown) {
        this.show({ ...view, page: shown }, true);
      }
    });
  }

  protected setFilter(change: Partial<Filter>): void {
    const typing = change.name !== undefined;
    this.show(
      { ...this.view(), filter: { ...this.filter(), ...change }, page: 0 },
      typing && this.typing,
    );
    this.typing = typing;
  }

  protected setSort(sort: string): void {
    this.typing = false;
    this.show({ ...this.view(), sort: sort as Sort, page: 0 }, false);
  }

  /** Shows the page at `index`, from the top of the list. */
  protected go(index: number): void {
    this.typing = false;
    this.show({ ...this.view(), page: index }, false);
    this.search()?.nativeElement.scrollIntoView({
      block: 'start',
      behavior: this.motion.full() ? 'smooth' : 'auto',
    });
  }

  /** Whether `language` is the one chosen. */
  protected chosen(language: string): boolean {
    const chosen = this.filter().language;
    return chosen !== undefined && sameLanguage(chosen, language);
  }

  /**
   * Copies the link to the list as it is shown. Where the browser will not copy, the list says so
   * beside the button, and that the address bar has the same link (NFR-UX-06).
   */
  protected async copyLink(): Promise<void> {
    const link = this.document.location.origin + this.router.serializeUrl(this.urlOf(this.view()));
    const clipboard = this.document.defaultView?.navigator.clipboard;
    try {
      if (!clipboard) {
        throw new Error('no clipboard');
      }
      await clipboard.writeText(link);
    } catch {
      this.copyFailed.set(true);
      return;
    }
    this.copyFailed.set(false);
    this.toasts.show(LINK_COPIED, 'link');
  }

  /**
   * Spells the view in the URL as the list does, in place of what the URL says, where it says it
   * otherwise: with GitHub's names, and without what it does not know, or what is as the list
   * starts, so that the URL and what the list shows agree.
   */
  private spellInUrl(): void {
    const params = this.route.snapshot.queryParamMap;
    const query = queryOf(this.view());
    if (LIST_PARAMS.some((name) => params.get(name) !== query[name])) {
      this.show(this.view(), true);
    }
  }

  /**
   * Shows `view`, and puts it in the URL, as a new step of the history, or in place of the one
   * there if `replace`.
   */
  private show(view: ListView, replace: boolean): void {
    this.view.set(view);
    void this.router.navigateByUrl(this.urlOf(view), { replaceUrl: replace, info: LIST_EDIT });
  }

  /** The URL of the dashboard with the list showing `view`, and the rest of its query as it is. */
  private urlOf(view: ListView) {
    return this.router.createUrlTree([], {
      relativeTo: this.route,
      queryParams: queryOf(view),
      queryParamsHandling: 'merge',
    });
  }

  protected readonly page1 = (index: number) => exactNumber(index + 1);
  protected readonly TYPES = TYPES;
  protected readonly SORTS = SORTS;
  protected readonly sortKeys = Object.keys(SORTS) as Sort[];
  protected readonly ALL_LANGUAGES = ALL_LANGUAGES;
  protected readonly COPY_LINK = COPY_LINK;
  protected readonly COPY_LINK_FAILED = COPY_LINK_FAILED;
  protected readonly FIND_REPOSITORY = FIND_REPOSITORY;
  protected readonly NO_REPOSITORIES = NO_REPOSITORIES;
}
