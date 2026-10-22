import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Accounts } from './accounts';
import { problemMessage, resourceMessage, userMessage } from './messages';
import { dashboardPath, isUnfinished, parse } from './parse';

/**
 * The search box: one input that takes a GitHub repository or organization URL, says what it
 * recognizes as the user types (FR-SRCH-09), and opens its dashboard on Enter or "Show
 * dashboard" (SRS §4.1). `/` focuses it and Esc clears it (FR-SRCH-07). Its content goes
 * beside "Show dashboard", as the home page's "Surprise me" does (FR-SRCH-10).
 */
@Component({
  selector: 'app-search',
  templateUrl: './search.html',
  styleUrl: './search.css',
  host: { '(document:keydown)': 'focusOnSlash($event)' },
})
export class Search {
  private readonly router = inject(Router);
  private readonly accounts = inject(Accounts);
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  /** Whether to focus the input once it is shown, on desktop only (FR-SRCH-07). */
  readonly focusOnDesktop = input(false);

  protected readonly query = signal('');
  /**
   * What the input names, or why it is wrong, shown below it as the user types (FR-SRCH-09).
   * Nothing while it is empty or the beginning of a URL, so that typing one shows no error. It
   * is worked out on each keystroke, well within 100 ms (NFR-PERF-06).
   */
  protected readonly hint = computed(() => {
    const parsed = parse(this.query());
    if (parsed.ok) {
      return resourceMessage(parsed.resource);
    }
    return isUnfinished(this.query()) ? '' : problemMessage(parsed.problem);
  });
  /** Why the input opens no dashboard, shown in place of the hint once it is searched for. */
  protected readonly message = signal<string | undefined>(undefined);
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
      this.message.set(problemMessage(parsed.problem));
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
        this.message.set(userMessage(resource.org));
        return;
      }
    }
    await this.router.navigateByUrl(dashboardPath(resource));
  }
}

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
