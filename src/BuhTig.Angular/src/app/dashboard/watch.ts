import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Dialog } from '../dialog/dialog';
import { Icon } from '../icon/icon';
import { Known } from '../search/parse';
import { Session } from '../session/session';
import { Toasts } from '../toast/toasts';
import {
  ADD_TO_WATCHLIST,
  CHOOSE_WATCHLISTS,
  CREATE,
  DONE,
  LOADING_WATCHLISTS,
  MANAGE_WATCHLISTS,
  NEW_WATCHLIST_NAME,
  NO_WATCHLISTS_YET,
  NAME_PLACEHOLDER,
  WATCHLISTS_FAILED,
  addToHeading,
  addedTo,
  problemMessage,
  removedFrom,
  repositoryCount,
} from '../watchlists/messages';
import {
  MAX_REPOSITORIES,
  MAX_WATCHLISTS,
  Watchlist,
  WatchlistProblem,
  Watchlists,
  nameProblem,
  sameRepository,
} from '../watchlists/watchlists';

let count = 0;

/**
 * "Add to watchlist…" in a repository dashboard's head, for signed-in users alone (FR-PERS-07,
 * FR-ACC-02): a dialog with a box for each of their watchlists, ticked for those that hold the
 * repository, which adds it or takes it out as it is ticked, and a way to make another watchlist
 * with the repository in it. It says when a watchlist, or the user, has as many as they may, and
 * leads to the watchlists themselves.
 *
 * It asks for the user's watchlists only once it is opened. While the server is asked, ticking does
 * nothing more.
 */
@Component({
  selector: 'app-watch',
  imports: [Dialog, Icon, RouterLink],
  template: `
    @if (user() && repository(); as repository) {
      <button type="button" class="btn sm" (click)="open()">
        <app-icon name="eye" />{{ ADD_TO_WATCHLIST }}
      </button>
      @if (opened()) {
        <app-dialog [heading]="heading()" (closed)="close()">
          @if (failed()) {
            <p class="field-msg err" role="alert">
              <app-icon name="alert" />{{ WATCHLISTS_FAILED }}
            </p>
          } @else if (lists(); as lists) {
            @if (lists.length > 0) {
              <p>{{ CHOOSE_WATCHLISTS }}</p>
              <ul class="choices">
                @for (list of lists; track list.id) {
                  <li>
                    <label>
                      <input
                        #box
                        type="checkbox"
                        [checked]="holds(list)"
                        (change)="toggle(list, box)"
                      />
                      <span class="grow">{{ list.name }}</span>
                      <small>{{ repositoryCount(list.repositories.length) }}</small>
                    </label>
                  </li>
                }
              </ul>
            } @else {
              <p>{{ NO_WATCHLISTS_YET }}</p>
            }
            <form [id]="id" novalidate (submit)="create($event)">
              <label [for]="id + '-name'">{{ NEW_WATCHLIST_NAME }}</label>
              <div class="inline">
                <input
                  #name
                  [id]="id + '-name'"
                  class="input"
                  type="text"
                  name="name"
                  autocomplete="off"
                  [placeholder]="NAME_PLACEHOLDER"
                  [value]="draft()"
                  [attr.aria-invalid]="problem() ? 'true' : null"
                  [attr.aria-describedby]="problem() ? id + '-problem' : null"
                  (input)="draft.set(name.value); problem.set('')"
                />
                <button type="submit" class="btn" [attr.aria-disabled]="busy() ? 'true' : null">
                  {{ CREATE }}
                </button>
              </div>
            </form>
            @if (problem(); as problem) {
              <p [id]="id + '-problem'" class="field-msg err" role="alert">
                <app-icon name="alert" />{{ problem }}
              </p>
            }
          } @else {
            <p role="status">{{ LOADING_WATCHLISTS }}</p>
          }
          <a actions class="btn" routerLink="/-/watchlists" (click)="close()">{{
            MANAGE_WATCHLISTS
          }}</a>
          <button actions type="button" class="btn primary" (click)="close()">{{ DONE }}</button>
        </app-dialog>
      }
    }
  `,
  styles: ':host { display: contents; }',
})
export class Watch {
  private readonly watchlists = inject(Watchlists);
  private readonly toasts = inject(Toasts);

  /** The dashboard's resource, with the names as GitHub spells them. */
  readonly resource = input.required<Known>();

  protected readonly user = inject(Session).user;
  protected readonly id = `watch-${count++}`;

  /** The repository's `owner/repo`, if the dashboard is a repository's: no account goes in one. */
  protected readonly repository = computed(() => {
    const resource = this.resource();
    return resource.kind === 'repository' ? `${resource.owner}/${resource.repo}` : undefined;
  });

  protected readonly heading = computed(() => addToHeading(this.repository() ?? ''));

  /** Whether the dialog shows. */
  protected readonly opened = signal(false);
  /** The user's watchlists, once the server says. */
  protected readonly lists = signal<Watchlist[] | undefined>(undefined);
  /** Whether the server could not say what the user's watchlists are. */
  protected readonly failed = signal(false);
  /** Whether the server is changing them. */
  protected readonly busy = signal(false);
  /** What the new watchlist's name input holds, and why the last change did not happen. */
  protected readonly draft = signal('');
  protected readonly problem = signal('');

  protected open(): void {
    this.opened.set(true);
    this.lists.set(undefined);
    this.failed.set(false);
    this.problem.set('');
    this.draft.set('');
    this.watchlists.list().subscribe({
      next: (lists) => this.lists.set(lists),
      error: () => this.failed.set(true),
    });
  }

  protected close(): void {
    this.opened.set(false);
  }

  /** Whether `list` holds the repository, whatever the case of its name. */
  protected holds(list: Watchlist): boolean {
    const repository = this.repository();
    return (
      repository !== undefined && list.repositories.some((name) => sameRepository(name, repository))
    );
  }

  /** Adds the repository to `list`, or takes it out, as `box` is now ticked or not. */
  protected toggle(list: Watchlist, box: HTMLInputElement): void {
    const repository = this.repository();
    const holds = this.holds(list);
    if (this.busy() || repository === undefined || box.checked === holds) {
      box.checked = holds;
      return;
    }
    if (!holds && list.repositories.length >= MAX_REPOSITORIES) {
      box.checked = false;
      this.problem.set(problemMessage('too_many_repositories'));
      return;
    }
    this.busy.set(true);
    this.problem.set('');
    const asked = holds
      ? this.watchlists.drop(list.id, repository)
      : this.watchlists.add(list.id, [repository]);
    asked.subscribe({
      next: (lists) => {
        this.busy.set(false);
        this.lists.set(lists);
        this.toasts.show(
          holds ? removedFrom(repository, list.name) : addedTo(repository, list.name),
          holds ? 'trash' : 'eye',
        );
      },
      error: (problem: WatchlistProblem) => {
        this.busy.set(false);
        box.checked = holds;
        this.problem.set(problemMessage(problem));
      },
    });
  }

  /** Makes a watchlist of the name typed, with the repository in it. */
  protected create(event: Event): void {
    event.preventDefault();
    const repository = this.repository();
    const lists = this.lists() ?? [];
    if (this.busy() || repository === undefined) {
      return;
    }
    const problem: WatchlistProblem | undefined =
      lists.length >= MAX_WATCHLISTS ? 'too_many_watchlists' : nameProblem(this.draft(), lists);
    if (problem) {
      this.problem.set(problemMessage(problem));
      return;
    }
    const name = this.draft().trim();
    this.busy.set(true);
    this.watchlists.create(name, [repository]).subscribe({
      next: ({ watchlists }) => {
        this.busy.set(false);
        this.lists.set(watchlists);
        this.draft.set('');
        this.toasts.show(addedTo(repository, name), 'eye');
      },
      error: (problem: WatchlistProblem) => {
        this.busy.set(false);
        this.problem.set(problemMessage(problem));
      },
    });
  }

  protected readonly repositoryCount = repositoryCount;
  protected readonly ADD_TO_WATCHLIST = ADD_TO_WATCHLIST;
  protected readonly CHOOSE_WATCHLISTS = CHOOSE_WATCHLISTS;
  protected readonly NO_WATCHLISTS_YET = NO_WATCHLISTS_YET;
  protected readonly NEW_WATCHLIST_NAME = NEW_WATCHLIST_NAME;
  protected readonly NAME_PLACEHOLDER = NAME_PLACEHOLDER;
  protected readonly CREATE = CREATE;
  protected readonly MANAGE_WATCHLISTS = MANAGE_WATCHLISTS;
  protected readonly DONE = DONE;
  protected readonly LOADING_WATCHLISTS = LOADING_WATCHLISTS;
  protected readonly WATCHLISTS_FAILED = WATCHLISTS_FAILED;
}
