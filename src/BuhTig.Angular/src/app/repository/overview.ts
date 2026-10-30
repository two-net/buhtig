import { Component } from '@angular/core';
import { RepositoryActivity } from './activity';
import { RepositoryCommits } from './commits';
import { RepositoryRecentIssues } from './issues';
import { RepositoryPulse } from './pulse';
import { RepositorySidebar } from './sidebar';

/**
 * A repository's Overview tab: its stat cards, commit activity, 5 latest commits and 6 issues and
 * pull requests that changed last, with what else it shows beside them.
 */
@Component({
  selector: 'app-repository-overview',
  imports: [
    RepositoryActivity,
    RepositoryCommits,
    RepositoryPulse,
    RepositoryRecentIssues,
    RepositorySidebar,
  ],
  template: `
    <div class="layout">
      <div class="stack-v">
        <app-repository-pulse />
        <app-repository-activity />
        <app-repository-commits [limit]="5" [footer]="true" />
        <app-repository-recent-issues />
      </div>
      <app-repository-sidebar />
    </div>
  `,
})
export class RepositoryOverview {}
