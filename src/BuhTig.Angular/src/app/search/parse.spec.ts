import { Parsed, Problem, Resource, dashboardPath, isUnfinished, parse } from './parse';

function repository(owner: string, repo: string): Parsed {
  return { ok: true, resource: { kind: 'repository', owner, repo } };
}

function organization(org: string): Parsed {
  return { ok: true, resource: { kind: 'organization', org } };
}

function problem(problem: Problem): Parsed {
  return { ok: false, problem };
}

/** Checks that each input parses to what `expected` says. */
function expectEach(inputs: string[], expected: Parsed): void {
  for (const input of inputs) {
    expect(parse(input), input).toEqual(expected);
  }
}

describe('parse', () => {
  // SRS Table 4-1, row by row (NFR-MNT-02).
  describe('recognizes every form in Table 4-1', () => {
    it('https://github.com/owner/repo', () => {
      expectEach(['https://github.com/owner/repo'], repository('owner', 'repo'));
    });

    it('github.com/owner/repo.git, http://www.github.com/owner/repo/', () => {
      expectEach(
        ['github.com/owner/repo.git', 'http://www.github.com/owner/repo/'],
        repository('owner', 'repo'),
      );
    });

    it('deeper paths: …/tree/main/src, …/pull/42, …/issues?q=bug', () => {
      expectEach(
        [
          'https://github.com/owner/repo/tree/main/src',
          'https://github.com/owner/repo/pull/42',
          'https://github.com/owner/repo/issues?q=bug',
        ],
        repository('owner', 'repo'),
      );
    });

    it('git@github.com:owner/repo.git, ssh://git@github.com/owner/repo.git', () => {
      expectEach(
        ['git@github.com:owner/repo.git', 'ssh://git@github.com/owner/repo.git'],
        repository('owner', 'repo'),
      );
    });

    it('owner/repo', () => {
      expectEach(['owner/repo'], repository('owner', 'repo'));
    });

    it('https://github.com/org, github.com/org, org', () => {
      expectEach(['https://github.com/org', 'github.com/org', 'org'], organization('org'));
    });

    it('https://github.com/orgs/org, …/orgs/org/repositories', () => {
      expectEach(
        ['https://github.com/orgs/org', 'https://github.com/orgs/org/repositories'],
        organization('org'),
      );
    });
  });

  // FR-SRCH-02.
  describe('ignores what does not name the resource', () => {
    it('surrounding whitespace', () => {
      expectEach(
        ['  owner/repo\n', ' https://github.com/owner/repo '],
        repository('owner', 'repo'),
      );
      expectEach(['\thttps://github.com/org  '], organization('org'));
    });

    it('the letter case of the scheme and host, but not of the names', () => {
      expectEach(
        [
          'HTTPS://GitHub.COM/Owner/Repo',
          'https://WWW.GITHUB.COM/Owner/Repo',
          'GitHub.com/Owner/Repo',
        ],
        repository('Owner', 'Repo'),
      );
    });

    it('a www. prefix and either scheme', () => {
      expectEach(
        [
          'http://github.com/owner/repo',
          'https://www.github.com/owner/repo',
          'www.github.com/owner/repo',
        ],
        repository('owner', 'repo'),
      );
    });

    it('trailing and doubled slashes', () => {
      expectEach(
        ['github.com/owner/repo//', 'github.com//owner//repo', '/owner/repo/'],
        repository('owner', 'repo'),
      );
      expectEach(['https://github.com/org/', 'org/'], organization('org'));
    });

    it('a .git suffix', () => {
      expectEach(
        ['owner/repo.git', 'https://github.com/owner/repo.git/'],
        repository('owner', 'repo'),
      );
    });

    it('query strings and fragments', () => {
      expectEach(
        [
          'https://github.com/owner/repo?tab=readme-ov-file',
          'https://github.com/owner/repo#readme',
          'owner/repo?x#y',
          'github.com/owner/repo.git#main',
        ],
        repository('owner', 'repo'),
      );
      expectEach(['https://github.com/org?tab=repositories'], organization('org'));
    });

    it('the user and port of an SSH URL', () => {
      expectEach(
        ['ssh://git@github.com:22/owner/repo.git', 'ssh://github.com/owner/repo'],
        repository('owner', 'repo'),
      );
    });
  });

  // FR-SRCH-04.
  describe('checks names', () => {
    it('accepts older names that GitHub no longer allows', () => {
      expectEach(['old--name'], organization('old--name'));
      expectEach(['trailing-'], organization('trailing-'));
      expectEach(['mona_emu/repo'], repository('mona_emu', 'repo'));
    });

    it('accepts names of the longest length', () => {
      const account = 'a'.repeat(39);
      const repo = 'r'.repeat(100);
      expectEach([`${account}/${repo}`], repository(account, repo));
    });

    it('accepts repository names with periods', () => {
      expectEach(['owner/.github'], repository('owner', '.github'));
      expectEach(['vercel/next.js'], repository('vercel', 'next.js'));
      expectEach(['owner/a..b'], repository('owner', 'a..b'));
    });

    it('rejects account names that GitHub never allowed', () => {
      for (const name of ['-org', 'a'.repeat(40), 'ac me', 'acmé', 'a+b']) {
        expect(parse(`https://github.com/${name}/repo`), name).toEqual(
          problem({ kind: 'bad-account', name }),
        );
      }
      expect(parse('https://github.com/a.b/repo')).toEqual(
        problem({ kind: 'bad-account', name: 'a.b' }),
      );
      expect(parse('-org')).toEqual(problem({ kind: 'bad-account', name: '-org' }));
      expect(parse('github.com/orgs/-org')).toEqual(problem({ kind: 'bad-account', name: '-org' }));
    });

    it('rejects repository names that GitHub never allowed', () => {
      for (const name of ['.', '..', 'r'.repeat(101), 're po', 'repo!', '.git']) {
        expect(parse(`https://github.com/owner/${name}`), name).toEqual(
          problem({ kind: 'bad-repository', name }),
        );
      }
    });
  });

  // FR-SRCH-05, AC-10.
  it('rejects hosts other than github.com', () => {
    expectEach(
      [
        'gitlab.com/owner/repo',
        'https://gitlab.com/owner/repo',
        'https://gist.github.com/owner/1234',
        'https://api.github.com/repos/owner/repo',
        'github.com.example.com/owner/repo',
        'https://github.com@example.com/owner/repo',
        'https://example.com/github.com/owner/repo',
        'git@gitlab.com:owner/repo.git',
        'ssh://git@bitbucket.org/owner/repo.git',
        'next.js',
        'localhost:8080/owner/repo',
      ],
      problem({ kind: 'not-github' }),
    );
  });

  it('says when the input is empty', () => {
    expectEach(['', '   ', '?q=bug', '#readme'], problem({ kind: 'empty' }));
  });

  it('says when github.com is named but no resource', () => {
    expectEach(
      ['github.com', 'https://github.com/', 'https://github.com/orgs', 'github.com/orgs/', 'orgs'],
      problem({ kind: 'unrecognized' }),
    );
  });

  it('says when a URL has a scheme that GitHub gives out no URLs for', () => {
    expectEach(
      ['ftp://github.com/owner/repo', 'file:///owner/repo'],
      problem({ kind: 'unrecognized' }),
    );
  });
});

// FR-SRCH-09.
describe('isUnfinished', () => {
  it('holds for the beginnings of the forms in Table 4-1, in any letter case', () => {
    for (const input of [
      '',
      '  ',
      'https:',
      'https://',
      'https://github.c',
      'HTTPS://GitHub.com/',
      'http://www.',
      'www.github.com/',
      'github.',
      'ssh://git@',
      'git@github.com:',
      'github.com/orgs',
      ' orgs/ ',
    ]) {
      expect(isUnfinished(input), input).toBe(true);
    }
  });

  it('does not hold once the input has gone wrong or names something', () => {
    for (const input of ['gitlab.com/', 'github.com/owner', 'ftp://', 'github.com/-x', 'acme/']) {
      expect(isUnfinished(input), input).toBe(false);
    }
  });
});

describe('dashboardPath', () => {
  it('mirrors the GitHub path (FR-NAV-01)', () => {
    const repo: Resource = { kind: 'repository', owner: 'vercel', repo: 'next.js' };
    const org: Resource = { kind: 'organization', org: 'angular' };
    expect(dashboardPath(repo)).toBe('/vercel/next.js');
    expect(dashboardPath(org)).toBe('/angular');
  });
});
