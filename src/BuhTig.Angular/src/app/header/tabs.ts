import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CompactNumber } from '../format/compact-number';
import { Icon, IconName } from '../icon/icon';

/** One of a dashboard's tabs, as its tab bar shows it. */
export interface Tab {
  label: string;
  icon: IconName;
  link: string;
  /** Whether it is the tab shown. */
  current: boolean;
  /** How many items it has, such as open issues, once known. */
  count?: number;
}

/**
 * A dashboard's tabs, below the header (UI-03), each a link to its own URL (FR-NAV-01), with the
 * one shown underlined and marked as the current page, and how many items each has, once known.
 */
@Component({
  selector: 'app-tabs',
  imports: [CompactNumber, Icon, RouterLink],
  template: `
    <nav class="unav" aria-label="Dashboard sections">
      @for (tab of tabs(); track tab.link) {
        <a [routerLink]="tab.link" [attr.aria-current]="tab.current ? 'page' : null">
          <app-icon [name]="tab.icon" /><span>{{ tab.label }}</span>
          @if (tab.count !== undefined) {
            <span class="counter"><app-compact-number [value]="tab.count" [plain]="true" /></span>
          }
        </a>
      }
    </nav>
  `,
  styles: ':host { display: contents; }',
})
export class Tabs {
  readonly tabs = input.required<Tab[]>();
}
