import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { RecentRepository, RecentRepositoryAnswer, recentRepository } from '../recent/recent';

/** A public repository in the shared cache, as the Browse page lists it (FR-SRCH-14). */
export interface BrowsedRepository extends RecentRepository {
  /** Its topics, as GitHub gives them, none if it gives none. */
  topics: string[];
}

/** What the Browse page lists, and the most it may list. */
export interface Browsed {
  cap: number;
  repositories: BrowsedRepository[];
}

interface BrowseAnswer {
  cap: number;
  repositories: (RecentRepositoryAnswer & { topics?: unknown })[];
}

/**
 * The public repositories whose dashboards were opened on this BuhTig lately, as many as the
 * Browse page lists, from the shared cache alone (FR-SRCH-14, FR-DATA-04): the server asks GitHub
 * nothing for them.
 */
@Injectable({ providedIn: 'root' })
export class BrowseData {
  private readonly http = inject(HttpClient);

  /** Them, latest first, or the error that the server answered with. */
  list(): Observable<Browsed> {
    return this.http.get<BrowseAnswer>('/-/api/browse').pipe(
      map((answer) => ({
        cap: typeof answer.cap === 'number' && answer.cap > 0 ? answer.cap : 0,
        repositories: answer.repositories.flatMap((listed): BrowsedRepository[] => {
          const repository = recentRepository(listed);
          if (repository === undefined) {
            return [];
          }
          const topics = Array.isArray(listed.topics)
            ? listed.topics.filter(
                (topic): topic is string => typeof topic === 'string' && topic !== '',
              )
            : [];
          return [{ ...repository, topics }];
        }),
      })),
    );
  }
}
