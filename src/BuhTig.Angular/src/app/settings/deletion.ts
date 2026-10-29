import { Component, ElementRef, Injector, afterNextRender, inject, signal } from '@angular/core';
import { Session } from '../session/session';
import {
  CONFIRM_DELETION,
  DELETE_FAILED,
  DELETION_PURPOSE,
  GITHUB_ACCESS,
  REVIEW_GITHUB_ACCESS,
} from './messages';

/**
 * Where a signed-in user deletes all that BuhTig keeps of theirs, in Settings (FR-PERS-04): their
 * account, sessions, credentials, private cache, history and pins. It says what goes, and that
 * BuhTig's access to their GitHub account is revoked on GitHub, and deletes nothing until the
 * user confirms. Once it has, the user is signed out, and Settings says so in its place.
 */
@Component({
  selector: 'app-data-deletion',
  templateUrl: './deletion.html',
  styleUrl: './settings.css',
})
export class DataDeletion {
  private readonly session = inject(Session);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Whether the user is asked to confirm. */
  protected readonly confirming = signal(false);
  /** Whether the server is deleting the data. */
  protected readonly busy = signal(false);
  /** Why the data was not deleted, if it was not. */
  protected readonly problem = signal('');

  /** Asks the user to confirm, with focus on the question. */
  protected ask(): void {
    this.confirming.set(true);
    this.focus('#deletion-question');
  }

  /** Deletes nothing, with focus back on the button that asked. */
  protected cancel(): void {
    this.confirming.set(false);
    this.problem.set('');
    this.focus('#delete-data');
  }

  protected delete(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.problem.set('');
    // Once it is done, Settings shows that it is, in place of this.
    this.session.deleteUser().subscribe({
      error: () => {
        this.busy.set(false);
        this.problem.set(DELETE_FAILED);
        // Back on the button, disabled meanwhile, to try again.
        this.focus('#confirm-deletion');
      },
    });
  }

  /**
   * Focuses what `selector` finds, once the page shows the change, in place of the button that
   * made it, which is gone or was disabled meanwhile.
   */
  private focus(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }

  protected readonly DELETION_PURPOSE = DELETION_PURPOSE;
  protected readonly GITHUB_ACCESS = GITHUB_ACCESS;
  protected readonly REVIEW_GITHUB_ACCESS = REVIEW_GITHUB_ACCESS;
  protected readonly CONFIRM_DELETION = CONFIRM_DELETION;
}
