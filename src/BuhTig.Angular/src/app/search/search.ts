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
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { Icon, IconName } from '../icon/icon';
import { Motion } from '../motion/motion';
import {
  KINDS,
  LABEL,
  PLACEHOLDERS,
  SHOW_DASHBOARD,
  problemMessage,
  resourceName,
} from './messages';
import { dashboardPath, isUnfinished, parse } from './parse';
import { Shortcut } from './shortcut';

/** Where a search box is: the visitor's home page, the signed-in home page, or a header. */
export type SearchVariant = 'hero' | 'dash' | 'header';

let count = 0;

/**
 * The search box: one input that takes a GitHub repository or organization URL, says what it
 * recognizes as the user types (FR-SRCH-09), and opens its dashboard on Enter or "Show
 * dashboard" (SRS §4.1). A name alone opens that account's dashboard, which says so if the
 * account is a user's (FR-SRCH-06). `/` focuses it, unless the user has turned that off (WCAG
 * 2.1.4), and Esc or ✕ clears it (FR-SRCH-07).
 *
 * It lifts as it is hovered or focused (FR-ANIM-02), and shakes as it says why it opens no
 * dashboard (FR-ANIM-09).
 *
 * In a header it is compact, without "Show dashboard", filled in with the dashboard's resource
 * (UI-03), and what it says goes over the page below it.
 */
@Component({
  selector: 'app-search',
  imports: [Icon, NgTemplateOutlet],
  templateUrl: './search.html',
  host: { '(document:keydown)': 'focusOnSlash($event)' },
})
export class Search {
  private readonly router = inject(Router);
  private readonly motion = inject(Motion);
  private readonly shortcut = inject(Shortcut);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  readonly variant = input<SearchVariant>('hero');
  /** Whether to focus the input once it is shown, on desktop only (FR-SRCH-07). */
  readonly focusOnDesktop = input(false);
  /** What the input holds until the user edits it, and again whenever this changes. */
  readonly prefill = input('');
  /** Whether `/` focuses it, as it does the one search box of most pages. */
  readonly slash = input(true);

  protected readonly id = `search-${count++}`;
  protected readonly label = LABEL;
  protected readonly button = SHOW_DASHBOARD;
  protected readonly header = computed(() => this.variant() === 'header');
  protected readonly placeholder = computed(() =>
    this.header()
      ? PLACEHOLDERS.header
      : typeof innerWidth === 'number' && innerWidth < 520
        ? PLACEHOLDERS.narrow
        : PLACEHOLDERS.hero,
  );

  protected readonly query = linkedSignal(() => this.prefill());
  /**
   * What the input names, or why it names nothing, shown below it as the user types
   * (FR-SRCH-09). Nothing while it is empty or the beginning of a URL, so that typing one shows
   * no problem, nor while it holds what it was filled in with, which the page shows already. It
   * is worked out on each keystroke, well within 100 ms (NFR-PERF-06).
   */
  protected readonly hint = computed((): Hint | undefined => {
    const query = this.query();
    if (query === this.prefill()) {
      return undefined;
    }
    const parsed = parse(query);
    if (parsed.ok) {
      const resource = parsed.resource;
      return {
        icon: resource.kind === 'repository' ? 'repo' : 'org',
        kind: KINDS[resource.kind],
        name: resourceName(resource),
      };
    }
    return isUnfinished(query) || parsed.problem.kind === 'empty'
      ? undefined
      : { problem: problemMessage(parsed.problem) };
  });
  /**
   * Why the input opens no dashboard, shown in place of the hint once it is searched for, until
   * the input is edited or filled in anew.
   */
  protected readonly message = linkedSignal<string | undefined>(() => {
    this.prefill();
    return undefined;
  });

  constructor() {
    afterNextRender(() => {
      if (this.focusOnDesktop() && isDesktop()) {
        this.input().nativeElement.focus({ preventScroll: true });
      }
    });
  }

  /**
   * `/` pressed anywhere but in a text field focuses the input, and is not typed into it, while
   * the shortcut is on.
   */
  protected focusOnSlash(event: KeyboardEvent): void {
    if (
      event.key === '/' &&
      this.slash() &&
      this.shortcut.enabled() &&
      !(event.ctrlKey || event.metaKey || event.altKey) &&
      !event.defaultPrevented &&
      !isField(event.target)
    ) {
      event.preventDefault();
      this.input().nativeElement.focus();
    }
  }

  protected edit(value: string): void {
    this.query.set(value);
    this.message.set(undefined);
  }

  protected clear(): void {
    this.edit('');
    this.input().nativeElement.focus();
  }

  protected async search(event: Event): Promise<void> {
    event.preventDefault();
    const parsed = parse(this.query());
    if (!parsed.ok) {
      this.message.set(problemMessage(parsed.problem));
      this.animate(SHAKE, { duration: 280, easing: 'ease-in-out' });
      this.input().nativeElement.focus();
      return;
    }
    this.message.set(undefined);
    await this.router.navigateByUrl(dashboardPath(parsed.resource));
  }

  /** Where the box is on the page, for it to glide from on the next page (FR-ANIM-03). */
  bounds(): DOMRect {
    return this.box().nativeElement.getBoundingClientRect();
  }

  /**
   * Moves the box from `from`, where it was on the page before, to where it is, as the home
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
      { duration: 400, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }

  /**
   * Plays `keyframes` on the box while motion is on (FR-ANIM-10). Not every environment can;
   * the tests' jsdom cannot.
   */
  private animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): void {
    const box = this.box().nativeElement;
    if (this.motion.full() && typeof box.animate === 'function') {
      box.animate(keyframes, options);
    }
  }
}

/** What the search box says as the user types: what the input names, or why it names nothing. */
type Hint = { icon: IconName; kind: string; name: string } | { problem: string };

/** A brief shake from side to side (FR-ANIM-09). */
const SHAKE: Keyframe[] = [
  { transform: 'none' },
  { transform: 'translateX(-7px)' },
  { transform: 'translateX(6px)' },
  { transform: 'translateX(-4px)' },
  { transform: 'translateX(3px)' },
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
