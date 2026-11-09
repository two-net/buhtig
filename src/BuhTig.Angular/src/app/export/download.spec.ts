import { CsvExport } from './csv';
import { CSV_TYPE, saveCsv } from './download';
import {
  accountCells,
  branchCells,
  coverageCells,
  csvFilename,
  exportName,
  freshnessCells,
  withSource,
} from './provenance';

const CSV: CsvExport = {
  name: 'acme-widget-commit-activity',
  columns: ['week_start', 'commits'],
  rows: [['2026-11-01', 3]],
};

const NOW = new Date(Date.UTC(2026, 10, 9, 23, 30));

describe('saveCsv (FR-EXP-06)', () => {
  const { createObjectURL, revokeObjectURL } = URL;
  let blobs: Blob[];
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    vi.useFakeTimers();
    blobs = [];
    clicked = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:https://buhtig.example/1';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('saves the file, named for what it is of and the UTC day, with the page it is from', async () => {
    const source = 'https://buhtig.example/acme/widget/activity';
    expect(saveCsv(document, CSV, source, NOW)).toBe('acme-widget-commit-activity-2026-11-09.csv');
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('acme-widget-commit-activity-2026-11-09.csv');
    expect(clicked[0].href).toBe('blob:https://buhtig.example/1');
    // The link is gone at once, and so is the file's URL, once the download has begun.
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:https://buhtig.example/1');

    expect(blobs[0].type).toBe(CSV_TYPE);
    // In UTF-8, with its byte order mark, which decoding it as text leaves out.
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(await blobs[0].text()).toBe(
      'week_start,commits,source_url\r\n' +
        '2026-11-01,3,https://buhtig.example/acme/widget/activity\r\n',
    );
  });

  it('says so when the browser will not save it', () => {
    URL.createObjectURL = vi.fn(() => {
      throw new Error('no downloads');
    });
    expect(saveCsv(document, CSV, 'https://buhtig.example/', NOW)).toBeUndefined();
    expect(clicked).toEqual([]);
  });
});

describe('what a CSV file says of where its data came from (FR-EXP-04)', () => {
  it('names files after what they are of, as every system takes a name', () => {
    expect(exportName('acme/widget', 'commit-activity')).toBe('acme-widget-commit-activity');
    expect(exportName('acme', 'vs', 'umbrella', 'languages')).toBe('acme-vs-umbrella-languages');
    // No name is hidden, as one starting with a dot is, and nothing but its own characters.
    expect(exportName('.github', 'repositories')).toBe('github-repositories');
    expect(exportName('a b/c:d', 'x')).toBe('a-b-c-d-x');
    expect(csvFilename({ name: 'acme-repositories' }, NOW)).toBe(
      'acme-repositories-2026-11-09.csv',
    );
  });

  it('adds the page it is downloaded from to each row', () => {
    expect(withSource(CSV, 'https://buhtig.example/acme/widget')).toEqual({
      name: CSV.name,
      columns: ['week_start', 'commits', 'source_url'],
      rows: [['2026-11-01', 3, 'https://buhtig.example/acme/widget']],
    });
  });

  it('says when data was fetched, and why saved data is no newer', () => {
    const fetchedAt = new Date('2026-11-09T10:00:00.000Z');
    expect(freshnessCells({ fetchedAt, stale: undefined })).toEqual([fetchedAt, undefined]);
    expect(freshnessCells({ fetchedAt, stale: 'held' })).toEqual([fetchedAt, 'held']);
    expect(freshnessCells({})).toEqual([undefined, undefined]);
    expect(branchCells('acme/widget', 'main', { fetchedAt, stale: 'github' })).toEqual([
      'acme/widget',
      'main',
      fetchedAt,
      'github',
    ]);
  });

  it('says what a figure of an account covers, past the repositories BuhTig reads (FR-ORG-08)', () => {
    expect(coverageCells({ truncated: false, repositoriesRead: 312 })).toEqual(['all', 312]);
    expect(coverageCells({ truncated: true, repositoriesRead: 1000 })).toEqual([
      'most_recently_pushed',
      1000,
    ]);
    // What it does not know, it leaves empty.
    expect(coverageCells({})).toEqual([undefined, undefined]);
    expect(accountCells('acme', { truncated: true, repositoriesRead: 1000 })).toEqual([
      'acme',
      'most_recently_pushed',
      1000,
      undefined,
      undefined,
    ]);
  });
});
