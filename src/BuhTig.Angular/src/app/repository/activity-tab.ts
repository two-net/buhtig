import { Component } from '@angular/core';
import { RepositoryActivity } from './activity';
import { RepositoryCommits } from './commits';

/** A repository's Activity tab: its commit activity, larger, and its 10 latest commits. */
@Component({
  selector: 'app-repository-activity-tab',
  imports: [RepositoryActivity, RepositoryCommits],
  template: `
    <div class="stack-v">
      <app-repository-activity [height]="240" />
      <app-repository-commits />
    </div>
  `,
})
export class RepositoryActivityTab {}
