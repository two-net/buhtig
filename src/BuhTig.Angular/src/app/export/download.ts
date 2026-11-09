import { CsvExport, toCsv } from './csv';
import { csvFilename, withSource } from './provenance';

/** The media type of a CSV file, in UTF-8, with a header (RFC 4180). */
export const CSV_TYPE = 'text/csv;charset=utf-8;header=present';

/**
 * Saves `csv` in the browser's downloads, with `source`, the page it is downloaded from, in each
 * row, under a name of what it is of and the day, `now`. The file is made in the browser, of what
 * the page has already loaded, so that nothing is asked of BuhTig or GitHub for it (FR-EXP-06).
 * The file's name, if the browser took it.
 */
export function saveCsv(
  document: Document,
  csv: CsvExport,
  source: string,
  now = new Date(),
): string | undefined {
  const window = document.defaultView;
  if (!window?.URL?.createObjectURL) {
    return undefined;
  }
  const filename = csvFilename(csv, now);
  try {
    const blob = new Blob([toCsv(withSource(csv, source))], { type: CSV_TYPE });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    // Once the browser has begun the download, which starts as the link is clicked.
    window.setTimeout(() => window.URL.revokeObjectURL(url));
    return filename;
  } catch {
    return undefined;
  }
}
