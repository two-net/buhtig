import { Component, computed, inject, input } from '@angular/core';
import { Resources } from '../dashboard/resources';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { OrganizationBars } from './bars';
import { TOP_REPOSITORIES_HEADERS, starsLabel, topRepositoriesDescription } from './messages';

/**
 * The 10 of an organization's repositories with the most stars (FR-ORG-05), most first. Each
 * opens its repository's dashboard, as the repository table's rows do. Repositories without
 * stars are not among them.
 */
@Component({
  selector: 'app-organization-top-repositories',
  imports: [Loaded, OrganizationBars, Widget],
  templateUrl: './top-repositories.html',
  styleUrl: './top-repositories.css',
})
export class OrganizationTopRepositories {
  private readonly resources = inject(Resources);

  /** The organization's login, as the URL has it. */
  readonly org = input.required<string>();

  protected readonly repositories = load(
    () => this.resources.topRepositories(this.org()),
    (repositories) => repositories.length === 0,
  );

  protected readonly bars = computed(() => {
    const state = this.repositories.state();
    return state.status === 'ready'
      ? state.data.map(({ name, path, stars }) => ({ label: name, value: stars, path }))
      : [];
  });

  protected readonly summary = computed(() => {
    const [top] = this.bars();
    return top === undefined ? '' : topRepositoriesDescription(top.label, top.value);
  });

  protected readonly unit = starsLabel;
  protected readonly headers = TOP_REPOSITORIES_HEADERS;
}
