// CSV files of what a page shows, for spreadsheets and reports (FR-EXP-03, FR-EXP-05).

/**
 * One cell of a CSV file: text, an exact number, a yes or no, or a time. `undefined` is a cell
 * that BuhTig does not know, which stays empty, never 0.
 */
export type Cell = string | number | boolean | Date | undefined;

/**
 * A CSV file to download: what it is of, the names of its columns, and its rows, in order. The
 * day it is downloaded on, and the page it is downloaded from, are added as it is (FR-EXP-04).
 */
export interface CsvExport {
  /** The start of its file's name, such as `acme-widget-commit-activity` (FR-EXP-06). */
  name: string;
  /** Stable, in `snake_case`, the same whatever the resource or the browser's language. */
  columns: readonly string[];
  /** Each as many cells as there are columns. */
  rows: readonly (readonly Cell[])[];
}

/**
 * The first characters with which a spreadsheet takes text for a formula, or for the start of
 * one, as OWASP lists them: text from GitHub, such as a description, is untrusted (NFR-SEC-03).
 */
const FORMULA_STARTS = new Set(['=', '+', '-', '@', '\t', '\r', '\n']);

/** The byte order mark, by which spreadsheets such as Excel tell that a CSV file is UTF-8. */
const BOM = '\uFEFF';

/** What ends each line, as RFC 4180 has it. */
const CRLF = '\r\n';

/**
 * `csv` as the text of a CSV file (RFC 4180): a byte order mark, a header of the names of the
 * columns, then each row, each line ended by CRLF.
 */
export function toCsv(csv: Pick<CsvExport, 'columns' | 'rows'>): string {
  const lines = [csv.columns, ...csv.rows].map((cells) => cells.map(field).join(','));
  return BOM + lines.map((line) => line + CRLF).join('');
}

/**
 * `cell` as a field of a CSV file:
 * - a number in full, with a point and no grouping, such as `12345.5` or `-3`, so that any
 *   spreadsheet reads it as the same number, whatever its language;
 * - a time in UTC, to the millisecond, as `2026-11-09T10:00:00.000Z` (ISO 8601);
 * - `true` or `false`;
 * - empty for what BuhTig does not know;
 * - and text as it is, but that text that a spreadsheet would take for a formula starts with `'`,
 *   so that it shows as text and is never run.
 *
 * Fields with a comma, a quote or a line break, or with spaces at either end, are quoted, and
 * the quotes in them doubled.
 */
export function field(cell: Cell): string {
  if (cell === undefined) {
    return '';
  }
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? String(cell) : '';
  }
  if (typeof cell === 'boolean') {
    return String(cell);
  }
  if (cell instanceof Date) {
    return isNaN(cell.getTime()) ? '' : cell.toISOString();
  }
  return quoted(FORMULA_STARTS.has(cell.charAt(0)) ? `'${cell}` : cell);
}

/** `text`, quoted if a CSV file needs it to be read back as it is. */
function quoted(text: string): string {
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The UTC day of `time`, as `2026-11-09`, such as the Sunday a week of GitHub's starts on. */
export function isoDay(time: Date): string | undefined {
  return isNaN(time.getTime()) ? undefined : time.toISOString().slice(0, 10);
}
