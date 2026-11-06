import {
  Component,
  ElementRef,
  ViewEncapsulation,
  afterRenderEffect,
  computed,
  inject,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, filter, of, switchMap, take } from 'rxjs';
import { GITHUB_HOST } from '../github/host';
import { Avatar } from '../avatar/avatar';
import { Dialog } from '../dialog/dialog';
import { Icon, IconName } from '../icon/icon';
import { Recent } from '../recent/recent';
import { Resource } from '../search/parse';
import { Session } from '../session/session';
import { PinsAndHistory, Personal } from '../shortcuts/personal';
import { segments } from './fuzzy';
import {
  HEADING,
  HINT,
  KEYS,
  LABEL,
  NO_MATCHES,
  PLACEHOLDER,
  START,
  SUGGESTIONS,
  resultCount,
  sourceLabel,
} from './messages';
import { Suggestion, suggest } from './suggest';

let count = 0;

/** The icon of each kind of resource that the user types. */
const ICONS: Record<Resource['kind'], IconName> = {
  repository: 'repo',
  organization: 'org',
  user: 'user',
  account: 'org',
};

const NONE: PinsAndHistory = { pins: [], recent: [] };

/**
 * The command palette (FR-SRCH-12), which Ctrl+K, or ⌘K, opens over any page: one input that
 * suggests, as the user types, the dashboards they pinned and viewed lately (§4.8) and the public
 * repositories opened on this BuhTig lately (FR-SRCH-11), best matches first, and the resource
 * that the input names in any form of SRS Table 4-1; and their tabs, of the name typed after them
 * (FR-SRCH-13).
 *
 * It is a combobox of a list, as WAI-ARIA has one (NFR-UX-03): ↑ and ↓ choose a suggestion, Enter
 * or a click opens it, and Esc closes the palette, which gives the focus back to what had it. It
 * fetches what it suggests from as it opens, from BuhTig alone, never from GitHub, and suggests
 * with each keystroke at once (NFR-PERF-06). Its code comes apart from the home page's
 * (NFR-PERF-02).
 */
@Component({
  selector: 'app-palette',
  imports: [Avatar, Dialog, Icon],
  templateUrl: './palette.html',
  styleUrls: ['../styles/dialog.css', './palette.css'],
  encapsulation: ViewEncapsulation.None,
})
export class Palette {
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  private readonly personalService = inject(Personal);
  private readonly recent = inject(Recent);
  private readonly host = inject(GITHUB_HOST);
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');

  /** Asked for as the palette closes, with Esc, beside it, or as it opens a dashboard. */
  readonly closed = output();

  protected readonly id = `palette-${count++}`;
  protected readonly query = signal('');

  /** Who is viewing, once BuhTig knows. */
  private readonly viewer = toObservable(this.session.user).pipe(
    filter((user) => user !== undefined),
    take(1),
  );
  /** The signed-in user's pins and history, which visitors have none of (FR-ACC-02). */
  private readonly personal = toSignal(
    this.viewer.pipe(
      switchMap((user) =>
        user ? this.personalService.list().pipe(catchError(() => of(NONE))) : of(NONE),
      ),
    ),
  );
  /**
   * The public repositories opened here lately, which private mode shows to signed-in users alone
   * (FR-ACC-03).
   */
  private readonly opened = toSignal(
    this.viewer.pipe(
      switchMap((user) =>
        !user && this.session.access() === 'private' ? of([]) : this.recent.list(),
      ),
    ),
  );

  protected readonly suggestions = computed(() => {
    const personal = this.personal() ?? NONE;
    return suggest(
      this.query(),
      {
        pins: personal.pins,
        recent: personal.recent,
        opened: this.opened() ?? [],
      },
      this.host,
    );
  });

  /** Each suggestion as the list shows it. */
  protected readonly rows = computed(() =>
    this.suggestions().items.map((item) => ({
      item,
      parts: segments(item.name, item.matches),
      source: sourceLabel(item.source, item.resource.kind),
    })),
  );

  /** The suggestion that Enter opens: the first, until ↑ or ↓ choose another. */
  protected readonly active = linkedSignal({ source: this.suggestions, computation: () => 0 });

  /** What the palette says while it suggests nothing. */
  protected readonly empty = computed(() => {
    const problem = this.suggestions().problem;
    if (problem !== undefined) {
      return { problem };
    }
    const loading = this.personal() === undefined || this.opened() === undefined;
    return this.query().trim() === ''
      ? loading
        ? undefined
        : { text: START }
      : { text: NO_MATCHES };
  });

  protected readonly status = computed(() => resultCount(this.rows().length));

  constructor() {
    // Keeps the chosen suggestion in view as ↑ and ↓ move through a long list.
    afterRenderEffect(() => {
      const option = this.list().nativeElement.children.item(this.active());
      // Not every environment can scroll; the tests' jsdom cannot.
      if (option !== null && typeof option.scrollIntoView === 'function') {
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  protected optionId(index: number): string {
    return `${this.id}-option-${index}`;
  }

  protected key(event: KeyboardEvent): void {
    // Enter that ends composing a character in an input method is the input method's.
    if (event.isComposing) {
      return;
    }
    const rows = this.rows();
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (rows.length > 0) {
          const step = event.key === 'ArrowDown' ? 1 : rows.length - 1;
          this.active.update((index) => (index + step) % rows.length);
        }
        break;
      case 'Enter': {
        event.preventDefault();
        const row = rows[this.active()];
        if (row !== undefined) {
          this.open(row.item);
        }
        break;
      }
    }
  }

  /** Closes the palette and opens `item`, whose page then takes the focus. */
  protected open(item: Suggestion): void {
    this.closed.emit();
    void this.router.navigateByUrl(item.path);
  }

  protected readonly ICONS = ICONS;
  protected readonly HEADING = HEADING;
  protected readonly LABEL = LABEL;
  protected readonly PLACEHOLDER = PLACEHOLDER;
  protected readonly HINT = HINT;
  protected readonly SUGGESTIONS = SUGGESTIONS;
  protected readonly KEYS = KEYS;
}
