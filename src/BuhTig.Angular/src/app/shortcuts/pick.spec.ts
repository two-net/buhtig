import {
  MAX_SHORTCUTS,
  Picked,
  Shortcut,
  pick,
  resourceOf,
  sameDashboard,
  shortcutOf,
} from './pick';

function repository(name: string): Shortcut {
  return { kind: 'repository', name };
}

function organization(name: string): Shortcut {
  return { kind: 'organization', name };
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

  it('tells a repository from an organization', () => {
    expect(pick([organization('acme')], [repository('acme/acme')])).toEqual([
      picked(organization('acme'), true),
      picked(repository('acme/acme'), false),
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
