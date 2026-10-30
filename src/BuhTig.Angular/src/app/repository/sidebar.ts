import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Avatar } from '../avatar/avatar';
import { Segment, SplitBar } from '../chart/stack';
import { RepositoryData } from '../dashboard/data';
import { repositoryTabPath } from '../dashboard/tabs';
import { CompactNumber } from '../format/compact-number';
import { exactDay, exactTime } from '../format/format';
import { RelativeTime } from '../format/relative-time';
import { Icon } from '../icon/icon';
import { Enter } from '../motion/entrance';
import {
  LATEST,
  NO_CODE,
  NO_DESCRIPTION,
  OTHER,
  TOO_MANY_CONTRIBUTORS,
  languagesDescription,
  moreReleases,
} from './messages';

/**
 * What a repository's Overview tab shows beside its widgets (FR-REPO-01): its description,
 * homepage and topics, license, figures, default branch, and when it was created and last pushed
 * to. Then its latest release and how many it has (FR-REPO-08), its contributors' avatars and how
 * many there are (FR-REPO-05), and its languages as a split bar (FR-REPO-04), whose legend names
 * each with its share (NFR-UX-05).
 */
@Component({
  selector: 'app-repository-sidebar',
  imports: [Avatar, CompactNumber, Enter, Icon, RelativeTime, RouterLink, SplitBar],
  templateUrl: './sidebar.html',
  styles: ':host { display: block; min-width: 0; }',
})
export class RepositorySidebar {
  private readonly data = inject(RepositoryData);

  protected readonly repository = this.data.repository;
  private readonly statsLoader = this.data.stats();
  private readonly releasesLoader = this.data.releases();
  private readonly contributorsLoader = this.data.contributors();
  private readonly languagesLoader = this.data.languages();

  protected readonly stats = computed(() => ready(this.statsLoader.state()));
  protected readonly releases = computed(() => ready(this.releasesLoader.state()));
  protected readonly contributors = computed(() => ready(this.contributorsLoader.state()));
  protected readonly languages = computed(() => ready(this.languagesLoader.state()));

  protected readonly latest = computed(() => this.stats()?.latestRelease);

  protected link(tab: 'releases' | 'contributors'): string {
    return repositoryTabPath(this.data.name(), tab);
  }

  /** The homepage without its scheme, as GitHub shows it. */
  protected readonly homepage = computed(() =>
    this.repository()
      ?.homepage?.replace(/^https?:\/\//, '')
      .replace(/\/$/, ''),
  );

  protected readonly segments = computed((): Segment[] => {
    const languages = this.languages();
    if (!languages) {
      return [];
    }
    const segments = languages.languages.map(({ name, bytes }, index) => ({
      label: name,
      value: bytes,
      color: `var(--s${index + 1})`,
    }));
    if (languages.other > 0) {
      segments.push({ label: OTHER, value: languages.other, color: 'var(--s-other)' });
    }
    return segments;
  });

  protected readonly languagesSummary = computed(() => {
    const languages = this.languages();
    return languages && languages.total > 0
      ? languagesDescription(
          languages.languages.map(({ name, bytes }) => ({ name, share: bytes / languages.total })),
        )
      : '';
  });

  protected readonly exactDay = exactDay;
  protected readonly exactTime = exactTime;
  protected readonly moreReleases = moreReleases;
  protected readonly NO_DESCRIPTION = NO_DESCRIPTION;
  protected readonly NO_CODE = NO_CODE;
  protected readonly LATEST = LATEST;
  protected readonly TOO_MANY_CONTRIBUTORS = TOO_MANY_CONTRIBUTORS;
}

function ready<T>(state: { status: string; data?: T }): T | undefined {
  return state.status === 'ready' ? state.data : undefined;
}
