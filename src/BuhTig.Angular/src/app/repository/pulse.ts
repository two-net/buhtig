import { Component, computed, inject } from '@angular/core';
import { SplitBar } from '../chart/stack';
import { RepositoryData } from '../dashboard/data';
import { CompactNumber } from '../format/compact-number';
import { RelativeTime } from '../format/relative-time';
import { Icon } from '../icon/icon';
import { Enter } from '../motion/entrance';
import { FAILED } from '../widget/messages';
import { stateSegments } from './issues';
import { issuesDescription, pullRequestsDescription } from './messages';

/**
 * A repository's stat cards (FR-REPO-02): its stars, forks, watchers, open issues and open pull
 * requests, apart from each other, and its latest release, which links to its page on GitHub
 * (FR-REPO-12). Below them, its issues and pull requests by state, as split bars (FR-REPO-06).
 * The figures count up as the box comes into view (FR-ANIM-05).
 */
@Component({
  selector: 'app-repository-pulse',
  imports: [CompactNumber, Enter, Icon, RelativeTime, SplitBar],
  template: `
    <section
      class="Box"
      aria-labelledby="pulse-heading"
      appEnter="Repository stats"
      [appEnterReady]="stats() !== undefined"
    >
      <div class="Box-header">
        <h2 class="Box-title" id="pulse-heading">Overview</h2>
        <span class="muted small">All time</span>
      </div>
      @switch (statsState().status) {
        @case ('ready') {
          @let shown = stats()!;
          <dl class="stats">
            <div class="stat">
              <dt><app-icon name="star" />Stars</dt>
              <dd class="val"><app-compact-number [value]="shown.stars" [countUp]="true" /></dd>
            </div>
            <div class="stat">
              <dt><app-icon name="fork" />Forks</dt>
              <dd class="val"><app-compact-number [value]="shown.forks" [countUp]="true" /></dd>
            </div>
            <div class="stat">
              <dt><app-icon name="eye" />Watching</dt>
              <dd class="val"><app-compact-number [value]="shown.watchers" [countUp]="true" /></dd>
            </div>
            <div class="stat">
              <dt><app-icon name="issue" />Open issues</dt>
              <dd class="val">
                <app-compact-number [value]="shown.openIssues" [countUp]="true" />
              </dd>
            </div>
            <div class="stat">
              <dt><app-icon name="pr" />Open pull requests</dt>
              <dd class="val">
                <app-compact-number [value]="shown.openPullRequests" [countUp]="true" />
              </dd>
            </div>
            <div class="stat">
              <dt><app-icon name="tag" />Latest release</dt>
              @if (shown.latestRelease; as release) {
                <dd class="val">
                  @if (release.url; as url) {
                    <a [href]="url">{{ release.tag }}</a>
                  } @else {
                    {{ release.tag }}
                  }
                </dd>
                @if (release.publishedAt; as publishedAt) {
                  <dd class="sub"><app-relative-time [value]="publishedAt" /></dd>
                }
              } @else {
                <dd class="val">None</dd>
                <dd class="sub">No releases yet</dd>
              }
            </div>
          </dl>
          @if (bars(); as bars) {
            <div class="pulse-bars">
              @for (bar of bars; track bar.label) {
                <app-split-bar
                  [label]="bar.label"
                  [segments]="bar.segments"
                  [shares]="false"
                  [summary]="bar.summary"
                />
              }
            </div>
          }
        }
        @case ('error') {
          <div class="pad">
            <div class="w-state">
              <app-icon name="alert" /><span>{{ FAILED }}</span>
              <button type="button" class="btn sm" (click)="statsLoader.retry()">
                <app-icon name="refresh" />Try again
              </button>
            </div>
          </div>
        }
        @default {
          <div class="pad" aria-hidden="true"><span class="skel block pulse-skel"></span></div>
        }
      }
    </section>
  `,
  styles: '.pulse-skel { --sh: 70px; }',
})
export class RepositoryPulse {
  private readonly data = inject(RepositoryData);

  protected readonly statsLoader = this.data.stats();
  private readonly issues = this.data.issues();

  protected readonly statsState = this.statsLoader.state;
  protected readonly stats = computed(() => {
    const state = this.statsState();
    return state.status === 'ready' ? state.data : undefined;
  });

  /** The split bars of issues and pull requests, unless there are none of either. */
  protected readonly bars = computed(() => {
    const state = this.issues.state();
    if (state.status !== 'ready') {
      return undefined;
    }
    const issues = state.data;
    const bars = [];
    const issueSegments = stateSegments(issues, 'issue');
    if (issues.issues && issueSegments) {
      bars.push({
        label: 'Issues',
        segments: issueSegments,
        summary: issuesDescription(issues.issues.open, issues.issues.closed),
      });
    }
    const pullSegments = stateSegments(issues, 'pull_request');
    if (issues.pullRequests && pullSegments) {
      const { open, merged, closed } = issues.pullRequests;
      bars.push({
        label: 'Pull requests',
        segments: pullSegments,
        summary: pullRequestsDescription(open, merged, closed),
      });
    }
    const any = bars.some((bar) => bar.segments.some((segment) => segment.value > 0));
    return any ? bars : undefined;
  });

  protected readonly FAILED = FAILED;
}
