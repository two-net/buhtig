import { OrganizationStats, Stats } from '../dashboard/resources';
import { duration, signedCompactNumber } from '../format/format';
import { NONE, asMany, moreThan, newer, newerThan, sameDay, sameLanguage } from './messages';
import { accountCards, repositoryCards } from './stats';

const NAMES = ['acme/widget', 'umbrella/gadget'] as const;

const WIDGET: Stats = {
  stars: 12_345,
  forks: 40,
  watchers: 7,
  openIssues: 3,
  openPullRequests: 1,
  latestRelease: {
    tag: 'v2.0.0',
    publishedAt: new Date('2026-10-01T00:00:00Z'),
    url: 'https://github.com/acme/widget/releases/tag/v2.0.0',
  },
};

const GADGET: Stats = {
  stars: 8_245,
  forks: 41,
  watchers: 7,
  openIssues: 0,
  openPullRequests: 1,
  latestRelease: {
    tag: 'v0.9',
    publishedAt: new Date('2026-08-01T00:00:00Z'),
    url: undefined,
  },
};

describe('repositoryCards (FR-CMP-03)', () => {
  const cards = () => repositoryCards([WIDGET, GADGET], NAMES);

  it('has a card for each figure of a repository, in the order of its dashboard', () => {
    expect(cards().map((card) => card.label)).toEqual([
      'Stars',
      'Forks',
      'Watching',
      'Open issues',
      'Open pull requests',
      'Latest release',
    ]);
    expect(cards()[0].values).toEqual([
      { kind: 'count', value: 12_345 },
      { kind: 'count', value: 8_245 },
    ]);
  });

  it('marks the side with more, by how much in short, and says so in a sentence', () => {
    const [stars, forks] = cards();
    expect(stars.delta).toEqual({
      ahead: 0,
      shown: signedCompactNumber(4_100),
      said: moreThan('stars', 'acme/widget', 4_100, 'umbrella/gadget'),
    });
    expect(forks.delta).toEqual({
      ahead: 1,
      shown: signedCompactNumber(1),
      said: moreThan('forks', 'umbrella/gadget', 1, 'acme/widget'),
    });
    expect(stars.delta?.said).toBe('acme/widget has 4,100 more stars than umbrella/gadget.');
    expect(forks.delta?.said).toBe('umbrella/gadget has 1 more fork than acme/widget.');
  });

  it('marks figures that are the same as the same', () => {
    expect(cards()[2].delta).toEqual({
      ahead: 'same',
      said: asMany('watchers', 'acme/widget', 'umbrella/gadget'),
    });
  });

  it('marks the newer latest release by how much newer it is', () => {
    const span = duration(61 * 24 * 60 * 60);
    expect(cards()[5].values).toEqual([
      { kind: 'release', release: WIDGET.latestRelease },
      { kind: 'release', release: GADGET.latestRelease },
    ]);
    expect(cards()[5].delta).toEqual({
      ahead: 0,
      wide: true,
      shown: newer(span),
      said: newerThan('acme/widget', span, 'umbrella/gadget'),
    });
  });

  it('marks releases of the same day as the same', () => {
    const later = { ...GADGET.latestRelease!, publishedAt: new Date('2026-10-01T20:00:00Z') };
    const [, , , , , release] = repositoryCards(
      [WIDGET, { ...GADGET, latestRelease: later }],
      NAMES,
    );
    expect(release.delta).toEqual({ ahead: 'same', said: sameDay(...NAMES) });
  });

  it('says a repository has no release, and then which is newer is no question', () => {
    const [, , , , , release] = repositoryCards(
      [WIDGET, { ...GADGET, latestRelease: undefined }],
      NAMES,
    );
    expect(release.values[1]).toEqual({ kind: 'text', text: NONE });
    expect(release.delta).toBeUndefined();
  });
});

describe('accountCards (FR-CMP-03)', () => {
  const ACME: OrganizationStats = {
    repositories: 312,
    private: 0,
    internal: 0,
    stars: 900,
    forks: 40,
    openIssuesAndPullRequests: 7,
    topLanguage: 'TypeScript',
    truncated: false,
  };
  const MONA: OrganizationStats = { ...ACME, repositories: 12, stars: 1_900 };

  it("has a card for each figure of an account's, with its top language", () => {
    const cards = accountCards([ACME, MONA], ['acme', 'mona']);
    expect(cards.map((card) => card.label)).toEqual([
      'Repositories',
      'Stars',
      'Forks',
      'Open issues and pull requests',
      'Top language',
    ]);
    expect(cards[0].delta).toMatchObject({
      ahead: 0,
      said: moreThan('repositories', 'acme', 300, 'mona'),
    });
    expect(cards[1].delta).toMatchObject({ ahead: 1 });
    expect(cards[4].values).toEqual([
      { kind: 'text', text: 'TypeScript' },
      { kind: 'text', text: 'TypeScript' },
    ]);
    expect(cards[4].delta).toEqual({
      ahead: 'same',
      said: sameLanguage('acme', 'mona', 'TypeScript'),
    });
  });

  it('marks no top language as the same, unless both have one, and it is', () => {
    const cards = accountCards([ACME, { ...MONA, topLanguage: undefined }], ['acme', 'mona']);
    expect(cards[4].values[1]).toEqual({ kind: 'text', text: NONE });
    expect(cards[4].delta).toBeUndefined();
    const other = accountCards([ACME, { ...MONA, topLanguage: 'Go' }], ['acme', 'mona']);
    expect(other[4].delta).toBeUndefined();
  });
});
