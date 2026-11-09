import { convertToParamMap } from '@angular/router';
import {
  DEFAULT_ISSUE_VIEW,
  IssueKind,
  IssueView,
  isLabel,
  issueListParamsOf,
  issueQueryOf,
  issueViewOf,
  statesOf,
} from './issue-query';

/** The view that a URL with `query` gives of the list of `kind`. */
function viewOf(query: string, kind: IssueKind = 'issue'): IssueView {
  const params = new URLSearchParams(query);
  return issueViewOf(convertToParamMap(Object.fromEntries(params)), kind);
}

/** `view`, but for what `change` says. */
function view(change: Partial<IssueView>): IssueView {
  return { ...DEFAULT_ISSUE_VIEW, ...change };
}

describe('issueViewOf', () => {
  it('starts with the open ones, updated last first, as GitHub does', () => {
    expect(viewOf('')).toEqual(DEFAULT_ISSUE_VIEW);
    expect(viewOf('q=%20')).toEqual(DEFAULT_ISSUE_VIEW);
    expect(viewOf('page=3')).toEqual(view({ page: 2 }));
  });

  it("reads the state, a label and the order of GitHub's own links", () => {
    expect(viewOf('q=is:issue is:closed label:bug sort:created-asc&page=2')).toEqual({
      state: 'closed',
      label: 'bug',
      sort: 'oldest',
      page: 1,
    });
    expect(viewOf('q=is:issue state:open label:"good first issue" sort:updated-desc')).toEqual(
      view({ label: 'good first issue' }),
    );
    // In any letter case, of the qualifiers and their values, but not of the label's name.
    expect(viewOf('q=IS:Issue Is:CLOSED Label:Docs SORT:Created-Asc')).toEqual(
      view({ state: 'closed', label: 'Docs', sort: 'oldest' }),
    );
    expect(viewOf('q=type:issue sort:updated')).toEqual(view({ state: 'all' }));
    expect(viewOf('q=label:area:api')).toEqual(view({ state: 'all', label: 'area:api' }));
  });

  it('shows them all when the query says no state, as GitHub does', () => {
    expect(viewOf('q=is:issue')).toEqual(view({ state: 'all' }));
    expect(viewOf('q=is:pr', 'pull_request')).toEqual(view({ state: 'all' }));
  });

  it('tells merged pull requests from those closed without merging', () => {
    const pulls = (q: string) => viewOf(`q=${q}`, 'pull_request').state;
    expect(pulls('is:pr is:open')).toBe('open');
    expect(pulls('is:pr is:open is:unmerged')).toBe('open');
    expect(pulls('is:pr is:merged')).toBe('merged');
    expect(pulls('is:pr is:closed is:merged')).toBe('merged');
    expect(pulls('is:pr is:closed is:unmerged')).toBe('closed');
    expect(pulls('is:pr state:closed is:unmerged')).toBe('closed');
  });

  it('shows as it starts each part that it cannot show as GitHub would', () => {
    // On GitHub, pull requests closed whether merged or not, and those unmerged whether open or not.
    expect(viewOf('q=is:pr is:closed label:bug', 'pull_request')).toEqual(view({ label: 'bug' }));
    expect(viewOf('q=is:pr is:unmerged', 'pull_request')).toEqual(DEFAULT_ISSUE_VIEW);
    // Issues are never merged.
    expect(viewOf('q=is:issue is:merged sort:created-asc')).toEqual(view({ sort: 'oldest' }));
    expect(viewOf('q=is:issue is:open is:closed')).toEqual(DEFAULT_ISSUE_VIEW);
    // More than one label, or one that no label can be.
    expect(viewOf('q=is:issue label:bug label:docs')).toEqual(view({ state: 'all' }));
    expect(viewOf(`q=label:${'l'.repeat(51)}`).label).toBeUndefined();
    expect(viewOf('q=label:""').label).toBeUndefined();
    // An order that it does not show.
    expect(viewOf('q=is:issue is:closed sort:comments-desc').sort).toBe('updated');
    expect(viewOf('q=is:issue sort:created-desc').sort).toBe('updated');
  });

  it('leaves out what it does not read, such as authors and words to find', () => {
    expect(viewOf('q=is:issue is:open author:alice widgets "steady them" no:assignee')).toEqual(
      DEFAULT_ISSUE_VIEW,
    );
  });

  it('starts as it does for a query of the other kind', () => {
    expect(viewOf('q=is:pr is:merged&page=2')).toEqual(view({ page: 1 }));
    expect(viewOf('q=is:issue is:closed', 'pull_request')).toEqual(DEFAULT_ISSUE_VIEW);
    expect(viewOf('q=is:issue is:pr is:closed')).toEqual(DEFAULT_ISSUE_VIEW);
  });

  it('starts at the first page unless the page is a whole number', () => {
    for (const page of ['0', '1', 'two', '-2', '1.5', '']) {
      expect(viewOf(`page=${page}`).page).toBe(0);
    }
    expect(viewOf('page=40').page).toBe(39);
  });
});

describe('issueQueryOf', () => {
  it('leaves out what is as the list starts', () => {
    expect(issueQueryOf(DEFAULT_ISSUE_VIEW, 'issue')).toEqual({ q: null, page: null });
    expect(issueQueryOf(view({ page: 2 }), 'pull_request')).toEqual({ q: null, page: '3' });
  });

  it("spells the rest in GitHub's syntax, with its order, so that GitHub shows the same", () => {
    expect(issueQueryOf(view({ state: 'all' }), 'issue').q).toBe('is:issue sort:updated-desc');
    expect(issueQueryOf(view({ state: 'closed', sort: 'oldest' }), 'issue').q).toBe(
      'is:issue is:closed sort:created-asc',
    );
    expect(issueQueryOf(view({ state: 'closed' }), 'pull_request').q).toBe(
      'is:pr is:closed is:unmerged sort:updated-desc',
    );
    expect(issueQueryOf(view({ state: 'merged', label: 'bug' }), 'pull_request').q).toBe(
      'is:pr is:merged label:bug sort:updated-desc',
    );
    expect(issueQueryOf(view({ label: 'good first issue' }), 'issue').q).toBe(
      'is:issue is:open label:"good first issue" sort:updated-desc',
    );
    expect(issueQueryOf(view({ label: 'area:api' }), 'issue').q).toBe(
      'is:issue is:open label:"area:api" sort:updated-desc',
    );
  });

  it('gives back the view that it spells', () => {
    for (const kind of ['issue', 'pull_request'] as const) {
      for (const state of statesOf(kind)) {
        for (const label of [undefined, 'bug', 'good first issue', 'área/ç']) {
          for (const sort of ['updated', 'oldest'] as const) {
            const shown = { state, label, sort, page: 4 };
            const { q, page } = issueQueryOf(shown, kind);
            const query = new URLSearchParams({ ...(q ? { q } : {}), ...(page ? { page } : {}) });
            expect(viewOf(query.toString(), kind)).toEqual(shown);
          }
        }
      }
    }
  });
});

describe('statesOf', () => {
  it('offers merged pull requests, and no merged issues', () => {
    expect(statesOf('issue')).toEqual(['open', 'closed', 'all']);
    expect(statesOf('pull_request')).toEqual(['open', 'merged', 'closed', 'all']);
  });
});

describe('isLabel', () => {
  it('takes what the search for issues can take, quoted, as the server does', () => {
    expect(isLabel('bug')).toBe(true);
    expect(isLabel('é'.repeat(50))).toBe(true);
    expect(isLabel('😀'.repeat(50))).toBe(true);
    expect(isLabel(undefined)).toBe(false);
    expect(isLabel('')).toBe(false);
    expect(isLabel('l'.repeat(51))).toBe(false);
    expect(isLabel('say "hi"')).toBe(false);
    expect(isLabel('line\nbreak')).toBe(false);
    expect(isLabel('bell\u0085')).toBe(false);
  });
});

describe('issueListParamsOf', () => {
  it("keeps the list's parameters of a URL, and none other", () => {
    expect(
      issueListParamsOf('/acme/widget/issues?q=is%3Aissue+label%3Abug&utm_source=chat&page=2#x'),
    ).toEqual({ q: 'is:issue label:bug', page: '2' });
    expect(issueListParamsOf('/acme/widget/issues')).toEqual({});
  });
});
