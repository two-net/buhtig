import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { Icon } from '../icon/icon';

/**
 * "Surprise me", on the visitor's home page: it opens the dashboard of a random public
 * repository that BuhTig has cached (FR-SRCH-10, UI-02). It is there only while the cache holds
 * one.
 */
@Component({
  selector: 'app-surprise',
  imports: [Icon],
  template: `
    @if (name(); as picked) {
      <button type="button" (click)="open(picked)"><app-icon name="sparkle" />Surprise me</button>
    }
  `,
  styles: ':host { display: contents; }',
})
export class Surprise {
  private readonly router = inject(Router);

  /**
   * The repository to open, `owner/repo`, picked as the page loads: `undefined` until the server
   * has picked one, and `null` while the cache holds none, or when the server cannot say, which
   * hides the button.
   */
  protected readonly name = toSignal(
    inject(HttpClient)
      .get<{ name: string }>('/-/api/surprise')
      .pipe(
        map((surprise) => surprise.name),
        catchError(() => of(null)),
      ),
  );

  protected open(name: string): void {
    void this.router.navigateByUrl(`/${name}`);
  }
}
