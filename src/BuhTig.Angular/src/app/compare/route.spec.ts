import { UrlSegment } from '@angular/router';
import { compareMatcher, comparePath, comparedAt } from './route';

/** What the matcher takes from `path`, below `/-/compare/`: its parameters by name, or `null`. */
function match(path: string): Record<string, string> | null {
  const segments = path
    .split('/')
    .filter((part) => part !== '')
    .map((part) => new UrlSegment(part, {}));
  const result = compareMatcher(segments);
  if (result === null) {
    return null;
  }
  // A comparison is the whole path, with nothing below it for another route.
  expect(result.consumed, path).toEqual(segments);
  return Object.fromEntries(
    Object.entries(result.posParams ?? {}).map(([name, segment]) => [name, segment.path]),
  );
}

describe('compareMatcher (FR-CMP-01)', () => {
  it('matches two repositories', () => {
    expect(match('acme/widget...umbrella/gadget')).toEqual({
      kind: 'repository',
      first: 'acme/widget',
      second: 'umbrella/gadget',
    });
  });

  it('matches two accounts, organizations or users alike', () => {
    expect(match('acme...mona')).toEqual({
      kind: 'account',
      first: 'acme',
      second: 'mona',
    });
  });

  it('keeps the names as the URL spells them', () => {
    expect(match('Acme/Widget...ACME/gadget')).toEqual({
      kind: 'repository',
      first: 'Acme/Widget',
      second: 'ACME/gadget',
    });
  });

  it("takes the second owner from after the last `...`, as owners' names have no periods", () => {
    expect(match('acme/widget.js...acme/gadget')?.['first']).toBe('acme/widget.js');
    expect(match('acme/widget....acme/gadget')).toMatchObject({
      first: 'acme/widget.',
      second: 'acme/gadget',
    });
    expect(match('acme/a...b...acme/gadget')).toMatchObject({
      first: 'acme/a...b',
      second: 'acme/gadget',
    });
  });

  it('matches no other form, nor names no resource can have', () => {
    for (const path of [
      '',
      'acme',
      'acme/widget',
      'acme..umbrella',
      // A repository and an account, either way round.
      'acme/widget...umbrella',
      'acme...umbrella/gadget',
      'acme/widget...umbrella/gadget/issues',
      'acme...umbrella...initech',
      '-acme...umbrella',
      'acme/...umbrella/gadget',
      'acme/widget.../gadget',
      'acme/widget.git...umbrella/gadget',
      'acme/..',
    ]) {
      expect(match(path), path).toBeNull();
    }
  });
});

describe('comparedAt', () => {
  it('tells the two resources, as `parse` would', () => {
    expect(comparedAt(['acme', 'widget...umbrella', 'gadget'])).toEqual({
      kind: 'repository',
      first: { kind: 'repository', owner: 'acme', repo: 'widget' },
      second: { kind: 'repository', owner: 'umbrella', repo: 'gadget' },
    });
    expect(comparedAt(['acme...mona'])).toEqual({
      kind: 'account',
      first: { kind: 'account', name: 'acme' },
      second: { kind: 'account', name: 'mona' },
    });
  });
});

describe('comparePath', () => {
  it('is the URL of the comparison, which the matcher takes back', () => {
    const path = comparePath(
      { kind: 'repository', owner: 'acme', repo: 'widget.js' },
      { kind: 'repository', owner: 'umbrella', repo: 'gadget' },
    );
    expect(path).toBe('/-/compare/acme/widget.js...umbrella/gadget');
    expect(match(path.slice('/-/compare/'.length))).toEqual({
      kind: 'repository',
      first: 'acme/widget.js',
      second: 'umbrella/gadget',
    });
  });

  it('names accounts of any kind by their logins', () => {
    expect(
      comparePath({ kind: 'organization', org: 'acme' }, { kind: 'user', login: 'mona' }),
    ).toBe('/-/compare/acme...mona');
    expect(comparePath({ kind: 'account', name: 'acme' }, { kind: 'account', name: 'mona' })).toBe(
      '/-/compare/acme...mona',
    );
  });
});
