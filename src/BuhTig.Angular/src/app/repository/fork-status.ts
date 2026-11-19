import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { comparePath } from '../compare/route';
import { RepositoryData } from '../dashboard/data';
import { Icon } from '../icon/icon';
import { COMPARE_WITH_PARENT, comparingWith, notComparedWith, parentStanding } from './messages';

/**
 * How far a fork's default branch is from its parent's, the parent named, and a link to compare
 * the two (FR-REPO-19), on the fork line of the head of a fork whose parent GitHub names. The
 * figures load with the rest of the dashboard: a placeholder until then, and if they fail, that
 * they did, with a way to try again, while the rest of the head stays as it is (FR-REPO-09).
 */
@Component({
  selector: 'app-fork-status',
  imports: [Icon, RouterLink],
  template: `
    @switch (state().status) {
      @case ('ready') {
        <span class="standing">{{ standing() }}</span>
      }
      @case ('error') {
        <span class="standing"><app-icon name="alert" />{{ failed() }}</span
        >&ngsp;<button type="button" class="btn sm ghost" (click)="loader.retry()">
          <app-icon name="refresh" />Try again
        </button>
      }
      @default {
        <span class="skel line standing-skel" aria-hidden="true"></span>
        <span class="sr">{{ comparing() }}</span>
      }
    }
    &ngsp;<a class="compare-parent" [routerLink]="comparison()"
      ><app-icon name="compare" />{{ COMPARE_WITH_PARENT }}</a
    >
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 12px;
      margin-left: 8px;
    }
    .standing,
    .compare-parent {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .skel.line.standing-skel {
      display: inline-block;
      width: 160px;
      height: 10px;
      margin: 0;
    }
  `,
})
export class ForkStatus {
  /** The fork's `owner/repo`, and its parent's. */
  readonly name = input.required<string>();
  readonly parent = input.required<string>();

  protected readonly loader = inject(RepositoryData).parentComparison();
  protected readonly state = this.loader.state;

  protected readonly standing = computed(() => {
    const state = this.state();
    return state.status === 'ready' ? parentStanding(state.data) : '';
  });
  protected readonly comparing = computed(() => comparingWith(this.parent()));
  protected readonly failed = computed(() => notComparedWith(this.parent()));

  /** The comparison of the parent and the fork (FR-CMP-01). */
  protected readonly comparison = computed(() =>
    comparePath(repositoryOf(this.parent()), repositoryOf(this.name())),
  );

  protected readonly COMPARE_WITH_PARENT = COMPARE_WITH_PARENT;
}

function repositoryOf(name: string): { kind: 'repository'; owner: string; repo: string } {
  const [owner, repo] = name.split('/');
  return { kind: 'repository', owner, repo };
}
