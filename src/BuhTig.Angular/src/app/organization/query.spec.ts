import { convertToParamMap } from '@angular/router';
import { DEFAULT_VIEW, ListView, listParamsOf, queryOf, viewOf } from './query';

/** The view that the query string `query` gives. */
const view = (query: string) =>
  viewOf(convertToParamMap(Object.fromEntries(new URLSearchParams(query))));

describe('the repository list in its URL (FR-ORG-03)', () => {
  it('starts with every repository, pushed to last first, from the first page', () => {
    expect(view('')).toEqual(DEFAULT_VIEW);
    expect(view('tab=repositories')).toEqual(DEFAULT_VIEW);
  });

  it("reads GitHub's own parameters, as its lists have them (FR-NAV-02)", () => {
    expect(view('q=api&type=source&language=rust&sort=stargazers&page=3')).toEqual({
      filter: { name: 'api', language: 'rust', type: 'sources' },
      sort: 'stars',
      page: 2,
    });
    expect(view('type=fork').filter.type).toBe('forks');
    expect(view('type=archived').filter.type).toBe('archived');
    expect(view('type=public').filter.type).toBe('public');
    expect(view('type=private').filter.type).toBe('private');
    expect(view('sort=name').sort).toBe('name');
  });

  it("takes BuhTig's own names, other letter cases, and internal ones as private", () => {
    expect(view('type=Sources').filter.type).toBe('sources');
    expect(view('type=FORKS').filter.type).toBe('forks');
    expect(view('type=internal').filter.type).toBe('private');
    expect(view('sort=Stars').sort).toBe('stars');
    expect(view('sort=STARGAZERS').sort).toBe('stars');
  });

  it('takes what it does not know as the list starts, so that no link fails to open', () => {
    for (const query of [
      'type=mirror',
      'type=template',
      'type=',
      'type=constructor',
      'type=__proto__',
      'sort=updated',
      'sort=pushed',
      'sort=toString',
      'sort=',
      'page=',
      'page=0',
      'page=1',
      'page=-2',
      'page=1.5',
      'page=two',
      'page=2e3',
      'language=',
      'language=%20',
      'q=',
      'q=%20%20',
    ]) {
      expect(view(query), query).toEqual(DEFAULT_VIEW);
    }
  });

  it('takes the text to find without the spaces around it', () => {
    expect(view('q=%20api%20').filter.name).toBe('api');
  });

  it("writes GitHub's spellings, and leaves out what is as the list starts", () => {
    const shown: ListView = {
      filter: { name: ' api ', language: 'Jupyter Notebook', type: 'sources' },
      sort: 'stars',
      page: 1,
    };
    expect(queryOf(shown)).toEqual({
      q: 'api',
      type: 'source',
      language: 'jupyter notebook',
      sort: 'stargazers',
      page: '2',
    });
    expect(queryOf(DEFAULT_VIEW)).toEqual({
      q: null,
      type: null,
      language: null,
      sort: null,
      page: null,
    });
    expect(
      queryOf({ ...DEFAULT_VIEW, filter: { ...DEFAULT_VIEW.filter, type: 'forks' } }).type,
    ).toBe('fork');
    expect(queryOf({ ...DEFAULT_VIEW, sort: 'name' }).sort).toBe('name');
  });

  it('reads back what it writes', () => {
    for (const shown of [
      DEFAULT_VIEW,
      { filter: { name: 'api', language: 'c#', type: 'private' }, sort: 'name', page: 4 },
      { filter: { name: '', language: undefined, type: 'archived' }, sort: 'stars', page: 0 },
    ] satisfies ListView[]) {
      const query = Object.fromEntries(
        Object.entries(queryOf(shown)).filter(([, value]) => value !== null),
      );
      expect(view(new URLSearchParams(query as Record<string, string>).toString())).toEqual(shown);
    }
  });

  it("picks the list's parameters out of a URL, and none other", () => {
    expect(
      listParamsOf('/mona?tab=repositories&q=a%20b&type=source&utm=x&sort=name&page=2#top'),
    ).toEqual({ q: 'a b', type: 'source', sort: 'name', page: '2' });
    expect(listParamsOf('/orgs/acme/repositories?language=c%23')).toEqual({ language: 'c#' });
    expect(listParamsOf('/orgs/acme/repositories')).toEqual({});
    expect(listParamsOf('/acme#q=x')).toEqual({});
  });
});
