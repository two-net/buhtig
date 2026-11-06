import { UrlMatchResult, UrlSegment } from '@angular/router';
import { Resource, dashboardPath, parse } from '../search/parse';

/**
 * What a comparison is of: two repositories, or two accounts, each an organization or a user,
 * which GitHub tells (FR-CMP-01).
 */
export type Compared = 'repository' | 'account';

/** What stands between the two resources in a comparison's URL, as in GitHub's own. */
const BETWEEN = '...';

/**
 * The two resources a comparison's URL names below `/-/compare/`, as `parts`, its segments: two
 * repositories, as `{owner1}/{repo1}...{owner2}/{repo2}`, or two accounts, as
 * `{account1}...{account2}` (FR-CMP-01). `undefined` for any other form, or a name no resource
 * can have.
 *
 * Account names have no periods but repository names may, even `...`, so the second owner's
 * name starts after the last `...` of the middle segment, `{repo1}...{owner2}`.
 */
export function comparedAt(
  parts: readonly string[],
): { kind: Compared; first: Resource; second: Resource } | undefined {
  let names: [string, string];
  let kind: Compared;
  if (parts.length === 3) {
    const [owner, middle, repo] = parts;
    const at = middle.lastIndexOf(BETWEEN);
    if (at < 0) {
      return undefined;
    }
    names = [`${owner}/${middle.slice(0, at)}`, `${middle.slice(at + BETWEEN.length)}/${repo}`];
    kind = 'repository';
  } else if (parts.length === 1) {
    const [middle] = parts;
    const at = middle.indexOf(BETWEEN);
    if (at < 0) {
      return undefined;
    }
    names = [middle.slice(0, at), middle.slice(at + BETWEEN.length)];
    kind = 'account';
  } else {
    return undefined;
  }
  const [first, second] = names.map((name) => named(name, kind));
  return first && second ? { kind, first, second } : undefined;
}

/**
 * The resource `name` is, if it is one of `kind`, written as its dashboard's path is: not a URL,
 * nor a repository's name with `.git`, which `parse` takes too.
 */
function named(name: string, kind: Compared): Resource | undefined {
  const parsed = parse(name);
  return parsed.ok && parsed.resource.kind === kind && dashboardPath(parsed.resource) === `/${name}`
    ? parsed.resource
    : undefined;
}

/**
 * Matches a comparison, at `/-/compare/{owner1}/{repo1}...{owner2}/{repo2}` or
 * `/-/compare/{account1}...{account2}`, below `/-/compare/` (FR-CMP-01). It gives the parameters
 * `kind`, `repository` or `account`, and `first` and `second`, the names of the two, such as
 * `owner/repo`, as the URL spells them.
 */
export function compareMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  const compared = comparedAt(segments.map((segment) => segment.path));
  if (compared === undefined) {
    return null;
  }
  const name = (resource: Resource) => new UrlSegment(dashboardPath(resource).slice(1), {});
  return {
    consumed: segments,
    posParams: {
      kind: new UrlSegment(compared.kind, {}),
      first: name(compared.first),
      second: name(compared.second),
    },
  };
}

/**
 * The URL of the comparison of `first` with `second`, two repositories, or two accounts, of any
 * kind (FR-CMP-01). Names need no escaping: they are letters, digits and `._-`.
 */
export function comparePath(first: Resource, second: Resource): string {
  return `/-/compare/${dashboardPath(first).slice(1)}${BETWEEN}${dashboardPath(second).slice(1)}`;
}
