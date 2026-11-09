// What BuhTig says of the CSV files it downloads, kept apart from their logic so that it can be
// translated (NFR-UX-07).

import { exactNumber } from '../format/format';

/** FR-EXP-01, FR-EXP-02: the control that downloads a list or a chart's table. */
export const DOWNLOAD_CSV = 'Download CSV';

/**
 * FR-EXP-02: what a chart's "Download CSV" downloads, for assistive technology, such as
 * "Downloads this table's 52 rows as a CSV file, with when their data was fetched."
 */
export function tableDownload(rows: number): string {
  const counted = `${exactNumber(rows)} ${rows === 1 ? 'row' : 'rows'}`;
  return `Downloads this table's ${counted} as a CSV file, with when their data was fetched.`;
}

/** FR-EXP-01: how many of a repository list's repositories its "Download CSV" downloads. */
export function listDownloadCount(count: number): string {
  return `All ${exactNumber(count)} matching ${count === 1 ? 'repository' : 'repositories'}`;
}

/**
 * FR-EXP-01: which of them, and in what order: not only the page shown, but every repository that
 * matches, in the order shown, and, of an account with more than BuhTig reads, of the most
 * recently pushed (FR-ORG-08).
 */
export function listDownloadScope(truncated: boolean, read: number): string {
  const pages = 'from every page, in this order, as a CSV file';
  return truncated
    ? `Of the ${exactNumber(read)} most recently pushed that BuhTig reads, ${pages}`
    : `${pages.charAt(0).toUpperCase()}${pages.slice(1)}`;
}

/**
 * FR-EXP-01: what a repository list's "Download CSV" downloads, in sentences, such as "All 27
 * matching repositories. From every page, in this order, as a CSV file."
 */
export function listDownload(count: number, truncated: boolean, read: number): string {
  const scope = listDownloadScope(truncated, read);
  return `${listDownloadCount(count)}. ${scope}.`;
}

/**
 * FR-EXP-01: a repository list the browser saved, such as "Downloaded 27 repositories as
 * acme-repositories-2026-11-09.csv".
 */
export function downloadedRepositories(count: number, filename: string): string {
  const counted = `${exactNumber(count)} ${count === 1 ? 'repository' : 'repositories'}`;
  return `Downloaded ${counted} as ${filename}`;
}

/** FR-EXP-06: a file the browser took, such as "Downloaded acme-repositories-2026-11-09.csv". */
export function downloaded(filename: string): string {
  return `Downloaded ${filename}`;
}

/** FR-EXP-06, NFR-UX-06: a file the browser would not take. */
export const DOWNLOAD_FAILED =
  "Your browser didn't save the CSV file. Check that it allows downloads from this site, then try again.";
