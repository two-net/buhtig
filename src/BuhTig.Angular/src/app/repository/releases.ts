import { Component, computed, inject } from '@angular/core';
import { RepositoryData } from '../dashboard/data';
import { exactDay, exactTime } from '../format/format';
import { Icon } from '../icon/icon';
import { emptyWhen } from '../widget/load';
import { Loaded, Widget } from '../widget/widget';
import { LATEST, NO_RELEASES, PRERELEASE } from './messages';

/**
 * A repository's Releases tab: its 5 latest releases (FR-REPO-08), each with its tag, linking to
 * its page on GitHub (FR-REPO-12), its name, the date it was published, and what it was made
 * from. The one GitHub marks as the latest says so.
 */
@Component({
  selector: 'app-repository-releases-tab',
  imports: [Icon, Loaded, Widget],
  template: `
    <div class="stack-v">
      <app-widget
        heading="Releases"
        [empty]="NO_RELEASES"
        emptyIcon="tag"
        skeleton="list"
        [flush]="true"
      >
        <ng-template [appLoaded]="releases" let-releases>
          <ul class="rows stagger" aria-label="Releases">
            @for (release of releases.releases; track release.tag) {
              <li class="release" [style.--i]="$index">
                <h3>
                  @if (release.url; as url) {
                    <a [href]="url">{{ release.tag }}</a>
                  } @else {
                    {{ release.tag }}
                  }
                  @if (release.tag === latest()) {
                    <span class="label success">{{ LATEST }}</span>
                  }
                  @if (release.prerelease) {
                    <span class="label attention">{{ PRERELEASE }}</span>
                  }
                </h3>
                @if (release.name) {
                  <p class="rel-name">{{ release.name }}</p>
                }
                <div class="m">
                  @if (release.publishedAt; as publishedAt) {
                    <span
                      ><app-icon name="calendar" /><time
                        [attr.datetime]="publishedAt.toISOString()"
                        [title]="exactTime(publishedAt)"
                        >{{ exactDay(publishedAt) }}</time
                      ></span
                    >
                  }
                  <span><app-icon name="tag" />{{ release.tag }}</span>
                  @if (release.target) {
                    <span><app-icon name="branch" />{{ release.target }}</span>
                  }
                </div>
              </li>
            }
          </ul>
        </ng-template>
      </app-widget>
    </div>
  `,
})
export class RepositoryReleasesTab {
  private readonly data = inject(RepositoryData);

  protected readonly releases = emptyWhen(
    this.data.releases(),
    (releases) => releases.releases.length === 0,
  );

  private readonly stats = this.data.stats();

  /** The tag of the release GitHub marks as the latest, once known. */
  protected readonly latest = computed(() => {
    const state = this.stats.state();
    return state.status === 'ready' ? state.data.latestRelease?.tag : undefined;
  });

  protected readonly exactDay = exactDay;
  protected readonly exactTime = exactTime;
  protected readonly NO_RELEASES = NO_RELEASES;
  protected readonly LATEST = LATEST;
  protected readonly PRERELEASE = PRERELEASE;
}
