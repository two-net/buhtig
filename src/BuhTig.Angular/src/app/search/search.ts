import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Accounts } from './accounts';
import { problemMessage, userMessage } from './messages';
import { dashboardPath, parse } from './parse';

/**
 * The search box: one input that takes a GitHub repository or organization URL, and opens its
 * dashboard on Enter or "Show dashboard" (SRS §4.1).
 */
@Component({
  selector: 'app-search',
  templateUrl: './search.html',
  styleUrl: './search.css',
})
export class Search {
  private readonly router = inject(Router);
  private readonly accounts = inject(Accounts);

  protected readonly query = signal('');
  /** Why the input opens no dashboard, shown below it (FR-SRCH-04). */
  protected readonly message = signal<string | undefined>(undefined);
  /** Counts edits and searches, so that an account lookup that ends after either is ignored. */
  private attempt = 0;

  protected edit(value: string): void {
    this.attempt++;
    this.query.set(value);
    this.message.set(undefined);
  }

  protected async search(event: Event): Promise<void> {
    event.preventDefault();
    const attempt = ++this.attempt;
    const parsed = parse(this.query());
    if (!parsed.ok) {
      this.message.set(problemMessage(parsed.problem));
      return;
    }
    const { resource } = parsed;
    // A name alone may be a user's, and BuhTig has no dashboards for users (FR-SRCH-06).
    if (resource.kind === 'organization') {
      const isUser = await this.accounts.isUser(resource.org);
      if (attempt !== this.attempt) {
        return;
      }
      if (isUser) {
        this.message.set(userMessage(resource.org));
        return;
      }
    }
    await this.router.navigateByUrl(dashboardPath(resource));
  }
}
