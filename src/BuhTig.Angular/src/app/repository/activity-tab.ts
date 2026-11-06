import { Component } from '@angular/core';
import { RepositoryActivity } from './activity';
import { RepositoryCodeFrequency } from './code-frequency';
import { RepositoryCommits } from './commits';
import { RepositoryWorkflows } from './workflows';

/**
 * A repository's Activity tab: its commit activity, larger, the lines added and deleted each week
 * (FR-REPO-15), how its workflow runs fare (FR-REPO-14), and its 10 latest commits.
 */
@Component({
  selector: 'app-repository-activity-tab',
  imports: [RepositoryActivity, RepositoryCodeFrequency, RepositoryCommits, RepositoryWorkflows],
  template: `
    <div class="stack-v">
      <app-repository-activity [height]="240" />
      <app-repository-code-frequency />
      <app-repository-workflows />
      <app-repository-commits />
    </div>
  `,
})
export class RepositoryActivityTab {}
