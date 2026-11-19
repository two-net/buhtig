import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NEVER } from 'rxjs';
import { Avatar } from '../avatar/avatar';
import { Center } from '../center/center';
import { CompactNumber } from '../format/compact-number';
import { RelativeTime } from '../format/relative-time';
import { Header } from '../header/header';
import { Icon } from '../icon/icon';
import { Pager } from '../pager/pager';
import { Session, signInUrl } from '../session/session';
import { BrowseStyles, PageStyles } from '../styles/styles';
import { load } from '../widget/load';
import { BrowseData, BrowsedRepository } from './browse-data';
import {
  ANY_LANGUAGE,
  ANY_TOPIC,
  BROWSE,
  BROWSE_FAILED,
  BROWSE_FAILED_TEXT,
  CLEAR_FILTERS,
  LANGUAGE,
  NOTHING_TO_BROWSE,
  NOTHING_TO_BROWSE_TEXT,
  NO_MATCH,
  SIGN_IN_TEXT,
  SIGN_IN_TO_BROWSE,
  SIGN_IN_WITH_GITHUB,
  TOPIC,
  TRY_AGAIN,
  UPDATED,
  browsePurpose,
  browseStatus,
} from './messages';

/** How many repositories a page of the list shows. */
export const PAGE_SIZE = 25;

/** What the URL's query says the list shows: its filters, and its page, from 0. */
interface View {
  language: string | undefined;
  topic: string | undefined;
  page: number;
}

/**
 * The public repositories already in the shared cache, at `/-/browse` (FR-SRCH-14): those whose
 * dashboards were opened on this BuhTig lately, up to the cap the server says, latest first, each
 * with its description, primary language, stars, forks, last push and topics, and its name leading
 * to its dashboard. The viewer may narrow them to one language and one topic, and page through
 * them, 25 at a time, each in the URL's query, so that a link shows the same.
 *
 * Nothing here asks GitHub anything, nor records a view in anyone's history: opening a dashboard
 * does. The list holds nothing that a personal access token fetched (FR-DATA-04). In private
 * mode, a visitor is asked to sign in, and asks the server for nothing (FR-ACC-03).
 */
@Component({
  selector: 'app-browse',
  imports: [
    Avatar,
    BrowseStyles,
    Center,
    CompactNumber,
    Header,
    Icon,
    PageStyles,
    Pager,
    RelativeTime,
    RouterLink,
  ],
  templateUrl: './browse.html',
})
export class Browse {
  private readonly session = inject(Session);
  private readonly data = inject(BrowseData);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Whether the viewer must sign in first: a visitor, in private mode (FR-ACC-03). */
  protected readonly signInFirst = computed(
    () => this.session.user() === null && this.session.access() === 'private',
  );
  protected readonly signIn = signInUrl('/-/browse');

  /** The repositories, once BuhTig knows who is viewing, unless they must sign in first. */
  protected readonly listed = load(
    () => (this.session.user() === undefined || this.signInFirst() ? NEVER : this.data.list()),
    (browsed) => browsed.repositories.length === 0,
  );

  private readonly browsed = computed(() => {
    const state = this.listed.state();
    return state.status === 'ready' ? state.data : undefined;
  });
  private readonly repositories = computed(() => this.browsed()?.repositories ?? []);

  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly view = computed((): View => {
    const query = this.query();
    const text = (name: string) => query.get(name)?.trim() || undefined;
    const page = query.get('page');
    return {
      language: text('language'),
      topic: text('topic')?.toLowerCase(),
      page: page !== null && /^\d+$/.test(page) ? Math.max(Number(page) - 1, 0) : 0,
    };
  });

  protected readonly purpose = computed(() => browsePurpose(this.browsed()?.cap ?? 0));

  /** The languages to choose from, of the most repositories first, and the one chosen. */
  protected readonly languages = computed(() =>
    choices(
      this.repositories().map((repository) => repository.language),
      this.view().language,
    ),
  );
  /** The topics to choose from, of the most repositories first, and the one chosen. */
  protected readonly topics = computed(() =>
    choices(
      this.repositories().flatMap((repository) => repository.topics),
      this.view().topic,
    ),
  );

  /** The colors of their languages, those of the most repositories in the chart's colors. */
  protected readonly languageColor = computed(() => {
    const colors = new Map(
      this.languages()
        .slice(0, 8)
        .map((language, index) => [language.toLowerCase(), `var(--s${index + 1})`]),
    );
    return (language: string) => colors.get(language.toLowerCase()) ?? 'var(--s-other)';
  });

  /** Those of the language and the topic chosen, if any. */
  protected readonly matching = computed(() => {
    const { language, topic } = this.view();
    return this.repositories().filter(
      (repository) =>
        (language === undefined || same(repository.language, language)) &&
        (topic === undefined || repository.topics.some((other) => same(other, topic))),
    );
  });

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.matching().length / PAGE_SIZE)),
  );
  /** The page shown, from 0: the last, of a URL that names one past it. */
  protected readonly pageIndex = computed(() => Math.min(this.view().page, this.pageCount() - 1));
  protected readonly shown = computed((): BrowsedRepository[] => {
    const start = this.pageIndex() * PAGE_SIZE;
    return this.matching().slice(start, start + PAGE_SIZE);
  });

  protected readonly status = computed(() =>
    browseStatus(
      this.matching().length,
      this.repositories().length,
      this.pageIndex() + 1,
      this.pageCount(),
    ),
  );

  /** Narrows the list to `language`, or any, if empty, from its first page. */
  protected setLanguage(language: string): void {
    this.show({ ...this.view(), language: language || undefined, page: 0 });
  }

  /** Narrows the list to `topic`, or any, if empty, from its first page. */
  protected setTopic(topic: string): void {
    this.show({ ...this.view(), topic: topic || undefined, page: 0 });
  }

  protected go(page: number): void {
    this.show({ ...this.view(), page });
  }

  /** Whether `option` is the one chosen, `chosen`. */
  protected isChosen(option: string, chosen: string | undefined): boolean {
    return chosen !== undefined && same(option, chosen);
  }

  /** Shows `view`, with only what differs from the defaults in the URL. */
  private show({ language, topic, page }: View): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        language: language ?? null,
        topic: topic ?? null,
        page: page > 0 ? page + 1 : null,
      },
    });
  }

  protected readonly BROWSE = BROWSE;
  protected readonly LANGUAGE = LANGUAGE;
  protected readonly TOPIC = TOPIC;
  protected readonly ANY_LANGUAGE = ANY_LANGUAGE;
  protected readonly ANY_TOPIC = ANY_TOPIC;
  protected readonly NO_MATCH = NO_MATCH;
  protected readonly CLEAR_FILTERS = CLEAR_FILTERS;
  protected readonly NOTHING_TO_BROWSE = NOTHING_TO_BROWSE;
  protected readonly NOTHING_TO_BROWSE_TEXT = NOTHING_TO_BROWSE_TEXT;
  protected readonly BROWSE_FAILED = BROWSE_FAILED;
  protected readonly BROWSE_FAILED_TEXT = BROWSE_FAILED_TEXT;
  protected readonly TRY_AGAIN = TRY_AGAIN;
  protected readonly SIGN_IN_TO_BROWSE = SIGN_IN_TO_BROWSE;
  protected readonly SIGN_IN_TEXT = SIGN_IN_TEXT;
  protected readonly SIGN_IN_WITH_GITHUB = SIGN_IN_WITH_GITHUB;
  protected readonly UPDATED = UPDATED;
}

/** Whether `a` and `b` are the same language or topic, whatever their letter case. */
function same(a: string | undefined, b: string): boolean {
  return a !== undefined && a.toLowerCase() === b.toLowerCase();
}

/**
 * The values of `values` to choose from, each once, whatever its letter case, of the most first,
 * then by name, and `chosen` among them, last, if it is none of them, so that it shows as chosen.
 */
function choices(values: (string | undefined)[], chosen: string | undefined): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const value of values) {
    if (value) {
      const key = value.toLowerCase();
      const counted = counts.get(key) ?? { name: value, count: 0 };
      counts.set(key, { ...counted, count: counted.count + 1 });
    }
  }
  const ranked = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map(({ name }) => name);
  return chosen !== undefined && !counts.has(chosen.toLowerCase()) ? [...ranked, chosen] : ranked;
}
