import { Command, Tab, commandPath, parseCommand, tabLabel, tabsNamed, tabsOf } from './command';
import { problemMessage } from './messages';
import { Resource } from './parse';

const REPO: Resource = { kind: 'repository', owner: 'owner', repo: 'repo' };
const ORG: Resource = { kind: 'organization', org: 'org' };
const USER: Resource = { kind: 'user', login: 'mona' };
const ACCOUNT: Resource = { kind: 'account', name: 'name' };

function opens(resource: Resource, tab?: Tab): Command {
  return tab === undefined ? { ok: true, resource } : { ok: true, resource, tab };
}

/** Checks that each input names `resource`'s dashboard at `tab`, and opens `path`. */
function expectEach(inputs: string[], resource: Resource, tab: Tab | undefined, path: string) {
  for (const input of inputs) {
    const command = parseCommand(input);
    expect(command, input).toEqual(opens(resource, tab));
    if (command.ok) {
      expect(commandPath(command.resource, command.tab), input).toBe(path);
    }
  }
}

describe('parseCommand (FR-SRCH-13)', () => {
  it('takes a resource alone, as parse does', () => {
    expectEach(
      ['owner/repo', ' https://github.com/owner/repo/tree/main '],
      REPO,
      undefined,
      '/owner/repo',
    );
    expectEach(['github.com/orgs/org'], ORG, undefined, '/org');
    expectEach(['github.com/users/mona'], USER, undefined, '/mona');
    expectEach(['name'], ACCOUNT, undefined, '/name');
    expect(parseCommand('')).toEqual({ ok: false, problem: { kind: 'empty' } });
    expect(parseCommand('gitlab.com/owner/repo')).toEqual({
      ok: false,
      problem: { kind: 'not-github' },
    });
  });

  // SRS Table 4-1's rows of a resource and a tab (NFR-MNT-02).
  describe("opens each of a repository's tabs, by its name or another", () => {
    const cases: [string[], Tab, string][] = [
      [['overview'], 'overview', '/owner/repo'],
      [['activity', 'commits'], 'activity', '/owner/repo/activity'],
      [['issues'], 'issues', '/owner/repo/issues'],
      [['pulls', 'prs', 'pull requests', 'Pull  Requests'], 'pulls', '/owner/repo/pulls'],
      [['contributors'], 'contributors', '/owner/repo/graphs/contributors'],
      [['releases', 'tags', 'RELEASES'], 'releases', '/owner/repo/releases'],
    ];
    for (const [words, tab, path] of cases) {
      it(`${tab}: owner/repo ${words[0]}`, () => {
        expectEach(
          words.flatMap((word) => [`owner/repo ${word}`, `https://github.com/owner/repo ${word}`]),
          REPO,
          tab,
          path,
        );
      });
    }
  });

  it("opens an organization's tabs", () => {
    expectEach(
      ['github.com/orgs/org people', 'orgs/org members'],
      ORG,
      'people',
      '/orgs/org/people',
    );
    expectEach(
      ['orgs/org repositories', 'orgs/org repos'],
      ORG,
      'repositories',
      '/orgs/org/repositories',
    );
    expectEach(['orgs/org overview'], ORG, 'overview', '/org');
  });

  it("opens a user's tabs, at the query that GitHub has them at", () => {
    expectEach(
      ['users/mona repositories', 'users/mona repos'],
      USER,
      'repositories',
      '/mona?tab=repositories',
    );
    expectEach(['users/mona overview'], USER, 'overview', '/mona');
  });

  it("opens an account named alone at an organization's People, or a user's Repositories", () => {
    expectEach(['name people'], ACCOUNT, 'people', '/orgs/name/people');
    expectEach(['name repos'], ACCOUNT, 'repositories', '/name?tab=repositories');
    expectEach(['name overview'], ACCOUNT, 'overview', '/name');
  });

  it('takes the beginning of a name that is one tab alone', () => {
    expectEach(
      ['owner/repo pu', 'owner/repo p', 'owner/repo pull'],
      REPO,
      'pulls',
      '/owner/repo/pulls',
    );
    expectEach(['owner/repo i'], REPO, 'issues', '/owner/repo/issues');
    expectEach(['owner/repo con'], REPO, 'contributors', '/owner/repo/graphs/contributors');
    expectEach(['name pe'], ACCOUNT, 'people', '/orgs/name/people');
    expectEach(['name re'], ACCOUNT, 'repositories', '/name?tab=repositories');
  });

  it('says which tabs the beginning of a name may be, when it is more than one', () => {
    expect(parseCommand('owner/repo co')).toEqual({
      ok: false,
      problem: { kind: 'bad-tab', word: 'co', resource: REPO, could: ['activity', 'contributors'] },
    });
  });

  it("says what is no tab of the resource's dashboard, and which are (NFR-UX-06)", () => {
    const message = (input: string) => {
      const command = parseCommand(input);
      return command.ok ? undefined : problemMessage(command.problem);
    };
    expect(message('owner/repo people')).toBe(
      "“people” is not a tab of a repository's dashboard. Its tabs are overview, activity, issues, pulls, contributors and releases.",
    );
    expect(message('users/mona people')).toBe(
      "“people” is not a tab of a user's dashboard. Its tabs are overview and repositories.",
    );
    expect(message('orgs/org pulls')).toBe(
      "“pulls” is not a tab of an organization's dashboard. Its tabs are overview, repositories and people.",
    );
    expect(message('name stars')).toBe(
      "“stars” is not a tab of an organization's or a user's dashboard. Its tabs are overview, repositories and people.",
    );
    expect(message('owner/repo co')).toBe(
      "“co” could be activity or contributors. Type more of the tab's name.",
    );
  });

  it('says what is wrong with the resource before its tab', () => {
    expect(parseCommand('gitlab.com/owner/repo pulls')).toEqual({
      ok: false,
      problem: { kind: 'not-github' },
    });
  });
});

describe('tabsOf, tabsNamed and tabLabel', () => {
  it("list each kind's tabs in the order of its tab bar", () => {
    expect(tabsOf('repository')).toEqual([
      'overview',
      'activity',
      'issues',
      'pulls',
      'contributors',
      'releases',
    ]);
    expect(tabsOf('organization')).toEqual(['overview', 'repositories', 'people']);
    expect(tabsOf('account')).toEqual(['overview', 'repositories', 'people']);
    expect(tabsOf('user')).toEqual(['overview', 'repositories']);
  });

  it('name every tab for nothing typed, and none for what begins no name', () => {
    expect(tabsNamed('user', '')).toEqual(['overview', 'repositories']);
    expect(tabsNamed('repository', 'x')).toEqual([]);
  });

  it('label tabs as the tab bar does', () => {
    expect(tabLabel('repository', 'pulls')).toBe('Pull requests');
    expect(tabLabel('account', 'people')).toBe('People');
    expect(tabLabel('user', 'repositories')).toBe('Repositories');
  });
});
