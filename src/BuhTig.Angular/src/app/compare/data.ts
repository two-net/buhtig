import { Signal } from '@angular/core';
import {
  CommitActivity,
  Dated,
  IssueAge,
  LanguageCounts,
  Languages,
  LastPush,
  MergeVelocity,
  OrganizationStats,
  ReleaseCadence,
  Stats,
  WorkflowRuns,
  YearCount,
} from '../dashboard/resources';
import { Loader } from '../widget/load';
import { Compared } from './route';

/**
 * What a comparison knows of its two resources, for its widgets: each part of both, loaded once
 * the comparison knows which they are, from the same endpoints and cache as their dashboards
 * (FR-CMP-05). Each is asked for where `inject` works, as in a field's initializer.
 */
export abstract class ComparisonData {
  /** What the comparison is of: two repositories, or two accounts. */
  abstract readonly kind: Signal<Compared>;
  /** The two resources' names, as GitHub spells them once known, or else as the URL has them. */
  abstract readonly names: Signal<readonly [string, string]>;
  /** Of two repositories, their stat cards' figures (FR-REPO-02). */
  abstract readonly stats: () => Loader<[Stats, Stats]>;
  /** Of two repositories, their commit activity (FR-REPO-03). */
  abstract readonly activity: () => Loader<[CommitActivity, CommitActivity]>;
  /**
   * Of two repositories, how their pull requests updated last came to an end (FR-REPO-13), and
   * when that was fetched (FR-CMP-06), as each of the next three.
   */
  abstract readonly mergeVelocity: () => Loader<[Dated<MergeVelocity>, Dated<MergeVelocity>]>;
  /** Of two repositories, how long their open issues updated last have been open (FR-REPO-13). */
  abstract readonly issueAge: () => Loader<[Dated<IssueAge>, Dated<IssueAge>]>;
  /** Of two repositories, how their latest workflow runs fared (FR-REPO-14). */
  abstract readonly workflowRuns: () => Loader<[Dated<WorkflowRuns>, Dated<WorkflowRuns>]>;
  /** Of two repositories, how often they were released (FR-REPO-16). */
  abstract readonly releaseCadence: () => Loader<[Dated<ReleaseCadence>, Dated<ReleaseCadence>]>;
  /** Of two accounts, their stat cards' figures (FR-ORG-02, FR-USER-02). */
  abstract readonly accountStats: () => Loader<[OrganizationStats, OrganizationStats]>;
  /** Of two accounts, their repositories by last push (FR-ORG-06). */
  abstract readonly lastPush: () => Loader<[LastPush, LastPush]>;
  /** Of two accounts, their repositories created in each year (FR-ORG-06). */
  abstract readonly createdPerYear: () => Loader<[YearCount[], YearCount[]]>;
  /**
   * Of either, their languages: of a repository, its bytes of code in each (FR-REPO-04), and of
   * an account, its repositories with each as their primary language (FR-ORG-04).
   */
  abstract readonly languages: () => Loader<[Shares, Shares]>;
}

/** How much of a resource is in each language, in bytes of code or in repositories. */
export interface Shares {
  /** Those with the most, up to 8, most first. */
  languages: { name: string; value: number }[];
  /** All the others together, which are "Other". */
  other: number;
  /** All of them together. */
  total: number;
}

/** The shares of a repository's `languages`, in bytes of code. */
export function bytesShares(languages: Languages): Shares {
  return {
    languages: languages.languages.map(({ name, bytes }) => ({ name, value: bytes })),
    other: languages.other,
    total: languages.total,
  };
}

/** The shares of an account's languages, in repositories that have each as primary language. */
export function repositoryShares(counts: LanguageCounts): Shares {
  const languages = counts.languages.map(({ name, repositories }) => ({
    name,
    value: repositories,
  }));
  return {
    languages,
    other: counts.other,
    total: languages.reduce((total, language) => total + language.value, counts.other),
  };
}
