import { Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Avatar } from '../avatar/avatar';
import { compactNumber, exactNumber } from '../format/format';
import { Tip } from '../tip/tip';

/** One of a chart's bars: what it is of, its figure, and where it leads, if anywhere. */
export interface Bar {
  label: string;
  value: number;
  /** A page of BuhTig's, such as a repository's dashboard. */
  link?: string;
  /** A page elsewhere, such as a contributor's on GitHub (FR-REPO-12). */
  href?: string;
  /** The avatar of the account it is of, by its login and URL. */
  avatar?: { name: string; src: string | undefined };
  /** Its color, unless it is the chart's first. */
  color?: string;
}

/** A bar as the chart draws it. */
interface ShownBar extends Bar {
  color: string;
  /** How long it is against the longest, from 0 to 1. */
  width: string;
  figure: string;
}

/**
 * A chart of bars one above another, such as languages by repositories, each as long against the
 * longest as its figure is, with the figure at its end. The whole row is what the pointer points
 * at, and its tooltip tells the figure in full. Its bars grow as the widget around it makes its
 * entrance (FR-ANIM-06), one after another (FR-ANIM-08).
 */
@Component({
  selector: 'app-bar-chart',
  imports: [Avatar, NgTemplateOutlet, RouterLink],
  template: `
    <ul class="hbars" [attr.aria-label]="summary()">
      @for (bar of shown(); track $index) {
        <li>
          <ng-template #content>
            <span class="lab">
              @if (bar.avatar; as avatar) {
                <app-avatar [name]="avatar.name" [src]="avatar.src" [round]="true" />
              }
              <span>{{ bar.label }}</span>
            </span>
            <span class="track">
              <i [style.--w]="bar.width" [style.--i]="$index" [style.background]="bar.color"></i>
              <b>{{ bar.figure }}</b>
            </span>
          </ng-template>
          @if (bar.link) {
            <a
              class="hbar"
              [routerLink]="bar.link"
              (pointermove)="show(bar, $event)"
              (pointerleave)="tip.hide()"
              (focus)="show(bar)"
              (blur)="tip.hide()"
              ><ng-container [ngTemplateOutlet]="content"
            /></a>
          } @else if (bar.href) {
            <a
              class="hbar"
              [href]="bar.href"
              (pointermove)="show(bar, $event)"
              (pointerleave)="tip.hide()"
              (focus)="show(bar)"
              (blur)="tip.hide()"
              ><ng-container [ngTemplateOutlet]="content"
            /></a>
          } @else {
            <div class="hbar" (pointermove)="show(bar, $event)" (pointerleave)="tip.hide()">
              <ng-container [ngTemplateOutlet]="content" />
            </div>
          }
        </li>
      }
    </ul>
  `,
  styles: ':host { display: block; } li { display: contents; }',
})
export class BarChart {
  protected readonly tip = inject(Tip);

  readonly bars = input.required<Bar[]>();
  /** What the figures count, such as "repositories", as the tooltip says them. */
  readonly unit = input('');
  /** What the chart shows, as assistive technology names it. */
  readonly summary = input.required<string>();

  protected readonly shown = computed((): ShownBar[] => {
    const bars = this.bars();
    const longest = Math.max(1, ...bars.map((bar) => bar.value));
    return bars.map((bar) => ({
      ...bar,
      color: bar.color ?? 'var(--s1)',
      width: (bar.value / longest).toFixed(4),
      figure: compactNumber(bar.value),
    }));
  });

  protected show(bar: ShownBar, event?: PointerEvent): void {
    const target = (event?.currentTarget as Element | null) ?? document.activeElement;
    if (!(target instanceof Element)) {
      return;
    }
    const unit = this.unit();
    this.tip.show(
      target.querySelector('.track i') ?? target,
      {
        value: unit ? `${exactNumber(bar.value)} ${unit}` : exactNumber(bar.value),
        label: bar.label,
        color: bar.color,
      },
      event,
    );
  }
}
