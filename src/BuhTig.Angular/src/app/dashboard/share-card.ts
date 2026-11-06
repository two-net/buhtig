import { Component, DOCUMENT, computed, inject, input, output, signal } from '@angular/core';
import { Dialog } from '../dialog/dialog';
import { Icon } from '../icon/icon';
import { resourceName } from '../search/messages';
import { Known, dashboardPath } from '../search/parse';
import { Toasts } from '../toast/toasts';
import {
  CARD_ABOUT,
  CARD_MARKDOWN,
  CLOSE,
  COPY_FAILED,
  COPY_MARKDOWN,
  cardAlt,
  copiedCard,
  shareCardHeading,
} from './messages';

let count = 0;

/**
 * The Markdown that shows the card of the resource named `name`, linked to its dashboard, on the
 * BuhTig at `origin` (FR-NAV-07, FR-NAV-08).
 */
export function cardMarkdown(name: string, origin: string): string {
  return `[![${cardAlt(name)}](${origin}/-/preview/${name}.svg)](${origin}/${name})`;
}

/**
 * Offers the card of a dashboard's resource, to embed elsewhere, such as in a README (FR-NAV-08):
 * the card, and its Markdown, to copy. Where the browser will not copy, the Markdown is there to
 * select, and the dialog says so beside it, not in a toast alone (NFR-UX-06).
 */
@Component({
  selector: 'app-share-card',
  imports: [Dialog, Icon],
  template: `
    <app-dialog [heading]="heading()" (closed)="closed.emit()">
      <img class="card-image" [src]="image()" [alt]="alt()" width="600" height="315" />
      <p>{{ CARD_ABOUT }}</p>
      <label [for]="id">{{ CARD_MARKDOWN }}</label>
      <textarea
        #markdown
        [id]="id"
        class="input"
        rows="3"
        readonly
        spellcheck="false"
        [value]="snippet()"
        [attr.aria-describedby]="failed() ? id + '-failed' : null"
        (focus)="markdown.select()"
      ></textarea>
      @if (failed()) {
        <p [id]="id + '-failed'" class="field-msg err" role="alert">
          <app-icon name="alert" />{{ COPY_FAILED }}
        </p>
      }
      <button actions type="button" class="btn" (click)="closed.emit()">{{ CLOSE }}</button>
      <button actions type="button" class="btn primary" (click)="copy()">
        <app-icon name="copy" />{{ COPY_MARKDOWN }}
      </button>
    </app-dialog>
  `,
})
export class ShareCard {
  private readonly document = inject(DOCUMENT);
  private readonly toasts = inject(Toasts);

  /** The dashboard's resource, with the names as GitHub spells them. */
  readonly resource = input.required<Known>();
  /** Asked for when the user closes the dialog, or has copied the Markdown. */
  readonly closed = output();

  protected readonly id = `share-card-${count++}`;
  /** Whether the browser would not copy the Markdown. */
  protected readonly failed = signal(false);

  private readonly name = computed(() => resourceName(this.resource()));
  protected readonly heading = computed(() => shareCardHeading(this.name()));
  protected readonly alt = computed(() => cardAlt(this.name()));
  protected readonly image = computed(() => `/-/preview${dashboardPath(this.resource())}.svg`);
  /** BuhTig is served at `server.public_url`, which has no path, so its origin is the page's. */
  protected readonly snippet = computed(() =>
    cardMarkdown(this.name(), this.document.location.origin),
  );

  protected async copy(): Promise<void> {
    const clipboard = this.document.defaultView?.navigator.clipboard;
    try {
      if (!clipboard) {
        throw new Error('no clipboard');
      }
      await clipboard.writeText(this.snippet());
    } catch {
      this.failed.set(true);
      return;
    }
    this.toasts.show(copiedCard(this.name()));
    this.closed.emit();
  }

  protected readonly CARD_ABOUT = CARD_ABOUT;
  protected readonly CARD_MARKDOWN = CARD_MARKDOWN;
  protected readonly CLOSE = CLOSE;
  protected readonly COPY_FAILED = COPY_FAILED;
  protected readonly COPY_MARKDOWN = COPY_MARKDOWN;
}
