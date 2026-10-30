// How BuhTig shows numbers and times: in short, with the exact value for a hover or a focus
// (UI-06). Each is formatted for the browser's locale, unless the tests give another.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * `make`, but making each format once for each locale, and time zone if it takes one: making
 * one costs far more than using it, and a figure that counts up uses one on every frame
 * (NFR-PERF-05).
 */
function once<Args extends (string | undefined)[], Format>(
  make: (...args: Args) => Format,
): (...args: Args) => Format {
  const made = new Map<string, Format>();
  return (...args) => {
    const key = args.join('\n');
    let format = made.get(key);
    if (format === undefined) {
      format = make(...args);
      made.set(key, format);
    }
    return format;
  };
}

const compactFormat = once(
  (locale?: string) =>
    new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
);
const numberFormat = once((locale?: string) => new Intl.NumberFormat(locale));
const relativeFormat = once(
  (locale?: string) => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
);
const timeFormat = once(
  (locale?: string, timeZone?: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }),
);
const dayFormat = once(
  (locale?: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
);
const weekFormat = once(
  (locale?: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }),
);
const monthFormat = once(
  (locale?: string) => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
);
const listFormat = once(
  (locale?: string) => new Intl.ListFormat(locale, { style: 'short', type: 'unit' }),
);
const percentFormat = once(
  (locale?: string) =>
    new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }),
);

/** A number in short, such as "12.3K" for 12,345. */
export function compactNumber(value: number, locale?: string): string {
  return compactFormat(locale).format(value);
}

/** A number in full, such as "12,345". */
export function exactNumber(value: number, locale?: string): string {
  return numberFormat(locale).format(value);
}

/**
 * How long before `now` a time was, in the largest whole unit, such as "4 minutes ago",
 * "yesterday" or "3 weeks ago". Under a minute, or later than `now`, as when the browser's
 * clock runs behind the server's, it is "now".
 */
export function relativeTime(time: Date, now: number, locale?: string): string {
  const format = relativeFormat(locale);
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

/**
 * How long after `now` a time is, in the largest whole unit up to days, such as "in 5 hours",
 * "tomorrow" or "in 6 days". Under a minute, or earlier than `now`, it is "now".
 */
export function timeUntil(time: Date, now: number, locale?: string): string {
  const format = relativeFormat(locale);
  const until = time.getTime() - now;
  if (until < MINUTE_MS) {
    return format.format(0, 'second');
  }
  if (until < HOUR_MS) {
    return format.format(Math.floor(until / MINUTE_MS), 'minute');
  }
  if (until < DAY_MS) {
    return format.format(Math.floor(until / HOUR_MS), 'hour');
  }
  return format.format(Math.floor(until / DAY_MS), 'day');
}

/** A time in full, such as "Oct 21, 2026, 12:03 PM", in the browser's time zone. */
export function exactTime(time: Date, locale?: string, timeZone?: string): string {
  return timeFormat(locale, timeZone).format(time);
}

/** The day of a time, such as "Oct 21, 2026", in the browser's time zone. */
export function exactDay(time: Date, locale?: string): string {
  return dayFormat(locale).format(time);
}

/**
 * The day a week starts on, such as "Oct 26, 2025". GitHub's weeks start at midnight UTC, so
 * the day is told in UTC, lest it be the day before in the browser's time zone.
 */
export function weekDate(start: Date, locale?: string): string {
  return weekFormat(locale).format(start);
}

/** The month of a day in UTC, in short, such as "Oct", as a chart's axis shows it. */
export function monthLabel(day: Date, locale?: string): string {
  return monthFormat(locale).format(day);
}

/** Items one after another, such as "repo, read:org", as the browser's language lists them. */
export function list(items: string[], locale?: string): string {
  return listFormat(locale).format(items);
}

/** A share of a whole, such as "62.4%", or "<0.1%" for a share too small to show so. */
export function percent(share: number, locale?: string): string {
  const format = percentFormat(locale);
  return share > 0 && share < 0.001 ? `<${format.format(0.001)}` : format.format(share);
}
