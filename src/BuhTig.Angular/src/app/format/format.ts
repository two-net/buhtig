// How BuhTig shows numbers and times: in short, with the exact value for a hover or a focus
// (UI-06). Each is formatted for the browser's locale, unless the tests give another.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A number in short, such as "12.3K" for 12,345. */
export function compactNumber(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

/** A number in full, such as "12,345". */
export function exactNumber(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * How long before `now` a time was, in the largest whole unit, such as "4 minutes ago",
 * "yesterday" or "3 weeks ago". Under a minute, or later than `now`, as when the browser's
 * clock runs behind the server's, it is "now".
 */
export function relativeTime(time: Date, now: number, locale?: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const ago = now - time.getTime();
  const days = Math.floor(ago / DAY_MS);
  if (ago < MINUTE_MS) {
    return format.format(0, 'second');
  }
  if (ago < HOUR_MS) {
    return format.format(-Math.floor(ago / MINUTE_MS), 'minute');
  }
  if (ago < DAY_MS) {
    return format.format(-Math.floor(ago / HOUR_MS), 'hour');
  }
  if (days < 7) {
    return format.format(-days, 'day');
  }
  if (days < 30) {
    return format.format(-Math.floor(days / 7), 'week');
  }
  if (days < 365) {
    return format.format(-Math.floor(days / 30), 'month');
  }
  return format.format(-Math.floor(days / 365), 'year');
}

/** A time in full, such as "Oct 21, 2026, 12:03 PM", in the browser's time zone. */
export function exactTime(time: Date, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(time);
}

/**
 * The day a week starts on, such as "Oct 26, 2025". GitHub's weeks start at midnight UTC, so
 * the day is told in UTC, lest it be the day before in the browser's time zone.
 */
export function weekDate(start: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(start);
}

/** The month of a day in UTC, in short, such as "Oct", as a chart's axis shows it. */
export function monthLabel(day: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(day);
}

/** A share of a whole, such as "62.4%", or "<0.1%" for a share too small to show so. */
export function percent(share: number, locale?: string): string {
  const format = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  return share > 0 && share < 0.001 ? `<${format.format(0.001)}` : format.format(share);
}
