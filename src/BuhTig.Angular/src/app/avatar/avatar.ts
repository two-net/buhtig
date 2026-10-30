import { Component, computed, input, linkedSignal } from '@angular/core';

/**
 * Where GitHub serves the avatar of the user `login`, by their name alone. GitHub serves a
 * placeholder in place of an organization's.
 */
export function avatarOf(login: string, size: number): string {
  return `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=${size * 2}`;
}

/**
 * An account's avatar, `size` pixels square, round for people and square for organizations and
 * repositories, as GitHub draws them. It loads from GitHub (FR-DATA-01). Until it has, or when
 * it cannot, as when GitHub has no such account or the browser is offline, it is a pattern drawn
 * from the name, which looks the same each time. It is decoration: the name is always said
 * beside it.
 */
@Component({
  selector: 'app-avatar',
  template: `
    @if (src() && !failed()) {
      <img
        class="av"
        [class.round]="round()"
        [src]="src()"
        alt=""
        [width]="size()"
        [height]="size()"
        loading="lazy"
        (error)="failed.set(true)"
      />
    } @else {
      <svg
        class="av"
        [class.round]="round()"
        viewBox="-0.6 -0.6 6.2 6.2"
        [attr.width]="size()"
        [attr.height]="size()"
        focusable="false"
        shape-rendering="crispEdges"
        [style.--hue]="pattern().hue"
      >
        <rect class="bg" x="-0.6" y="-0.6" width="6.2" height="6.2" />
        @for (cell of pattern().cells; track $index) {
          <rect class="fg" [attr.x]="cell.x" [attr.y]="cell.y" width="1" height="1" />
        }
      </svg>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    .bg {
      fill: hsl(var(--hue) 38% var(--id-bg-l));
    }
    .fg {
      fill: hsl(var(--hue) 55% var(--id-fg-l));
    }
  `,
  host: { 'aria-hidden': 'true' },
})
export class Avatar {
  /** The account, or `owner/repo`, whose avatar it is, to draw its pattern from. */
  readonly name = input.required<string>();
  /** The avatar's `https` URL, if known. */
  readonly src = input<string | undefined>(undefined);
  readonly size = input(20);
  readonly round = input(false);

  /** Whether the image failed to load, for each URL anew. */
  protected readonly failed = linkedSignal({ source: this.src, computation: () => false });

  protected readonly pattern = computed(() => identicon(this.name()));
}

/**
 * A pattern of 5 by 5 cells, mirrored left to right, and a hue, drawn from `name` whatever its
 * letter case, so that the same name always looks the same.
 */
export function identicon(name: string): { hue: number; cells: { x: number; y: number }[] } {
  const key = name.toLowerCase();
  const next = random(`identicon:${key}`);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (next() < 0.5) {
        continue;
      }
      cells.push({ x, y });
      if (x < 2) {
        cells.push({ x: 4 - x, y });
      }
    }
  }
  return { hue: hash(key) % 360, cells };
}

/** FNV-1a of `text`. */
function hash(text: string): number {
  let value = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Numbers from 0 to 1 that look random, the same ones for the same `seed` (Mulberry32). */
function random(seed: string): () => number {
  let state = hash(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
