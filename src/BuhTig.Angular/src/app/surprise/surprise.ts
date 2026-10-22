import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

/**
 * "Surprise me", beside "Show dashboard" on the home page: it opens the dashboard of a random
 * public repository that BuhTig has cached (FR-SRCH-10, UI-02).
 */
@Component({
  selector: 'app-surprise',
  templateUrl: './surprise.html',
  styleUrl: './surprise.css',
})
export class Surprise {
  private readonly router = inject(Router);

  /**
   * The repository to open, `owner/repo`, picked as the page loads. None while the cache holds
   * no repository, or when the server cannot say, which hides the button.
   */
  protected readonly name = toSignal(
    inject(HttpClient)
      .get<{ name: string }>('/-/api/surprise')
      .pipe(
        map((surprise) => surprise.name),
        catchError(() => of(undefined)),
      ),
  );

  protected open(name: string): void {
    void this.router.navigateByUrl(`/${name}`);
  }
}
