import { Component, computed, inject, input } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { filter, switchMap } from 'rxjs';
import { Resource, dashboardPath } from '../search/parse';
import { Canonical } from './canonical';

/**
 * A repository's or organization's dashboard, at `/{owner}/{repo}` or `/{org}` (FR-NAV-01). Once
 * it knows how GitHub spells the names, it moves there, in place of the URL it was opened at
 * (FR-NAV-04, FR-NAV-05). For now it shows only the name, until the dashboards are built (#14,
 * #15, #18).
 */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private readonly router = inject(Router);

  readonly owner = input<string>();
  readonly repo = input<string>();
  readonly org = input<string>();

  protected readonly name = computed(() => this.org() ?? `${this.owner()}/${this.repo()}`);

  private readonly resource = computed<Resource>(() => {
    const org = this.org();
    return org !== undefined
      ? { kind: 'organization', org }
      : { kind: 'repository', owner: this.owner()!, repo: this.repo()! };
  });

  constructor() {
    const canonical = inject(Canonical);
    toObservable(this.resource)
      .pipe(
        // A dashboard left behind no longer moves.
        switchMap((resource) =>
          canonical
            .path(resource)
            .pipe(filter((path) => path !== undefined && path !== dashboardPath(resource))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((path) => {
        // In place of the URL in the history, so that Back does not lead to it again.
        void this.router.navigate([path], {
          replaceUrl: true,
          queryParamsHandling: 'preserve',
          preserveFragment: true,
        });
      });
  }
}
