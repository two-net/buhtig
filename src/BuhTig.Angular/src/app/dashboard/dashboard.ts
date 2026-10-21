import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * A repository's or organization's dashboard, at `/{owner}/{repo}` or `/{org}` (FR-NAV-01). For
 * now it shows only the name, until the dashboards are built (#14, #15, #18).
 */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  readonly owner = input<string>();
  readonly repo = input<string>();
  readonly org = input<string>();

  protected readonly name = computed(() => this.org() ?? `${this.owner()}/${this.repo()}`);
}
