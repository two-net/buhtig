/** A GitHub resource that BuhTig has a dashboard for. */
export type Resource =
  { kind: 'repository'; owner: string; repo: string } | { kind: 'organization'; org: string };

/** Why an input names no resource. */
export type Problem =
  | { kind: 'empty' }
  | { kind: 'not-github' }
  | { kind: 'unrecognized' }
  | { kind: 'bad-account'; name: string }
  | { kind: 'bad-repository'; name: string };

export type Parsed = { ok: true; resource: Resource } | { ok: false; problem: Problem };

/** The schemes of the URLs GitHub gives out for a repository: on the web, and to clone. */
const SCHEMES = new Set(['http', 'https', 'ssh']);

/**
 * An account's name (FR-SRCH-04): up to 39 letters, digits, hyphens and underscores, not
 * starting with a hyphen. GitHub's rule today is stricter, but older accounts have consecutive
 * or trailing hyphens, and Enterprise Managed Users have an underscore. The server checks the
 * same rule, in `accounts.rs`.
 */
const ACCOUNT = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,38}$/;

/** A repository's name: up to 100 letters, digits, hyphens, underscores and periods. */
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;

/** How the forms of SRS Table 4-1 begin, up to an organization's name, in lowercase. */
const BEGINNINGS = [
  'https://github.com/orgs/',
  'https://www.github.com/orgs/',
  'http://github.com/orgs/',
  'http://www.github.com/orgs/',
  'github.com/orgs/',
  'www.github.com/orgs/',
  'ssh://git@github.com/orgs/',
  'git@github.com:orgs/',
  'orgs/',
];

/**
 * The repository or organization that `input` names, in any of the forms of SRS Table 4-1, or
 * why it names none (FR-SRCH-01, FR-SRCH-02, FR-SRCH-04, FR-SRCH-05).
 */
export function parse(input: string): Parsed {
  const text = input.trim().split(/[?#]/)[0];
  if (text === '') {
    return problem({ kind: 'empty' });
  }
  const location = locate(text);
  if (location === undefined) {
    return problem({ kind: 'unrecognized' });
  }
  if (location.host !== undefined && location.host !== 'github.com') {
    return problem({ kind: 'not-github' });
  }
  const segments = location.path.split('/').filter((segment) => segment !== '');
  if (segments[0]?.toLowerCase() === 'orgs') {
    return segments.length > 1 ? organization(segments[1]) : problem({ kind: 'unrecognized' });
  }
  switch (segments.length) {
    case 0:
      return problem({ kind: 'unrecognized' });
    case 1:
      return organization(segments[0]);
    default:
      // Deeper paths, such as `/tree/main` or `/pull/42`, are parts of the repository.
      return repository(segments[0], segments[1]);
  }
}

/**
 * Whether `input` is empty or the beginning of a form in Table 4-1 that names nothing yet, such
 * as `https://github.c` while a URL is being typed, rather than wrong (FR-SRCH-09). Some
 * beginnings, such as `github`, also name an organization; `parse` comes first.
 */
export function isUnfinished(input: string): boolean {
  const text = input.trim().toLowerCase();
  return BEGINNINGS.some((beginning) => beginning.startsWith(text));
}

/** The dashboard's path (FR-NAV-01). Names need no escaping: they are letters, digits and `._-`. */
export function dashboardPath(resource: Resource): string {
  return resource.kind === 'repository'
    ? `/${resource.owner}/${resource.repo}`
    : `/${resource.org}`;
}

/**
 * The lowercased host, if any, and the path of a URL, of the `git@host:path` that Git takes, or
 * of a bare path. `undefined` for a URL of a scheme that GitHub gives out no URLs for.
 */
function locate(text: string): { host?: string; path: string } | undefined {
  const url = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)(.*)$/i.exec(text);
  if (url) {
    const [, scheme, authority, path] = url;
    return SCHEMES.has(scheme.toLowerCase()) ? { host: host(authority), path } : undefined;
  }
  const scp = /^[^/@:]+@([^/:]+):(.*)$/.exec(text);
  if (scp) {
    return { host: host(scp[1]), path: scp[2] };
  }
  // Account names have no `.`, `:` or `@`, so a first segment with one is a host, as in
  // `github.com/owner/repo`.
  const first = text.split('/')[0];
  if (/[.:@]/.test(first)) {
    return { host: host(first), path: text.slice(first.length) };
  }
  return { path: text };
}

/** The host of an authority such as `git@GitHub.com:22`, lowercased and without `www.`. */
function host(authority: string): string {
  const host = authority
    .slice(authority.lastIndexOf('@') + 1)
    .replace(/:\d*$/, '')
    .toLowerCase();
  return host.startsWith('www.') ? host.slice('www.'.length) : host;
}

function organization(org: string): Parsed {
  return ACCOUNT.test(org)
    ? { ok: true, resource: { kind: 'organization', org } }
    : problem({ kind: 'bad-account', name: org });
}

function repository(owner: string, name: string): Parsed {
  if (!ACCOUNT.test(owner)) {
    return problem({ kind: 'bad-account', name: owner });
  }
  const repo = name.endsWith('.git') ? name.slice(0, -'.git'.length) : name;
  if (!REPOSITORY.test(repo) || repo === '.' || repo === '..') {
    return problem({ kind: 'bad-repository', name });
  }
  return { ok: true, resource: { kind: 'repository', owner, repo } };
}

function problem(problem: Problem): Parsed {
  return { ok: false, problem };
}
