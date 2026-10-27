import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Motion } from '../motion/motion';
import { Accounts } from './accounts';
import { problemMessage, resourceMessage, userMessage } from './messages';
import { dashboardPath, isUnfinished, parse } from './parse';

/**
 * The search box: one input that takes a GitHub repository or organization URL, says what it
 * recognizes as the user types (FR-SRCH-09), and opens its dashboard on Enter or "Show
 * dashboard" (SRS §4.1). `/` focuses it and Esc clears it (FR-SRCH-07). Its content goes
 * beside "Show dashboard", as the home page's "Surprise me" does (FR-SRCH-10).
 *
 * It lifts as it is hovered or focused (FR-ANIM-02), and shakes as it says why it opens no
 * dashboard (FR-ANIM-09).
 *
 * In a dashboard's header it is compact, and filled in with the dashboard's resource (UI-03).
 */
@Component({
  selector: 'app-search',
  templateUrl: './search.html',
  styleUrl: './search.css',
  host: { '[class.compact]': 'compact()', '(document:keydown)': 'focusOnSlash($event)' },
})
export class Search {
  private readonly router = inject(Router);
  private readonly accounts = inject(Accounts);
  private readonly motion = inject(Motion);
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  /** Whether to focus the input once it is shown, on desktop only (FR-SRCH-07). */
  readonly focusOnDesktop = input(false);
  /** What the input holds until the user edits it, and again whenever this changes. */
  readonly prefill = input('');
  /**
   * Whether it fits in a header (UI-03): without "Show dashboard", since Enter is enough, and
   * with what it says below it laid over the page, so that the header keeps its height.
   */
  readonly compact = input(false);

  protected readonly query = linkedSignal(() => this.prefill());
  /**
   * What the input names, or why it is wrong, shown below it as the user types (FR-SRCH-09).
   * Nothing while it is empty or the beginning of a URL, so that typing one shows no error,
   * nor while it holds what it was filled in with, which the page shows already. It is worked
   * out on each keystroke, well within 100 ms (NFR-PERF-06).
   */
  protected readonly hint = computed(() => {
    if (this.query() === this.prefill()) {
      return '';
    }
    const parsed = parse(this.query());
    if (parsed.ok) {
      return resourceMessage(parsed.resource);
    }
    return isUnfinished(this.query()) ? '' : problemMessage(parsed.problem);
  });
  /**
   * Why the input opens no dashboard, shown in place of the hint once it is searched for, until
   * the input is edited or filled in anew.
   */
  protected readonly message = linkedSignal<string | undefined>(() => {
    this.prefill();
    return undefined;
  });
  /** Counts edits and searches, so that an account lookup that ends after either is ignored. */
  private attempt = 0;

  constructor() {
    afterNextRender(() => {
      if (this.focusOnDesktop() && isDesktop()) {
        this.box().nativeElement.focus();
      }
    });
  }

  /** `/` pressed anywhere but in a text field focuses the input, and is not typed into it. */
  protected focusOnSlash(event: KeyboardEvent): void {
    if (
      event.key === '/' &&
      !(event.ctrlKey || event.metaKey || event.altKey) &&
      !event.defaultPrevented &&
      !isField(event.target)
    ) {
      event.preventDefault();
      this.box().nativeElement.focus();
    }
  }

  protected edit(value: string): void {
    this.attempt++;
    this.query.set(value);
    this.message.set(undefined);
  }

  protected async search(event: Event): Promise<void> {
    event.preventDefault();
    const attempt = ++this.attempt;
    const parsed = parse(this.query());
    if (!parsed.ok) {
      this.refuse(problemMessage(parsed.problem));
      return;
    }
    const { resource } = parsed;
    // A name alone may be a user's, and BuhTig has no dashboards for users (FR-SRCH-06).
    if (resource.kind === 'organization') {
      const isUser = await this.accounts.isUser(resource.org);
      if (attempt !== this.attempt) {
        return;
      }
      if (isUser) {
        this.refuse(userMessage(resource.org));
        return;
      }
    }
    await this.router.navigateByUrl(dashboardPath(resource));
  }

  /** Says why the input opens no dashboard, with a shake each time (FR-ANIM-09). */
  private refuse(message: string): void {
    this.message.set(message);
    this.animate(SHAKE, { duration: 280, easing: 'ease-in-out' });
  }

  /** Where the input is on the page, for it to glide from on the next page (FR-ANIM-03). */
  bounds(): DOMRect {
    return this.box().nativeElement.getBoundingClientRect();
  }

  /**
   * Moves the input from `from`, where it was on the page before, to where it is, as the home
   * page gives way to a dashboard (FR-ANIM-03). Only its transform changes, so that it can be
   * clicked and typed into on its way (FR-ANIM-11).
   */
  glideFrom(from: DOMRect): void {
    const to = this.bounds();
    if (to.width === 0 || to.height === 0) {
      return;
    }
    const x = from.left - to.left;
    const y = from.top - to.top;
    this.animate(
      [
        {
          transformOrigin: 'top left',
          transform: `translate(${x}px, ${y}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        },
        { transformOrigin: 'top left', transform: 'none' },
      ],
      { duration: 400, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
  }

  /**
   * Plays `keyframes` on the input while motion is on (FR-ANIM-10). Not every environment can;
   * the tests' jsdom cannot.
   */
  private animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): void {
    const box = this.box().nativeElement;
    if (this.motion.full() && typeof box.animate === 'function') {
      box.animate(keyframes, options);
    }
  }
}

/**
 * A brief shake from side to side, which moves the input's `transform`, so that it adds to the
 * lift's `translate` (FR-ANIM-09).
 */
const SHAKE: Keyframe[] = [
  { transform: 'none' },
  { transform: 'translateX(-6px)' },
  { transform: 'translateX(5px)' },
  { transform: 'translateX(-3px)' },
  { transform: 'translateX(2px)' },
  { transform: 'none' },
];

/**
 * Whether the page is on a desktop, with a mouse or touchpad. On a touch screen, focusing the
 * input would open the keyboard over the page. Not every environment has `matchMedia`; the
 * tests' jsdom has none.
 */
function isDesktop(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

/** Whether `target` takes text, so that `/` typed there is meant for it. */
function isField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  );
}
