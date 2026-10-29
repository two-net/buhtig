import { Component, computed, inject, input } from '@angular/core';
import { LanguageCounts, Resources } from '../dashboard/resources';
import { load } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { Bar, OrganizationBars } from './bars';
import { LANGUAGES_HEADERS, OTHER, languagesDescription, repositoriesLabel } from './messages';

/**
 * How many of an organization's repositories have each primary language (FR-ORG-04): the 8
 * languages of the most repositories, most first, and the rest together as "Other". Those
 * without a primary language are not counted.
 */
@Component({
  selector: 'app-organization-languages',
  imports: [Loaded, OrganizationBars, Widget],
  templateUrl: './languages.html',
  styleUrl: './languages.css',
})
export class OrganizationLanguages {
  private readonly resources = inject(Resources);

  /** The organization's login, as the URL has it. */
  readonly org = input.required<string>();

  protected readonly languages = load(
    () => this.resources.organizationLanguages(this.org()),
    ({ languages, other }) => languages.length === 0 && other === 0,
  );

  protected readonly bars = computed(() => {
    const state = this.languages.state();
    return state.status === 'ready' ? bars(state.data) : [];
  });

  protected readonly summary = computed(() => {
    const state = this.languages.state();
    const top = state.status === 'ready' ? state.data.languages[0] : undefined;
    return top === undefined ? '' : languagesDescription(top, sum(this.bars()));
  });

  protected readonly unit = repositoriesLabel;
  protected readonly headers = LANGUAGES_HEADERS;
}

/** The figures of `bars` together. */
function sum(bars: Bar[]): number {
  return bars.reduce((sum, bar) => sum + bar.value, 0);
}

function bars({ languages, other }: LanguageCounts): Bar[] {
  const bars = languages.map(({ name, repositories }) => ({ label: name, value: repositories }));
  return other > 0 ? [...bars, { label: OTHER, value: other }] : bars;
}
