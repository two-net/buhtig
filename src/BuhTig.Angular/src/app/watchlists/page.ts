import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { Avatar } from '../avatar/avatar';
import { Center } from '../center/center';
import { Dialog } from '../dialog/dialog';
import { GITHUB_HOST } from '../github/host';
import { Header } from '../header/header';
import { Icon } from '../icon/icon';
import { problemMessage as searchProblem } from '../search/messages';
import { parse } from '../search/parse';
import { Session, signInUrl } from '../session/session';
import { Personal } from '../shortcuts/personal';
import { PageStyles, WatchlistStyles } from '../styles/styles';
import { Toasts } from '../toast/toasts';
import { WatchlistEntry } from './entry';
import {
  ADD,
  ADD_ALL,
  ADD_REPOSITORY,
  ALL_WATCHLISTS,
  CANCEL,
  CREATE,
  DELETE,
  DELETE_WATCHLIST,
  FROM_YOUR_PINS,
  NAME_LABEL,
  NAME_PLACEHOLDER,
  NEW_WATCHLIST,
  NOT_A_REPOSITORY,
  NO_REPOSITORIES,
  NO_SUCH_WATCHLIST,
  NO_SUCH_WATCHLIST_TEXT,
  NO_WATCHLISTS,
  RENAME,
  RENAME_HEADING,
  SAVE,
  SIGN_IN_FIRST,
  SIGN_IN_FOR_WATCHLISTS,
  SIGN_IN_WITH_GITHUB,
  TRY_AGAIN,
  TRY_AGAIN_SOON,
  WATCHLISTS,
  WATCHLISTS_PURPOSE,
  WATCHLISTS_UNAVAILABLE,
  WATCHLIST_PURPOSE,
  addPinLabel,
  addPlaceholder,
  addedPins,
  addedTo,
  alreadyIn,
  created,
  deleteWarning,
  deleted,
  moveDownLabel,
  moveUpLabel,
  movedDown,
  movedUp,
  problemMessage,
  removeLabel,
  removedFrom,
  renamedTo,
  repositoryCount,
  startWithPins,
  watchlistCount,
} from './messages';
import { Slots } from './slots';
import {
  MAX_REPOSITORIES,
  MAX_WATCHLISTS,
  Watchlist,
  WatchlistProblem,
  Watchlists,
  nameProblem,
  sameRepository,
} from './watchlists';

/**
 * A signed-in user's watchlists, at `/-/watchlists/{id}` (FR-PERS-06 to FR-PERS-08): beside, the
 * list of them, which leads to each, and a way to make another; and the one at the URL, with each
 * of its repositories as a row of what GitHub shows the viewer of it (FR-PERS-08). The user may
 * rename it or delete it, add repositories in any form of SRS Table 4-1 or from their pins, put them
 * in another order, and take them out (FR-PERS-07). `/-/watchlists` shows the first, or says that
 * there are none yet, and how to make one.
 *
 * A watchlist is the user's alone: another's URL shows no more than one that does not exist. A
 * visitor is asked to sign in (FR-ACC-02). Each change is a button, which keeps or hands on focus
 * as Settings' do (NFR-UX-03), and is said in a toast; what fails is said where it was tried.
 *
 * The page has its own slots, through which its rows ask the server for their data, a few at a
 * time (FR-PERS-09).
 */
@Component({
  selector: 'app-watchlists',
  imports: [
    Avatar,
    Center,
    Dialog,
    Header,
    Icon,
    PageStyles,
    RouterLink,
    WatchlistEntry,
    WatchlistStyles,
  ],
  templateUrl: './page.html',
  providers: [Slots],
})
export class WatchlistsPage {
  /** The watchlist's ID at the URL, unless it names none, as `/-/watchlists` does. */
  readonly id = input<string | undefined>(undefined);

  private readonly watchlists = inject(Watchlists);
  private readonly personal = inject(Personal);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** `github.host`, of the repository URLs it takes. */
  private readonly gitHub = inject(GITHUB_HOST);

  protected readonly user = inject(Session).user;
  protected readonly signIn = signInUrl('/-/watchlists');

  /** The user's watchlists, once the server says. */
  protected readonly lists = signal<Watchlist[] | undefined>(undefined);
  /** Whether the server could not say what the user's watchlists are. */
  protected readonly failed = signal(false);
  private readonly attempts = signal(0);

  /** The user's pinned repositories, in their order, to offer to add (FR-PERS-07). */
  protected readonly pins = signal<string[]>([]);

  /** The watchlist at the URL, if the user has it. */
  protected readonly current = computed(() => {
    const id = this.id();
    return this.lists()?.find((list) => String(list.id) === id);
  });

  /** The ID of the watchlist just deleted, whose URL the page is leaving. */
  private readonly gone = signal<string | undefined>(undefined);

  /** Whether the URL names a watchlist that the user does not have. */
  protected readonly missing = computed(
    () =>
      this.id() !== undefined &&
      this.id() !== this.gone() &&
      this.lists() !== undefined &&
      this.current() === undefined,
  );

  /** The user's pinned repositories that are not in the watchlist at the URL. */
  protected readonly unlisted = computed(() => {
    const listed = this.current()?.repositories ?? [];
    return this.pins().filter((pin) => !listed.some((name) => sameRepository(name, pin)));
  });

  /** Whether the server is changing the user's watchlists. */
  protected readonly busy = signal(false);
  /** Why the last change of the watchlist's repositories did not happen, if it did not. */
  protected readonly problem = signal('');

  /** What the input that adds a repository holds, and why it was not added, if it was not. */
  protected readonly draft = signal('');
  protected readonly addProblem = signal('');

  /** Which dialog is open, if any, what its name input holds, and why it did not do as asked. */
  protected readonly dialog = signal<'create' | 'rename' | 'delete' | undefined>(undefined);
  protected readonly nameDraft = signal('');
  protected readonly withPins = signal(false);
  protected readonly dialogProblem = signal('');

  constructor() {
    const asked = computed(() => ({ user: this.user(), attempt: this.attempts() }));
    toObservable(asked)
      .pipe(
        switchMap(({ user }) =>
          user
            ? this.watchlists.list().pipe(
                map((lists) => ({ lists })),
                catchError(() => of({ lists: undefined })),
              )
            : of(undefined),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((answer) => {
        if (answer) {
          this.lists.set(answer.lists);
          this.failed.set(answer.lists === undefined);
        }
      });

    // The pinned repositories, to offer to add, if the server says what they are.
    toObservable(this.user)
      .pipe(
        switchMap((user) =>
          user
            ? this.personal.list().pipe(
                map(({ pins }) =>
                  pins.filter((pin) => pin.kind === 'repository').map((pin) => pin.name),
                ),
                catchError(() => of([])),
              )
            : of([]),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((pins) => this.pins.set(pins));

    // `/-/watchlists` shows the first watchlist, at its own URL, in place of its own.
    effect(() => {
      const first = this.lists()?.[0];
      if (this.id() === undefined && first !== undefined) {
        untracked(() => void this.show(first.id, true));
      }
    });
  }

  /** Asks the server again for the user's watchlists, after it failed to say. */
  protected reload(): void {
    this.failed.set(false);
    this.attempts.update((count) => count + 1);
  }

  protected openCreate(): void {
    this.nameDraft.set('');
    this.withPins.set(false);
    this.dialogProblem.set('');
    this.dialog.set('create');
  }

  protected openRename(): void {
    this.nameDraft.set(this.current()?.name ?? '');
    this.dialogProblem.set('');
    this.dialog.set('rename');
  }

  protected openDelete(): void {
    this.dialogProblem.set('');
    this.dialog.set('delete');
  }

  protected closeDialog(): void {
    if (!this.busy()) {
      this.dialog.set(undefined);
    }
  }

  /** Makes a watchlist of the name typed, with the user's pinned repositories if they chose to. */
  protected create(event: Event): void {
    event.preventDefault();
    const lists = this.lists() ?? [];
    if (this.busy()) {
      return;
    }
    const problem: WatchlistProblem | undefined =
      lists.length >= MAX_WATCHLISTS ? 'too_many_watchlists' : nameProblem(this.nameDraft(), lists);
    if (problem) {
      this.dialogProblem.set(problemMessage(problem));
      return;
    }
    const name = this.nameDraft().trim();
    this.busy.set(true);
    this.watchlists.create(name, this.withPins() ? this.pins() : []).subscribe({
      next: ({ id, watchlists }) => {
        this.busy.set(false);
        this.lists.set(watchlists);
        this.dialog.set(undefined);
        this.toasts.show(created(name), 'eye');
        void this.show(id).then(() => this.focus('main h1'));
      },
      error: (problem: WatchlistProblem) => this.dialogFailed(problem),
    });
  }

  /** Renames the watchlist to the name typed. */
  protected rename(event: Event): void {
    event.preventDefault();
    const current = this.current();
    if (this.busy() || current === undefined) {
      return;
    }
    const others = (this.lists() ?? []).filter((list) => list.id !== current.id);
    const problem = nameProblem(this.nameDraft(), others);
    if (problem) {
      this.dialogProblem.set(problemMessage(problem));
      return;
    }
    const name = this.nameDraft().trim();
    this.busy.set(true);
    this.watchlists.rename(current.id, name).subscribe({
      next: (lists) => {
        this.busy.set(false);
        this.lists.set(lists);
        this.dialog.set(undefined);
        this.toasts.show(renamedTo(name));
      },
      error: (problem: WatchlistProblem) => this.dialogFailed(problem),
    });
  }

  /** Deletes the watchlist, and shows the user's first, if they have another. */
  protected delete(): void {
    const current = this.current();
    if (this.busy() || current === undefined) {
      return;
    }
    this.busy.set(true);
    this.watchlists.remove(current.id).subscribe({
      next: (lists) => {
        this.busy.set(false);
        this.dialog.set(undefined);
        this.gone.set(String(current.id));
        this.lists.set(lists);
        this.toasts.show(deleted(current.name), 'trash');
        const next = lists[0];
        const shown = next
          ? this.show(next.id, true)
          : this.router.navigateByUrl('/-/watchlists', { replaceUrl: true });
        void shown.then(() => this.focus('main h1'));
      },
      error: (problem: WatchlistProblem) => this.dialogFailed(problem),
    });
  }

  /** Adds the repository typed, in any form of SRS Table 4-1 (FR-PERS-07). */
  protected addTyped(event: Event): void {
    event.preventDefault();
    const current = this.current();
    if (this.busy() || current === undefined) {
      return;
    }
    const parsed = parse(this.draft(), this.gitHub);
    if (!parsed.ok) {
      this.addProblem.set(searchProblem(parsed.problem, this.gitHub));
      return;
    }
    const resource = parsed.resource;
    if (resource.kind !== 'repository') {
      this.addProblem.set(NOT_A_REPOSITORY);
      return;
    }
    const name = `${resource.owner}/${resource.repo}`;
    if (current.repositories.some((listed) => sameRepository(listed, name))) {
      this.addProblem.set(alreadyIn(name));
      return;
    }
    if (current.repositories.length >= MAX_REPOSITORIES) {
      this.addProblem.set(problemMessage('too_many_repositories'));
      return;
    }
    this.start();
    this.watchlists.add(current.id, [name]).subscribe({
      next: (lists) => {
        this.done(lists, addedTo(name, current.name), 'check');
        this.draft.set('');
        this.focus('#watchlist-add');
      },
      error: (problem: WatchlistProblem) => {
        this.busy.set(false);
        this.addProblem.set(problemMessage(problem));
        this.focus('#watchlist-add');
      },
    });
  }

  /** Adds `pins`, some of the user's pinned repositories, to the watchlist (FR-PERS-07). */
  protected addPins(pins: string[]): void {
    const current = this.current();
    if (this.busy() || current === undefined || pins.length === 0) {
      return;
    }
    if (current.repositories.length + pins.length > MAX_REPOSITORIES) {
      this.problem.set(problemMessage('too_many_repositories'));
      return;
    }
    const first = this.unlisted().indexOf(pins[0]);
    this.start();
    this.watchlists.add(current.id, pins).subscribe({
      next: (lists) => {
        const told =
          pins.length === 1 ? addedTo(pins[0], current.name) : addedPins(pins.length, current.name);
        this.done(lists, told, 'check');
        // On the pin that took its place, or else the one before it, or else the input.
        const left = this.unlisted().length;
        this.focus(
          left > 0
            ? `.wl-pins > li:nth-child(${Math.min(first, left - 1) + 1}) button`
            : '#watchlist-add',
        );
      },
      error: (problem: WatchlistProblem) => this.fail(problem, '#watchlist-add'),
    });
  }

  /** Moves the repository at `index` one place up, or down for a `step` of 1 (FR-PERS-07). */
  protected move(index: number, step: -1 | 1): void {
    const current = this.current();
    if (this.busy() || current === undefined) {
      return;
    }
    const order = [...current.repositories];
    const [moved] = order.splice(index, 1);
    order.splice(index + step, 0, moved);
    this.start();
    this.watchlists.reorder(current.id, order).subscribe({
      next: (lists) => {
        this.done(lists, step < 0 ? movedUp(moved) : movedDown(moved), 'up');
        // On the button that moved it, unless it went as far as it goes that way.
        const repositories = this.current()?.repositories ?? [];
        const at = repositories.findIndex((name) => sameRepository(name, moved));
        const onward = step < 0 ? at > 0 : at < repositories.length - 1;
        const button = step < 0 === onward ? 'up' : 'down';
        this.focus(`.wl-rows > li:nth-child(${at + 1}) .${button}`);
      },
      error: (problem: WatchlistProblem) =>
        this.fail(problem, `.wl-rows > li:nth-child(${index + 1}) .${step < 0 ? 'up' : 'down'}`),
    });
  }

  /** Takes the repository at `index` out of the watchlist (FR-PERS-07). */
  protected drop(index: number): void {
    const current = this.current();
    const name = current?.repositories[index];
    if (this.busy() || current === undefined || name === undefined) {
      return;
    }
    this.start();
    this.watchlists.drop(current.id, name).subscribe({
      next: (lists) => {
        this.done(lists, removedFrom(name, current.name), 'trash');
        // On the repository that took its place, or else the one before it, or else the input.
        const left = this.current()?.repositories.length ?? 0;
        this.focus(
          left > 0
            ? `.wl-rows > li:nth-child(${Math.min(index, left - 1) + 1}) .remove`
            : '#watchlist-add',
        );
      },
      error: (problem: WatchlistProblem) =>
        this.fail(problem, `.wl-rows > li:nth-child(${index + 1}) .remove`),
    });
  }

  /** Shows the watchlist `id`, in place of the page at the URL if `replace`. */
  private show(id: number, replace = false): Promise<boolean> {
    return this.router.navigate(['/-', 'watchlists', String(id)], { replaceUrl: replace });
  }

  private start(): void {
    this.busy.set(true);
    this.problem.set('');
    this.addProblem.set('');
  }

  private done(lists: Watchlist[], told: string, icon: 'check' | 'up' | 'trash'): void {
    this.busy.set(false);
    this.lists.set(lists);
    this.toasts.show(told, icon);
  }

  /** Says why a change did not happen, with focus back on what made it, `selector`. */
  private fail(problem: WatchlistProblem, selector: string): void {
    this.busy.set(false);
    this.problem.set(problemMessage(problem));
    this.focus(selector);
  }

  private dialogFailed(problem: WatchlistProblem): void {
    this.busy.set(false);
    this.dialogProblem.set(problemMessage(problem));
  }

  /**
   * Focuses what `selector` finds, once the page shows the change, in place of the button that
   * made it, which is gone or was disabled meanwhile.
   */
  private focus(selector: string): void {
    afterNextRender(() => this.host.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }

  protected readonly placeholder = addPlaceholder(this.gitHub);
  protected readonly MAX_WATCHLISTS = MAX_WATCHLISTS;
  protected readonly watchlistCount = watchlistCount;
  protected readonly repositoryCount = repositoryCount;
  protected readonly startWithPins = startWithPins;
  protected readonly deleteWarning = deleteWarning;
  protected readonly addPinLabel = addPinLabel;
  protected readonly moveUpLabel = moveUpLabel;
  protected readonly moveDownLabel = moveDownLabel;
  protected readonly removeLabel = removeLabel;
  protected readonly WATCHLISTS = WATCHLISTS;
  protected readonly SIGN_IN_FOR_WATCHLISTS = SIGN_IN_FOR_WATCHLISTS;
  protected readonly SIGN_IN_FIRST = SIGN_IN_FIRST;
  protected readonly SIGN_IN_WITH_GITHUB = SIGN_IN_WITH_GITHUB;
  protected readonly WATCHLISTS_UNAVAILABLE = WATCHLISTS_UNAVAILABLE;
  protected readonly TRY_AGAIN_SOON = TRY_AGAIN_SOON;
  protected readonly TRY_AGAIN = TRY_AGAIN;
  protected readonly NO_WATCHLISTS = NO_WATCHLISTS;
  protected readonly WATCHLISTS_PURPOSE = WATCHLISTS_PURPOSE;
  protected readonly NO_SUCH_WATCHLIST = NO_SUCH_WATCHLIST;
  protected readonly NO_SUCH_WATCHLIST_TEXT = NO_SUCH_WATCHLIST_TEXT;
  protected readonly ALL_WATCHLISTS = ALL_WATCHLISTS;
  protected readonly NEW_WATCHLIST = NEW_WATCHLIST;
  protected readonly WATCHLIST_PURPOSE = WATCHLIST_PURPOSE;
  protected readonly NO_REPOSITORIES = NO_REPOSITORIES;
  protected readonly RENAME = RENAME;
  protected readonly RENAME_HEADING = RENAME_HEADING;
  protected readonly DELETE = DELETE;
  protected readonly DELETE_WATCHLIST = DELETE_WATCHLIST;
  protected readonly CREATE = CREATE;
  protected readonly CANCEL = CANCEL;
  protected readonly SAVE = SAVE;
  protected readonly NAME_LABEL = NAME_LABEL;
  protected readonly NAME_PLACEHOLDER = NAME_PLACEHOLDER;
  protected readonly ADD_REPOSITORY = ADD_REPOSITORY;
  protected readonly ADD = ADD;
  protected readonly ADD_ALL = ADD_ALL;
  protected readonly FROM_YOUR_PINS = FROM_YOUR_PINS;
}
