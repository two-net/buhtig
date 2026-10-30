import { Injector, Signal, runInInjectionContext } from '@angular/core';
import { Loader } from '../widget/load';
import {
  CommitActivity,
  Commit,
  Contributors,
  IssuesAndPullRequests,
  LanguageCounts,
  Languages,
  LastPush,
  ListedRepository,
  Members,
  OrganizationStats,
  Releases,
  Repository,
  Stats,
  TopRepository,
  YearCount,
} from './resources';

/**
 * What a repository's dashboard knows of it, for its tabs: each part loads once for the
 * dashboard, as the first tab that shows it asks for it, and again on a refresh (FR-DATA-07).
 * Each is asked for where `inject` works, as in a field's initializer.
 */
export abstract class RepositoryData {
  /** `owner/repo`, as GitHub spells it once the dashboard knows, or else as the URL has it. */
  abstract readonly name: Signal<string>;
  /** What the dashboard's head shows of it, once known. */
  abstract readonly repository: Signal<Repository | undefined>;
  abstract readonly stats: () => Loader<Stats>;
  abstract readonly activity: () => Loader<CommitActivity>;
  abstract readonly languages: () => Loader<Languages>;
  abstract readonly contributors: () => Loader<Contributors>;
  abstract readonly issues: () => Loader<IssuesAndPullRequests>;
  abstract readonly commits: () => Loader<Commit[]>;
  abstract readonly releases: () => Loader<Releases>;
}

/** What an organization's dashboard knows of it, for its tabs, as `RepositoryData` does. */
export abstract class OrganizationData {
  /** Its login, as GitHub spells it once the dashboard knows, or else as the URL has it. */
  abstract readonly login: Signal<string>;
  /** The name it goes by, or else its login. */
  abstract readonly displayName: Signal<string>;
  abstract readonly stats: () => Loader<OrganizationStats>;
  abstract readonly repositories: () => Loader<ListedRepository[]>;
  abstract readonly languages: () => Loader<LanguageCounts>;
  abstract readonly topRepositories: () => Loader<TopRepository[]>;
  abstract readonly lastPush: () => Loader<LastPush>;
  abstract readonly createdPerYear: () => Loader<YearCount[]>;
  abstract readonly members: () => Loader<Members>;
  /**
   * The color of each primary language on the dashboard, those of the most repositories in the
   * chart's colors, in order, and the others in the gray of "Other".
   */
  abstract readonly languageColor: Signal<(language: string) => string>;
}

/**
 * `make`, made once, as it is first asked for, where `injector` gives what it needs, so that
 * what it loads lasts as long as `injector`'s component.
 */
export function once<T>(injector: Injector, make: () => T): () => T {
  let made: { value: T } | undefined;
  return () => (made ??= { value: runInInjectionContext(injector, make) }).value;
}

/** Whether two names are the same name, whatever their letter case, as GitHub's are. */
export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
