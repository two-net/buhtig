import { Component, computed, input } from '@angular/core';

/** A circle of radius `r` around `x`, `y`, as a path. */
const C = (x: number, y: number, r: number) =>
  `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/** BuhTig's icons: simple strokes on a grid of 24, drawn for it. */
const ICONS = {
  search: [C(11, 11, 7), 'M16.2 16.2L21 21'],
  x: ['M6 6l12 12M18 6L6 18'],
  star: ['M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 16.9l-5.2 2.75 1-5.8-4.2-4.1 5.8-.85z'],
  fork: [
    C(6, 5, 2),
    C(18, 5, 2),
    C(12, 19, 2),
    'M6 7v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 11.5V17',
  ],
  eye: ['M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z', C(12, 12, 2.6)],
  issue: [C(12, 12, 8.5), C(12, 12, 1.5)],
  'issue-closed': [C(12, 12, 8.5), 'M8.4 12.3l2.5 2.5 4.7-4.9'],
  pr: [
    C(6, 5.5, 2),
    C(6, 18.5, 2),
    C(18, 18.5, 2),
    'M6 7.5v9M18 16.5V10a3 3 0 0 0-3-3h-4.5M12.5 4.5L10.2 7l2.3 2.5',
  ],
  merged: [C(6, 5.5, 2), C(6, 18.5, 2), C(18, 12, 2), 'M6 7.5v9M6 8.5c0 2 2 3.5 5 3.5h5'],
  closed: [C(12, 12, 8.5), 'M9.3 9.3l5.4 5.4M14.7 9.3l-5.4 5.4'],
  tag: ['M3.5 12.4V4.5a1 1 0 0 1 1-1h7.9l8.1 8.1-8.9 8.9z', C(8, 8, 1.3)],
  branch: [
    C(6, 5, 2),
    C(6, 19, 2),
    C(18, 7, 2),
    'M6 7v10M18 9v1a4 4 0 0 1-4 4H8.5A2.5 2.5 0 0 0 6 16.5',
  ],
  law: ['M12 4v15.5M7 20h10M4.5 8h15M7 8l-3 6.5a3 3 0 0 0 6 0zM17 8l-3 6.5a3 3 0 0 0 6 0z'],
  link: [
    'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  ],
  calendar: ['M4 6.5h16v13.5H4zM4 10.5h16M8.5 4v4M15.5 4v4'],
  clock: [C(12, 12, 8.5), 'M12 7.5V12l3 2'],
  lock: ['M6 10.5h12V20H6zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5'],
  archive: ['M3.5 5h17v4h-17zM5 9v10.5h14V9M10 13h4'],
  refresh: [
    'M19.5 10.5A7.7 7.7 0 0 0 5.6 7.4L4 9M4 4.5V9h4.5M4.5 13.5a7.7 7.7 0 0 0 13.9 3.1L20 15M20 19.5V15h-4.5',
  ],
  pin: ['M9.5 3.5h5l-.8 5.5 3.3 3.5H7l3.3-3.5zM12 12.5v8'],
  'pin-fill': ['M9.5 3.5h5l-.8 5.5 3.3 3.5H7l3.3-3.5z', 'M12 12.5v8'],
  external: ['M14 4h6v6M20 4l-9 9M18.5 14v5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10'],
  sliders: ['M4 7h9M17.5 7H20M4 17h3.5M12 17h8', C(15.5, 7, 2), C(9.5, 17, 2)],
  user: [C(12, 8.5, 3.6), 'M5 20a7 7 0 0 1 14 0'],
  logout: ['M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4'],
  key: [C(8, 15, 4), 'M11 12l8.5-8.5M16.5 6.5l2 2M14.5 8.5l2 2'],
  info: [C(12, 12, 8.5), 'M12 11v5.5M12 7.8v.2'],
  alert: ['M12 4l9.2 16H2.8zM12 10v4.5M12 17.2v.2'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  trash: ['M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13'],
  location: ['M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z', C(12, 10, 2.3)],
  verified: [
    'M12 3l2.3 1.7 2.8-.2.9 2.7 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-.9 2.7-2.8-.2L12 21l-2.3-1.7-2.8.2-.9-2.7-2.3-1.6.9-2.7-.9-2.7 2.3-1.6.9-2.7 2.8.2zM8.8 12.2l2.2 2.2 4.4-4.4',
  ],
  template: ['M4 4h16v16H4zM4 9h16M9.5 9v11'],
  people: [
    C(9, 8.5, 3),
    'M3.5 19.5a5.5 5.5 0 0 1 11 0M15.5 5.6a3 3 0 0 1 0 5.8M17 14.2a5.2 5.2 0 0 1 3.5 5.3',
  ],
  repo: [
    'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6',
  ],
  org: ['M4 20V6.5L12 3l8 3.5V20M9 20v-5h6v5M8 9.5h.01M12 9.5h.01M16 9.5h.01'],
  code: ['M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5.5l-3 13'],
  chevl: ['M14.5 6l-6 6 6 6'],
  chevr: ['M9.5 6l6 6-6 6'],
  up: ['M7 14l5-5 5 5'],
  down: ['M7 10l5 5 5-5'],
  sparkle: [
    'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  ],
  history: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9M4.5 4.5V9H9M12 8v4.2l3 1.8'],
  cloudoff: ['M3 3l18 18M8.6 8.6A5 5 0 0 0 6.5 18H17M11 5.6A6 6 0 0 1 17.8 10a4 4 0 0 1 3 6.2'],
  gauge: ['M4.5 17a8 8 0 1 1 15 0M12 13l3.5-3.5'],
  spinner: ['M12 3.5a8.5 8.5 0 1 1-8.5 8.5'],
  question: [C(12, 12, 8.5), 'M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8v.2'],
  home: ['M4 10.5L12 4l8 6.5V20h-5.5v-6h-5v6H4z'],
  pulse: ['M3 12h4l2.5-6 5 12 2.5-6h4'],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;

/**
 * One of BuhTig's icons, 16 px square unless `--icon` says otherwise, in the color of the text
 * around it. It is decoration: what it stands for is always said in words beside it, for
 * assistive technology too.
 */
@Component({
  selector: 'app-icon',
  template: `
    <svg viewBox="0 0 24 24" focusable="false" [class.fill]="name() === 'pin-fill'">
      @for (path of paths(); track $index) {
        <path [attr.d]="path" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: var(--icon, 16px);
      height: var(--icon, 16px);
      vertical-align: text-bottom;
    }
    svg {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .fill path:first-child {
      fill: currentColor;
    }
  `,
  host: { 'aria-hidden': 'true' },
})
export class Icon {
  readonly name = input.required<IconName>();

  protected readonly paths = computed(() => ICONS[this.name()]);
}
