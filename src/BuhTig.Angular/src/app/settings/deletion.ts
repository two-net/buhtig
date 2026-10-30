import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Dialog } from '../dialog/dialog';
import { Icon } from '../icon/icon';
import { Session } from '../session/session';
import { Toasts } from '../toast/toasts';
import {
  CONFIRM_DELETION,
  DATA_DELETED,
  DELETE_FAILED,
  DELETION_PURPOSE,
  GITHUB_ACCESS,
  REVIEW_GITHUB_ACCESS,
  deletionWarning,
} from './messages';

/**
 * Where a signed-in user deletes all that BuhTig keeps of theirs, in Settings (FR-PERS-04): their
 * account, sessions, credentials, private cache, history and pins. It says what goes, and that
 * BuhTig's access to their GitHub account is revoked on GitHub, and deletes nothing until the
 * user confirms in a dialog. Once it has, the user is signed out, and sent home.
 */
@Component({
  selector: 'app-data-deletion',
  imports: [Dialog, Icon],
  template: `
    <section id="data" class="section" aria-labelledby="data-heading">
      <h2 id="data-heading" tabindex="-1">Your data</h2>
      <p class="help">{{ DELETION_PURPOSE }}</p>
      <p class="help">
        {{ GITHUB_ACCESS }}
        <a href="https://github.com/settings/applications">{{ REVIEW_GITHUB_ACCESS }}</a>
      </p>
      <button type="button" class="btn danger" (click)="confirming.set(true)">
        <app-icon name="trash" />Delete my data
      </button>
    </section>
    @if (confirming()) {
      <app-dialog [heading]="CONFIRM_DELETION" (closed)="cancel()">
        <p>{{ warning() }}</p>
        @if (problem(); as problem) {
          <p class="field-msg err" role="alert"><app-icon name="alert" />{{ problem }}</p>
        }
        <button actions type="button" class="btn" [disabled]="busy()" (click)="cancel()">
          Cancel
        </button>
        <button actions type="button" class="btn danger" [disabled]="busy()" (click)="delete()">
          Delete my data
        </button>
      </app-dialog>
    }
  `,
})
export class DataDeletion {
  private readonly session = inject(Session);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  /** Whether the user is asked to confirm. */
  protected readonly confirming = signal(false);
  /** Whether the server is deleting the data. */
  protected readonly busy = signal(false);
  /** Why the data was not deleted, if it was not. */
  protected readonly problem = signal('');

  protected warning(): string {
    return deletionWarning(this.session.user()?.login ?? '');
  }

  protected cancel(): void {
    if (this.busy()) {
      return;
    }
    this.confirming.set(false);
    this.problem.set('');
  }

  protected delete(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.problem.set('');
    this.session.deleteUser().subscribe({
      next: () => {
        this.busy.set(false);
        this.confirming.set(false);
        this.toasts.show(DATA_DELETED, 'trash');
        void this.router.navigateByUrl('/');
      },
      error: () => {
        this.busy.set(false);
        this.problem.set(DELETE_FAILED);
      },
    });
  }

  protected readonly DELETION_PURPOSE = DELETION_PURPOSE;
  protected readonly GITHUB_ACCESS = GITHUB_ACCESS;
  protected readonly REVIEW_GITHUB_ACCESS = REVIEW_GITHUB_ACCESS;
  protected readonly CONFIRM_DELETION = CONFIRM_DELETION;
}
