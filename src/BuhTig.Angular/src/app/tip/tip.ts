import {
  Component,
  ElementRef,
  Injectable,
  afterRenderEffect,
  inject,
  signal,
  viewChild,
} from '@angular/core';

/** What a chart's tooltip says of the mark it is at, and where that is. */
export interface TipContent {
  /** The figure in full, such as "1,234 commits". */
  value: string;
  /** What it is of, such as "Week of Oct 26, 2025". */
  label: string;
  /** The mark's color, to key the tooltip to it, if it has one of its own. */
  color?: string;
}

interface Shown extends TipContent {
  anchor: DOMRect;
  /** Where the pointer is, if it points at the mark. */
  point: { x: number; y: number } | undefined;
}

/**
 * The tooltip of charts' marks (FR-ANIM-06): one for the whole app, by the pointer as it points
 * at a mark, or above the mark that the keyboard is on. It fades in, and goes as the page
 * scrolls. Assistive technology reads the charts' summaries and tables instead (NFR-UX-04).
 */
@Injectable({ providedIn: 'root' })
export class Tip {
  private readonly current = signal<Shown | undefined>(undefined);
  readonly shown = this.current.asReadonly();

  show(target: Element, content: TipContent, event?: PointerEvent): void {
    this.current.set({
      ...content,
      anchor: target.getBoundingClientRect(),
      point: event && { x: event.clientX, y: event.clientY },
    });
  }

  hide(): void {
    this.current.set(undefined);
  }
}

/** Where the tooltip shows, once for the whole app. */
@Component({
  selector: 'app-tip',
  template: `
    <div #tip class="tip" [class.on]="shown()" aria-hidden="true">
      @if (shown(); as shown) {
        <strong>{{ shown.value }}</strong>
        <span>
          @if (shown.color) {
            <i class="k" [style.background]="shown.color"></i>
          }
          {{ shown.label }}
        </span>
      }
    </div>
  `,
  host: { '(window:scroll)': 'tip.hide()' },
})
export class TipHost {
  protected readonly tip = inject(Tip);
  protected readonly shown = this.tip.shown;
  private readonly element = viewChild.required<ElementRef<HTMLElement>>('tip');

  constructor() {
    // Above the mark, or below it if there is no room, and within the window.
    afterRenderEffect(() => {
      const shown = this.shown();
      const tip = this.element().nativeElement;
      if (shown === undefined) {
        return;
      }
      const { anchor, point } = shown;
      const x = point?.x ?? anchor.left + anchor.width / 2;
      const y = point?.y ?? anchor.top;
      const left = Math.min(Math.max(8, x - tip.offsetWidth / 2), innerWidth - tip.offsetWidth - 8);
      let top = y - tip.offsetHeight - 12;
      if (top < 8) {
        top = (point?.y ?? anchor.bottom) + 14;
      }
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    });
  }
}
