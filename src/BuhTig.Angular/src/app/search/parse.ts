/**
 * A GitHub resource that BuhTig has a dashboard for: a repository, an organization or a user. An
 * account named alone, as in `github.com/name`, may be an organization or a user, which only
 * GitHub can tell (FR-SRCH-06).
 */
export type Resource =
  | { kind: 'repository'; owner: string; repo: string }
  | { kind: 'organization'; org: string }
  | { kind: 'user'; login: string }
  | { kind: 'account'; name: string };

/** A resource of a kind that BuhTig knows: any but an account that GitHub has yet to tell of. */
export type Known = Exclude<Resource, { kind: 'account' }>;

/** An account of a kind that BuhTig knows, which owns repositories. */
export type Owner = Extract<Resource, { kind: 'organization' } | { kind: 'user' }>;

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

/**
 * A repository's name: up to 100 letters, digits, hyphens, underscores and periods, other than
 * `.` and `..`, which `repository` turns away. The server checks the same rule, in
 * `repositories.rs`.
 */
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * How the forms of SRS Table 4-1 begin on GitHub at `host`, up to an organization's or a user's
 * name, in lowercase.
 */
function beginnings(host: string): string[] {
  return ['orgs/', 'users/'].flatMap((below) =>
    [
      `https://${host}/`,
      `https://www.${host}/`,
      `http://${host}/`,
      `http://www.${host}/`,
      `${host}/`,
      `www.${host}/`,
      `ssh://git@${host}/`,
      `git@${host}:`,
      '',
    ].map((start) => start + below),
  );
}

/**
 * The repository, organization, user or account that `input` names, in any of the forms of SRS
 * Table 4-1 on GitHub at `host`, the lowercase `github.host`, or why it names none (FR-SRCH-01,
 * FR-SRCH-02, FR-SRCH-04, FR-SRCH-05). Table 4-1's `github.com` stands for `host`. An account
 * named alone may be an organization or a user, which GitHub tells (FR-SRCH-06).
 */
export function parse(input: string, host: string): Parsed {
  const text = input.trim().split(/[?#]/)[0];
  if (text === '') {
    return problem({ kind: 'empty' });
  }
  const location = locate(text);
  if (location === undefined) {
    return problem({ kind: 'unrecognized' });
  }
  if (location.host !== undefined && location.host !== host && location.host !== `www.${host}`) {
    return problem({ kind: 'not-github' });
  }
  const segments = location.path.split('/').filter((segment) => segment !== '');
  // GitHub's pages of an organization, and of a user, such as their projects.
  const below = segments[0]?.toLowerCase();
  if (below === 'orgs' || below === 'users') {
    return segments.length > 1
      ? account(segments[1], below === 'orgs' ? 'organization' : 'user')
      : problem({ kind: 'unrecognized' });
  }
  switch (segments.length) {
    case 0:
      return problem({ kind: 'unrecognized' });
    case 1:
      return account(segments[0], 'account');
    default:
      // Deeper paths, such as `/tree/main` or `/pull/42`, are parts of the repository.
      return repository(segments[0], segments[1]);
  }
}

/**
 * The resource that `name` names, a name from BuhTig's own URLs or data such as `owner/repo`,
 * rather than what someone typed: it names no host, so any host turns it away.
 */
export function parseName(name: string): Parsed {
  return parse(name, '');
}

/**
 * Whether `input` is empty or the beginning of a form in Table 4-1 on GitHub at `host` that
 * names nothing yet, such as `https://github.c` while a URL is being typed, rather than wrong
 * (FR-SRCH-09). Some beginnings, such as `github`, also name an organization; `parse` comes
 * first.
 */
export function isUnfinished(input: string, host: string): boolean {
  const text = input.trim().toLowerCase();
  return beginnings(host).some((beginning) => beginning.startsWith(text));
}

/** The dashboard's path (FR-NAV-01). Names need no escaping: they are letters, digits and `._-`. */
export function dashboardPath(resource: Resource): string {
  switch (resource.kind) {
    case 'repository':
      return `/${resource.owner}/${resource.repo}`;
    case 'organization':
      return `/${resource.org}`;
    case 'user':
      return `/${resource.login}`;
    case 'account':
      return `/${resource.name}`;
  }
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

/** The host of an authority such as `git@GitHub.com:22`, lowercased. */
function host(authority: string): string {
  return authority
    .slice(authority.lastIndexOf('@') + 1)
    .replace(/:\d*$/, '')
    .toLowerCase();
}

/** The account `name`, of `kind` if the form names it, or else of a kind that GitHub tells. */
function account(name: string, kind: 'organization' | 'user' | 'account'): Parsed {
  if (!ACCOUNT.test(name)) {
    return problem({ kind: 'bad-account', name });
  }
  switch (kind) {
    case 'organization':
      return { ok: true, resource: { kind, org: name } };
    case 'user':
      return { ok: true, resource: { kind, login: name } };
    case 'account':
      return { ok: true, resource: { kind, name } };
  }
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
