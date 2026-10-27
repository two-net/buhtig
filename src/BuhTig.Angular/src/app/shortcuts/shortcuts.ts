import { Component, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { Session } from '../session/session';
import { Personal } from './personal';
import { pick } from './pick';

/** A signed-in user's pinned and recent dashboards, below the search box (FR-SRCH-08). */
@Component({
  selector: 'app-shortcuts',
  imports: [RouterLink],
  templateUrl: './shortcuts.html',
  styleUrl: './shortcuts.css',
})
export class Shortcuts {
  private readonly personal = inject(Personal);

  /** None for a visitor, and none when the server cannot say. */
  protected readonly shortcuts = toSignal(
    toObservable(inject(Session).user).pipe(
      switchMap((user) =>
        user
          ? this.personal.list().pipe(
              map(({ pins, recent }) => pick(pins, recent)),
              catchError(() => of([])),
            )
          : of([]),
      ),
    ),
    { initialValue: [] },
  );
}
