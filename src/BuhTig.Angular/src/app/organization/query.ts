import { ParamMap, Params } from '@angular/router';
import { Filter, NO_FILTER, RepositoryType, Sort } from './table';

// The repository list's place in its URL, so that a view of it can be bookmarked and shared
// (FR-ORG-03). Its query parameters are those of GitHub's own lists, at
// `/orgs/{org}/repositories` and `/{user}?tab=repositories`, so that replacing `github.host`
// with BuhTig's host in a link to one opens the same view, and back (FR-NAV-02).

/** What the repository list shows: its filters, its order, and its page, from 0. */
export interface ListView {
  filter: Filter;
  sort: Sort;
  page: number;
}

/** The list as it starts: every repository, pushed to last first, from its first page. */
export const DEFAULT_VIEW: ListView = { filter: NO_FILTER, sort: 'pushed', page: 0 };

/** The query parameters that hold the list's view, as GitHub's lists name them. */
export const LIST_PARAMS = ['q', 'type', 'language', 'sort', 'page'] as const;

/** Each type, as GitHub's lists spell it in their `type`. */
const TYPE_PARAMS: Record<RepositoryType, string> = {
  all: 'all',
  public: 'public',
  private: 'private',
  sources: 'source',
  forks: 'fork',
  archived: 'archived',
};

/**
 * The types that `type` may name: GitHub's spellings, BuhTig's own, and `internal`, which the
 * list counts among the private ones, as an organization's page on GitHub has it. A map, so that
 * no name of an object's own, such as `constructor`, is taken for one.
 */
const TYPES_BY_PARAM = new Map<string, RepositoryType>([
  ...(Object.entries(TYPE_PARAMS) as [RepositoryType, string][]).flatMap(
    ([type, param]): [string, RepositoryType][] => [
      [param, type],
      [type, type],
    ],
  ),
  ['internal', 'private'],
]);

/** Each order, as GitHub's lists spell it in their `sort`, but the first, which has none. */
const SORT_PARAMS: Record<Exclude<Sort, 'pushed'>, string> = { name: 'name', stars: 'stargazers' };

/** The orders that `sort` may name, in GitHub's spelling or BuhTig's own. */
const SORTS_BY_PARAM = new Map<string, Sort>([
  ['name', 'name'],
  ['stargazers', 'stars'],
  ['stars', 'stars'],
]);

/**
 * The view that `params` give, whatever else they hold. A value it does not know, such as
 * `type=mirror` or `page=two`, gives the view as it starts, so that no URL fails to open. A
 * language is any, whatever its letter case, since the viewer may not see what the sender did.
 */
export function viewOf(params: ParamMap): ListView {
  return {
    filter: {
      name: params.get('q')?.trim() ?? '',
      language: params.get('language')?.trim() || undefined,
      type: TYPES_BY_PARAM.get(params.get('type')?.toLowerCase() ?? '') ?? NO_FILTER.type,
    },
    sort: SORTS_BY_PARAM.get(params.get('sort')?.toLowerCase() ?? '') ?? DEFAULT_VIEW.sort,
    page: pageIndexOf(params.get('page')),
  };
}

/**
 * The query parameters of `view`, each in GitHub's spelling, and `null` where it is as the list
 * starts, so that merging them into a URL leaves those out, and every other parameter as it is.
 */
export function queryOf({
  filter,
  sort,
  page,
}: ListView): Record<(typeof LIST_PARAMS)[number], string | null> {
  return {
    q: filter.name.trim() || null,
    type: filter.type === NO_FILTER.type ? null : TYPE_PARAMS[filter.type],
    language: filter.language?.toLowerCase() ?? null,
    sort: sort === 'pushed' ? null : SORT_PARAMS[sort],
    page: page > 0 ? String(page + 1) : null,
  };
}

/** The list's query parameters in `url`, and none other, as they are. */
export function listParamsOf(url: string): Params {
  const query = new URLSearchParams(url.split('#')[0].split('?')[1] ?? '');
  return Object.fromEntries(
    LIST_PARAMS.flatMap((name) => {
      const value = query.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
}

/** The page, from 0, that `page` names, from 1: the first unless it is a whole number. */
function pageIndexOf(page: string | null): number {
  if (page === null || !/^\d+$/.test(page)) {
    return 0;
  }
  return Math.max(Number(page) - 1, 0);
}
