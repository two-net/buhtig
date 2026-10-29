import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Account } from '../account/account';
import { exactTime, list } from '../format/format';
import { RelativeTime } from '../format/relative-time';
import { Session, Token, signInUrl } from '../session/session';
import { DataDeletion } from './deletion';
import {
  CREATE_TOKEN,
  DATA_DELETED,
  GITHUB_ACCESS,
  MANAGE_TOKENS,
  NEVER_EXPIRES,
  NEW_TOKEN,
  NO_SCOPES,
  PERMISSIONS_UNKNOWN,
  REMOVED,
  REMOVE_FAILED,
  REVIEW_GITHUB_ACCESS,
  SAVED,
  SIGN_IN_FIRST,
  TOKEN,
  TOKEN_ADVICE,
  TOKEN_HANDLING,
  TOKEN_INVALID,
  TOKEN_PURPOSE,
  TYPE_LABELS,
  saveProblemMessage,
} from './messages';
import { ShortcutSettings } from './shortcuts';
import { SaveProblem, Tokens } from './tokens';

/**
 * The signed-in user's settings, at `/-/settings`: their personal access token, which they may
 * save, replace or remove at any time (FR-PAT-01, FR-PAT-05). Settings shows what the token is
 * for, and what BuhTig recommends (FR-PAT-09), and once one is saved, what BuhTig may show of
 * it, never the token itself (FR-PAT-04). Below it, their pins and history (§4.8), which they
 * may reorder, unpin and clear, and last, a way to delete all their data (FR-PERS-04), which
 * signs them out. Visitors are asked to sign in (FR-ACC-02).
 *
 * Buttons that go as they are pressed hand focus on to what takes their place, and those that
 * wait for the server keep it (NFR-UX-03).
 */
@Component({
  selector: 'app-settings',
  imports: [Account, DataDeletion, RelativeTime, RouterLink, ShortcutSettings],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  private readonly session = inject(Session);
  private readonly tokens = inject(Tokens);
  private readonly injector = inject(Injector);

  protected readonly user = this.session.user;
  protected readonly token = this.session.token;
  protected readonly deleted = this.session.deleted;
  protected readonly signIn = signInUrl('/-/settings');

  /** The note that the user's data is deleted, once it shows. */
  private readonly deletedNote = viewChild<ElementRef<HTMLElement>>('deletedNote');
  /** The token input, and the buttons that replace and remove the token, while they show. */
  private readonly input = viewChild<ElementRef<HTMLElement>>('input');
  private readonly replaceButton = viewChild<ElementRef<HTMLElement>>('replaceButton');
  private readonly removeButton = viewChild<ElementRef<HTMLElement>>('removeButton');

  /** What the token input holds. */
  protected readonly draft = signal('');
  /** Whether the user asked to replace the token they have. */
  protected readonly replacing = signal(false);
  /** Whether the server is saving or removing the token. */
  protected readonly busy = signal(false);
  /** What the last change came to, for assistive technology too. */
  protected readonly done = signal('');
  /** Why the last change did not happen, if it did not. */
  protected readonly problem = signal('');

  /** Whether to show the form that saves a token: there is none yet, or one to replace. */
  protected readonly entering = computed(() => this.token() === null || this.replacing());

  protected readonly SIGN_IN_FIRST = SIGN_IN_FIRST;
  protected readonly TOKEN_PURPOSE = TOKEN_PURPOSE;
  protected readonly TOKEN_HANDLING = TOKEN_HANDLING;
  protected readonly TOKEN_ADVICE = TOKEN_ADVICE;
  protected readonly CREATE_TOKEN = CREATE_TOKEN;
  protected readonly MANAGE_TOKENS = MANAGE_TOKENS;
  protected readonly TOKEN_INVALID = TOKEN_INVALID;
  protected readonly PERMISSIONS_UNKNOWN = PERMISSIONS_UNKNOWN;
  protected readonly NO_SCOPES = NO_SCOPES;
  protected readonly NEVER_EXPIRES = NEVER_EXPIRES;
  protected readonly TYPE_LABELS = TYPE_LABELS;
  protected readonly TOKEN = TOKEN;
  protected readonly NEW_TOKEN = NEW_TOKEN;
  protected readonly list = list;
  protected readonly DATA_DELETED = DATA_DELETED;
  protected readonly GITHUB_ACCESS = GITHUB_ACCESS;
  protected readonly REVIEW_GITHUB_ACCESS = REVIEW_GITHUB_ACCESS;

  constructor() {
    // The button that deleted the data went with the rest of Settings, so focus goes to what
    // came of it.
    afterRenderEffect(() => this.deletedNote()?.nativeElement.focus());
  }

  /** A token's expiry in full, such as "Nov 25, 2026, 12:00 PM". */
  protected expiry(token: Token): string {
    return token.expiresAt ? exactTime(token.expiresAt) : NEVER_EXPIRES;
  }

  protected replace(): void {
    if (this.busy()) {
      return;
    }
    this.replacing.set(true);
    this.focusOnceShown(this.input);
  }

  protected save(event: SubmitEvent): void {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    this.start();
    this.tokens.save(this.draft()).subscribe({
      next: (token) => {
        this.session.setToken(token);
        this.draft.set('');
        this.replacing.set(false);
        this.finish(SAVED);
        this.focusOnceShown(this.replaceButton);
      },
      error: (problem: SaveProblem) => {
        this.busy.set(false);
        this.problem.set(saveProblemMessage(problem));
        this.focusOnceShown(this.input);
      },
    });
  }

  protected remove(): void {
    if (this.busy()) {
      return;
    }
    this.start();
    this.tokens.remove().subscribe({
      next: () => {
        this.session.setToken(null);
        this.replacing.set(false);
        this.finish(REMOVED);
        this.focusOnceShown(this.input);
      },
      error: () => {
        this.busy.set(false);
        this.problem.set(REMOVE_FAILED);
        this.focusOnceShown(this.removeButton);
      },
    });
  }

  protected cancel(): void {
    this.replacing.set(false);
    this.draft.set('');
    this.problem.set('');
    this.focusOnceShown(this.replaceButton);
  }

  /** Focuses what `element` finds once Settings has shown what has just changed. */
  private focusOnceShown(element: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => element()?.nativeElement.focus(), { injector: this.injector });
  }

  private start(): void {
    this.busy.set(true);
    this.done.set('');
    this.problem.set('');
  }

  private finish(done: string): void {
    this.busy.set(false);
    this.done.set(done);
  }
}
