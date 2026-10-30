import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Avatar } from '../avatar/avatar';
import { Center } from '../center/center';
import { Clock } from '../format/clock';
import { exactDay, list, timeUntil } from '../format/format';
import { RelativeTime } from '../format/relative-time';
import { Header } from '../header/header';
import { Icon } from '../icon/icon';
import { Motion } from '../motion/motion';
import { Session, Token, signInUrl } from '../session/session';
import { PageStyles } from '../styles/styles';
import { Toasts } from '../toast/toasts';
import { DataDeletion } from './deletion';
import {
  CREATE_TOKEN,
  MANAGE_TOKENS,
  NEVER_EXPIRES,
  NO_SCOPES,
  PERMISSIONS_UNKNOWN,
  REMOVED,
  REMOVE_FAILED,
  SAVED,
  SECTIONS,
  SIGN_IN_FIRST,
  SIGN_IN_TO_MANAGE,
  TOKEN_ACTIVE,
  TOKEN_ADVICE,
  TOKEN_HANDLING,
  TOKEN_INVALID,
  TOKEN_PURPOSE,
  TYPE_LABELS,
  expiresSoon,
  saveProblemMessage,
  scopes,
  signedIn,
} from './messages';
import { ShortcutSettings } from './shortcuts';
import { SaveProblem, Tokens } from './tokens';

/** FR-PAT-10: how long before a token expires the user is reminded to replace it. */
const EXPIRY_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The signed-in user's settings, at `/-/settings`: who they are, and a way to sign out. Then
 * their personal access token, which they may save, replace or remove at any time (FR-PAT-01,
 * FR-PAT-05). Settings shows what the token is for, and what BuhTig recommends (FR-PAT-09), and
 * once one is saved, what BuhTig may show of it, never the token itself (FR-PAT-04). Below it,
 * their pins and history (§4.8), which they may reorder, unpin and clear, and last, a way to
 * delete all their data (FR-PERS-04), which signs them out. Visitors are asked to sign in
 * (FR-ACC-02). The side navigation leads to each, and marks the one in view.
 *
 * Buttons that go as they are pressed hand focus on to what takes their place, and those that
 * wait for the server keep it (NFR-UX-03).
 */
@Component({
  selector: 'app-settings',
  imports: [Avatar, Center, DataDeletion, Header, Icon, PageStyles, RelativeTime, ShortcutSettings],
  templateUrl: './settings.html',
})
export class Settings {
  private readonly session = inject(Session);
  private readonly tokens = inject(Tokens);
  private readonly toasts = inject(Toasts);
  private readonly clock = inject(Clock);
  private readonly motion = inject(Motion);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly user = this.session.user;
  protected readonly token = this.session.token;
  protected readonly signIn = signInUrl('/-/settings');
  protected readonly signedInAt = computed(() => {
    const time = new Date(this.user()?.signed_in_at ?? NaN);
    return isNaN(time.getTime()) ? undefined : time;
  });

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
  /** Why the last change did not happen, if it did not. */
  protected readonly problem = signal('');

  /** Whether to show the form that saves a token: there is none yet, or one to replace. */
  protected readonly entering = computed(() => this.token() === null || this.replacing());

  /** The section in view, which the side navigation marks. */
  protected readonly current = signal<string>(SECTIONS[0].id);

  /** What the token may read, as GitHub says it. */
  protected readonly access = computed(() => {
    const token = this.token();
    if (!token) {
      return '';
    }
    if (token.type === 'fine_grained') {
      return PERMISSIONS_UNKNOWN;
    }
    return token.scopes?.length ? scopes(list(token.scopes)) : NO_SCOPES;
  });

  /** When the token expires, if within 7 days and it still works. */
  protected readonly expiring = computed(() => {
    const token = this.token();
    const expiresAt = token?.expiresAt;
    const now = this.clock.now();
    return token?.status === 'valid' && expiresAt && expiresAt.getTime() - now <= EXPIRY_NOTICE_MS
      ? expiresSoon(timeUntil(expiresAt, now))
      : undefined;
  });

  constructor() {
    // The section in view is the last whose top has passed the header.
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof IntersectionObserver !== 'function') {
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          const shown = entries.filter((entry) => entry.isIntersecting);
          if (shown.length > 0) {
            this.current.set(shown[0].target.id);
          }
        },
        { rootMargin: '-88px 0px -60% 0px' },
      );
      for (const section of this.host.querySelectorAll('.section')) {
        observer.observe(section);
      }
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /** Scrolls to the section `id`, and moves focus to its heading (NFR-UX-03). */
  protected goTo(event: Event, id: string): void {
    event.preventDefault();
    this.current.set(id);
    const section = this.host.querySelector<HTMLElement>(`#${id}`);
    section?.scrollIntoView({ behavior: this.motion.full() ? 'smooth' : 'auto', block: 'start' });
    section?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  /** A token's expiry, such as "Nov 25, 2026". */
  protected expiry(token: Token): string {
    return token.expiresAt ? exactDay(token.expiresAt) : NEVER_EXPIRES;
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
        this.busy.set(false);
        this.toasts.show(SAVED, 'key');
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
        this.busy.set(false);
        this.toasts.show(REMOVED, 'trash');
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
    this.problem.set('');
  }

  protected readonly SECTIONS = SECTIONS;
  protected readonly SIGN_IN_TO_MANAGE = SIGN_IN_TO_MANAGE;
  protected readonly SIGN_IN_FIRST = SIGN_IN_FIRST;
  protected readonly TOKEN_PURPOSE = TOKEN_PURPOSE;
  protected readonly TOKEN_HANDLING = TOKEN_HANDLING;
  protected readonly TOKEN_ADVICE = TOKEN_ADVICE;
  protected readonly CREATE_TOKEN = CREATE_TOKEN;
  protected readonly MANAGE_TOKENS = MANAGE_TOKENS;
  protected readonly TOKEN_INVALID = TOKEN_INVALID;
  protected readonly TOKEN_ACTIVE = TOKEN_ACTIVE;
  protected readonly TYPE_LABELS = TYPE_LABELS;
  protected readonly signedIn = signedIn;
}
