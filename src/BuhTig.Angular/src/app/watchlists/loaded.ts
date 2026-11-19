import { Injectable, signal } from '@angular/core';
import { Glance } from '../dashboard/resources';

/**
 * What the rows of a watchlist's page have loaded, by repository, for the page to sort them and
 * download them (FR-PERS-12, FR-EXP-07), without asking anything again. Each row says what it
 * shows once GitHub has shown it the repository, and that it shows nothing once it is gone.
 */
@Injectable()
export class LoadedRows {
  private readonly glances = signal<ReadonlyMap<string, Glance>>(new Map());

  /** What each row shows, by its repository's name as it was added, in lower case. */
  readonly loaded = this.glances.asReadonly();

  /** Says that the row of `name` shows `glance`, or nothing, if `undefined`. */
  set(name: string, glance: Glance | undefined): void {
    const key = name.toLowerCase();
    if (this.glances().get(key) === glance) {
      return;
    }
    this.glances.update((glances) => {
      const updated = new Map(glances);
      if (glance === undefined) {
        updated.delete(key);
      } else {
        updated.set(key, glance);
      }
      return updated;
    });
  }
}

/** What the row of `name` shows, in `loaded`, once it has loaded. */
export function loadedRow(loaded: ReadonlyMap<string, Glance>, name: string): Glance | undefined {
  return loaded.get(name.toLowerCase());
}
