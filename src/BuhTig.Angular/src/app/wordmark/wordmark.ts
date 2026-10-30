import { Component, input } from '@angular/core';

/**
 * BuhTig's wordmark, its own (CON-10): "GitHub" turned around, set large in BuhTig's display face
 * above a faint reflection of itself. Assistive technology reads it as "BuhTig".
 *
 * When it is to `play`, as on the first home page of a browser session (FR-ANIM-01), its letters
 * flip into place one after another, and the reflection fades in after them, within 800 ms.
 */
@Component({
  selector: 'app-wordmark',
  template: `
    <span class="letters" aria-hidden="true">
      @for (letter of letters; track $index) {
        <span class="ch" [style.--i]="$index">{{ letter }}</span>
      }
    </span>
    <span class="mirror-wrap" aria-hidden="true"><span class="mirror">BuhTig</span></span>
  `,
  styleUrl: './wordmark.css',
  host: { role: 'img', 'aria-label': 'BuhTig', '[class.play]': 'play()' },
})
export class Wordmark {
  /** Whether its letters make their entrance. */
  readonly play = input(false);

  protected readonly letters = [...'BuhTig'];
}
