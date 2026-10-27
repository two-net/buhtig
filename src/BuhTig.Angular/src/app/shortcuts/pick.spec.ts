import { MAX_SHORTCUTS, Shortcut, pick, resourceOf, sameDashboard, shortcutOf } from './pick';

function repository(name: string): Shortcut {
  return { kind: 'repository', name };
}

function organization(name: string): Shortcut {
  return { kind: 'organization', name };
}

describe('pick', () => {
  it('puts the pins first, in their order, then what was viewed recently', () => {
    expect(
      pick([repository('b/b'), organization('a')], [repository('c/c'), organization('d')]),
    ).toEqual([repository('b/b'), organization('a'), repository('c/c'), organization('d')]);
  });

  it('shows a pinned dashboard once, as a pin, whatever its letter case', () => {
    expect(
      pick([repository('Owner/Repo')], [organization('acme'), repository('owner/repo')]),
    ).toEqual([repository('Owner/Repo'), organization('acme')]);
  });

  it('tells a repository from an organization', () => {
    expect(pick([organization('acme')], [repository('acme/acme')])).toEqual([
      organization('acme'),
      repository('acme/acme'),
    ]);
  });

  it(`shows at most ${MAX_SHORTCUTS}, pins first (FR-SRCH-08)`, () => {
    const pins = Array.from({ length: 6 }, (_, i) => organization(`pin-${i}`));
    const recent = Array.from({ length: 20 }, (_, i) => organization(`recent-${i}`));
    const picked = pick(pins, recent);
    expect(picked).toEqual([...pins, organization('recent-0'), organization('recent-1')]);

    const many = Array.from({ length: 12 }, (_, i) => organization(`pin-${i}`));
    expect(pick(many, recent)).toEqual(many.slice(0, MAX_SHORTCUTS));
  });

  it('is empty when there is nothing to show', () => {
    expect(pick([], [])).toEqual([]);
  });
});

describe('sameDashboard', () => {
  it('tells dashboards apart by their kind and name, whatever its case', () => {
    expect(sameDashboard(repository('Owner/Repo'), repository('owner/repo'))).toBe(true);
    expect(sameDashboard(organization('acme'), organization('ACME'))).toBe(true);
    expect(sameDashboard(repository('owner/repo'), repository('owner/other'))).toBe(false);
    expect(sameDashboard(organization('acme'), repository('acme'))).toBe(false);
  });
});

describe('shortcutOf and resourceOf', () => {
  it("lead from a resource to its dashboard's shortcut, and back", () => {
    expect(shortcutOf({ kind: 'repository', owner: 'owner', repo: 're.po' })).toEqual(
      repository('owner/re.po'),
    );
    expect(shortcutOf({ kind: 'organization', org: 'acme' })).toEqual(organization('acme'));
    expect(resourceOf(repository('owner/re.po'))).toEqual({
      kind: 'repository',
      owner: 'owner',
      repo: 're.po',
    });
    expect(resourceOf(organization('acme'))).toEqual({ kind: 'organization', org: 'acme' });
  });
});
