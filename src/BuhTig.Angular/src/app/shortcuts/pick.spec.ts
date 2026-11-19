import {
  ComparisonShortcut,
  DashboardShortcut,
  MAX_SHORTCUTS,
  Picked,
  Shortcut,
  comparisonOf,
  isComparison,
  pick,
  resourceOf,
  sameDashboard,
  shortcutLabel,
  shortcutOf,
  shortcutPath,
  sidesOf,
} from './pick';

function repository(name: string): DashboardShortcut {
  return { kind: 'repository', name };
}

function organization(name: string): DashboardShortcut {
  return { kind: 'organization', name };
}

function user(name: string): DashboardShortcut {
  return { kind: 'user', name };
}

/** `shortcut`, as the home page lists it, pinned or not. */
function picked(shortcut: Shortcut, pinned: boolean): Picked {
  return { ...shortcut, pinned };
}

describe('pick', () => {
  it('puts the pins first, in their order, then what was viewed recently', () => {
    expect(
      pick([repository('b/b'), organization('a')], [repository('c/c'), organization('d')]),
    ).toEqual([
      picked(repository('b/b'), true),
      picked(organization('a'), true),
      picked(repository('c/c'), false),
      picked(organization('d'), false),
    ]);
  });

  it('shows a pinned dashboard once, as a pin, whatever its letter case', () => {
    expect(
      pick([repository('Owner/Repo')], [organization('acme'), repository('owner/repo')]),
    ).toEqual([picked(repository('Owner/Repo'), true), picked(organization('acme'), false)]);
  });

  it('tells a repository from an organization, and from a user', () => {
    expect(pick([organization('acme')], [repository('acme/acme')])).toEqual([
      picked(organization('acme'), true),
      picked(repository('acme/acme'), false),
    ]);
    expect(pick([user('mona')], [repository('mona/mona'), user('octocat')])).toEqual([
      picked(user('mona'), true),
      picked(repository('mona/mona'), false),
      picked(user('octocat'), false),
    ]);
  });

  it('keeps only what tells a dashboard apart, not when it was viewed', () => {
    const viewed = { ...repository('acme/widget'), viewed_at: '2026-10-22T12:00:00Z' };
    expect(pick([], [viewed])).toEqual([picked(repository('acme/widget'), false)]);
  });

  it(`shows at most ${MAX_SHORTCUTS}, pins first (FR-SRCH-08)`, () => {
    expect(MAX_SHORTCUTS).toBe(12);
    const pins = Array.from({ length: 10 }, (_, i) => organization(`pin-${i}`));
    const recent = Array.from({ length: 20 }, (_, i) => organization(`recent-${i}`));
    expect(pick(pins, recent)).toEqual([
      ...pins.map((pin) => picked(pin, true)),
      picked(organization('recent-0'), false),
      picked(organization('recent-1'), false),
    ]);

    const many = Array.from({ length: 12 }, (_, i) => organization(`pin-${i}`));
    expect(pick(many, recent)).toEqual(many.map((pin) => picked(pin, true)));
  });

  it('shows them all without a limit, as the command palette does (FR-SRCH-12)', () => {
    const pins = Array.from({ length: 12 }, (_, i) => organization(`pin-${i}`));
    const recent = Array.from({ length: 20 }, (_, i) => organization(`recent-${i}`));
    expect(pick(pins, [...recent, organization('PIN-0')], Infinity)).toEqual([
      ...pins.map((pin) => picked(pin, true)),
      ...recent.map((viewed) => picked(viewed, false)),
    ]);
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
    expect(sameDashboard(user('Mona'), user('mona'))).toBe(true);
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
    expect(shortcutOf({ kind: 'user', login: 'mona' })).toEqual(user('mona'));
    expect(resourceOf(user('mona'))).toEqual({ kind: 'user', login: 'mona' });
  });
});

describe('comparisons (FR-CMP-05)', () => {
  const widgets: ComparisonShortcut = {
    kind: 'repository_comparison',
    name: 'acme/widget...octo/thing',
  };

  it('are named by both sides, as GitHub spells them, and lead to the comparison', () => {
    expect(
      comparisonOf(
        { kind: 'repository', owner: 'acme', repo: 'widget' },
        { kind: 'repository', owner: 'octo', repo: 'thing' },
      ),
    ).toEqual(widgets);
    expect(
      comparisonOf({ kind: 'user', login: 'mona' }, { kind: 'organization', org: 'acme' }),
    ).toEqual({ kind: 'account_comparison', name: 'mona...acme' });
    expect(isComparison(widgets)).toBe(true);
    expect(isComparison(repository('acme/widget'))).toBe(false);
    expect(shortcutPath(widgets)).toBe('/-/compare/acme/widget...octo/thing');
    expect(shortcutPath(repository('acme/widget'))).toBe('/acme/widget');
    expect(shortcutLabel(widgets)).toBe('acme/widget vs octo/thing');
    expect(shortcutLabel(organization('acme'))).toBe('acme');
  });

  it('are of two resources, of one kind (FR-CMP-02)', () => {
    expect(
      comparisonOf(
        { kind: 'repository', owner: 'acme', repo: 'widget' },
        { kind: 'repository', owner: 'Acme', repo: 'Widget' },
      ),
    ).toBeUndefined();
    expect(
      comparisonOf(
        { kind: 'repository', owner: 'acme', repo: 'widget' },
        { kind: 'organization', org: 'acme' },
      ),
    ).toBeUndefined();
  });

  it('split where the second side begins, though a repository has dots in its name', () => {
    expect(sidesOf({ kind: 'repository_comparison', name: 'acme/x......octo/y...z' })).toEqual([
      'acme/x...',
      'octo/y...z',
    ]);
    expect(sidesOf({ kind: 'account_comparison', name: 'mona...acme' })).toEqual(['mona', 'acme']);
    expect(sidesOf({ kind: 'account_comparison', name: 'mona' })).toBeUndefined();
  });

  it('are one shortcut whatever the case of their names, and apart from dashboards', () => {
    const respelled: ComparisonShortcut = { ...widgets, name: 'Acme/Widget...Octo/Thing' };
    expect(sameDashboard(widgets, respelled)).toBe(true);
    expect(sameDashboard(widgets, { ...widgets, name: 'octo/thing...acme/widget' })).toBe(false);
    const picked: Picked[] = pick([widgets], [respelled, repository('acme/widget')]);
    expect(picked).toEqual([
      { ...widgets, pinned: true },
      { ...repository('acme/widget'), pinned: false },
    ]);
  });
});
