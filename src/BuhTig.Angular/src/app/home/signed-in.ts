import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { Avatar } from '../avatar/avatar';
import { CompactNumber } from '../format/compact-number';
import { RelativeTime } from '../format/relative-time';
import { Header } from '../header/header';
import { Icon } from '../icon/icon';
import { RecentRepository } from '../recent/recent';
import { Search } from '../search/search';
import { Shortcut as SlashShortcut } from '../search/shortcut';
import { Session } from '../session/session';
import { HomeStyles } from '../styles/styles';
import { Personal } from '../shortcuts/personal';
import { pick } from '../shortcuts/pick';
import {
  FIND_DASHBOARD,
  KEYBOARD,
  NOTHING_RECENT,
  NO_DASHBOARDS,
  NO_MATCHES,
  PINNED,
  PRIVATE_REPOSITORIES,
  RECENTLY_VIEWED,
  RECENT_HEADING,
  SHORTCUTS_UNAVAILABLE,
  TOKEN_TEXTS,
  TOP_DASHBOARDS,
} from './signed-in-messages';

/**
 * The signed-in user's home page: their dashboards, pinned ones first, then those they opened
 * lately, which they can find by name (FR-SRCH-08); the search box; the public repositories
 * opened on this BuhTig lately; and what a personal access token would add, and the keys BuhTig
 * answers to.
 */
@Component({
  selector: 'app-signed-in-home',
  imports: [Avatar, CompactNumber, Header, HomeStyles, Icon, RelativeTime, RouterLink, Search],
  templateUrl: './signed-in.html',
})
export class SignedInHome {
  private readonly session = inject(Session);
  private readonly slash = inject(SlashShortcut).enabled;

  /** What others opened here lately, once known. */
  readonly recent = input<RecentRepository[] | undefined>(undefined);

  readonly search = viewChild.required('dash', { read: Search });

  /** The user's dashboards, pins first, once the server says, or `null` if it cannot. */
  private readonly dashboards = toSignal(
    inject(Personal)
      .list()
      .pipe(
        map(({ pins, recent }) => pick(pins, recent)),
        catchError(() => of(null)),
      ),
  );

  protected readonly query = signal('');
  protected readonly shown = computed(() => {
    const query = this.query().trim().toLowerCase();
    return (this.dashboards() ?? []).filter((item) => item.name.toLowerCase().includes(query));
  });
  protected readonly empty = computed(() => {
    const dashboards = this.dashboards();
    if (dashboards === null) {
      return SHORTCUTS_UNAVAILABLE;
    }
    return dashboards === undefined || this.shown().length > 0
      ? undefined
      : dashboards.length === 0
        ? NO_DASHBOARDS
        : NO_MATCHES;
  });

  /** The colors of the feed's languages, those of the most repositories in the chart's colors. */
  protected readonly languageColor = computed(() => {
    const counts = new Map<string, number>();
    for (const { language } of this.recent() ?? []) {
      if (language) {
        counts.set(language, (counts.get(language) ?? 0) + 1);
      }
    }
    const ranked = [...counts.entries()].sort(([, a], [, b]) => b - a).slice(0, 8);
    const colors = new Map(ranked.map(([name], index) => [name, `var(--s${index + 1})`]));
    return (language: string) => colors.get(language) ?? 'var(--s-other)';
  });

  protected readonly token = computed(() => {
    const token = this.session.token();
    return !token ? 'none' : token.status;
  });
  protected readonly tokenText = computed(() => TOKEN_TEXTS[this.token()]);
  protected readonly slashOn = this.slash;

  protected readonly TOP_DASHBOARDS = TOP_DASHBOARDS;
  protected readonly FIND_DASHBOARD = FIND_DASHBOARD;
  protected readonly PINNED = PINNED;
  protected readonly RECENTLY_VIEWED = RECENTLY_VIEWED;
  protected readonly RECENT_HEADING = RECENT_HEADING;
  protected readonly NOTHING_RECENT = NOTHING_RECENT;
  protected readonly PRIVATE_REPOSITORIES = PRIVATE_REPOSITORIES;
  protected readonly KEYBOARD = KEYBOARD;
}
