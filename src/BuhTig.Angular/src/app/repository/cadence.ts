import { Component, computed, inject } from '@angular/core';
import { RepositoryData } from '../dashboard/data';
import { CompactNumber } from '../format/compact-number';
import { duration } from '../format/format';
import { Icon } from '../icon/icon';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { nothingReleased } from './metrics';
import {
  DOWNLOADS,
  NO_FIGURE,
  NO_FILES,
  NO_RELEASES,
  OF_ALL_FILES,
  ONE_RELEASE,
  RELEASED_EVERY,
  RELEASE_CADENCE,
  STABLE,
  andPrereleases,
  onAverageOf,
  releaseCadenceDescription,
} from './messages';

/**
 * How often a repository was released, and downloaded, over its latest releases, on its
 * Releases tab (FR-REPO-16): the mean time from one release to the next, how many are stable
 * and how many pre-releases, and how many times their files were downloaded, unless they have
 * none. Its sentence says how many releases the figures are of. The counts count up as they come
 * into view (FR-ANIM-05).
 */
@Component({
  selector: 'app-repository-release-cadence',
  imports: [CompactNumber, Icon, Loaded, Widget],
  template: `
    <app-widget
      [heading]="RELEASE_CADENCE"
      [empty]="NO_RELEASES"
      emptyIcon="tag"
      skeleton="figures"
      [flush]="true"
      [summary]="summary()"
    >
      <ng-template [appLoaded]="cadence" let-cadence>
        <dl class="stats few" [style.--n]="3">
          <div class="stat">
            <dt><app-icon name="calendar" />{{ RELEASED_EVERY }}</dt>
            @if (cadence.averageInterval !== undefined) {
              <dd class="val">{{ duration(cadence.averageInterval) }}</dd>
              <dd class="sub">{{ onAverageOf(cadence) }}</dd>
            } @else {
              <dd class="val">{{ NO_FIGURE }}</dd>
              <dd class="sub">{{ ONE_RELEASE }}</dd>
            }
          </div>
          <div class="stat">
            <dt><app-icon name="tag" />{{ STABLE }}</dt>
            <dd class="val"><app-compact-number [value]="cadence.stable" [countUp]="true" /></dd>
            <dd class="sub">{{ andPrereleases(cadence.prereleases) }}</dd>
          </div>
          <div class="stat">
            <dt><app-icon name="archive" />{{ DOWNLOADS }}</dt>
            @if (cadence.assets > 0) {
              <dd class="val">
                <app-compact-number [value]="cadence.downloads" [countUp]="true" />
              </dd>
              <dd class="sub">{{ OF_ALL_FILES }}</dd>
            } @else {
              <dd class="val">{{ NO_FIGURE }}</dd>
              <dd class="sub">{{ NO_FILES }}</dd>
            }
          </div>
        </dl>
      </ng-template>
    </app-widget>
  `,
})
export class RepositoryReleaseCadence {
  private readonly data = inject(RepositoryData);

  protected readonly cadence = emptyWhen(this.data.releaseCadence(), nothingReleased);

  protected readonly summary = computed(() => {
    const state = this.cadence.state();
    return state.status === 'ready' ? releaseCadenceDescription(state.data) : '';
  });

  protected readonly duration = duration;
  protected readonly onAverageOf = onAverageOf;
  protected readonly andPrereleases = andPrereleases;
  protected readonly RELEASE_CADENCE = RELEASE_CADENCE;
  protected readonly RELEASED_EVERY = RELEASED_EVERY;
  protected readonly ONE_RELEASE = ONE_RELEASE;
  protected readonly STABLE = STABLE;
  protected readonly DOWNLOADS = DOWNLOADS;
  protected readonly OF_ALL_FILES = OF_ALL_FILES;
  protected readonly NO_FIGURE = NO_FIGURE;
  protected readonly NO_FILES = NO_FILES;
  protected readonly NO_RELEASES = NO_RELEASES;
}
