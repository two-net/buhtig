import {
  compactNumber,
  exactNumber,
  exactTime,
  list,
  monthLabel,
  percent,
  relativeTime,
  timeUntil,
  weekDate,
} from './format';

/** `text` with plain spaces, as ICU versions differ on which spaces locales use. */
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('format', () => {
  it('shows large numbers in short, for the locale (UI-06)', () => {
    expect([0, 999, 1000, 12_345, 1_234_567].map((n) => plain(compactNumber(n, 'en-US')))).toEqual([
      '0',
      '999',
      '1K',
      '12.3K',
      '1.2M',
    ]);
    expect([12_345, 1_234_567].map((n) => plain(compactNumber(n, 'de-DE')))).toEqual([
      '12.345',
      '1,2 Mio.',
    ]);
  });

  it('shows numbers in full, for the locale (UI-06)', () => {
    expect(exactNumber(1_234_567, 'en-US')).toBe('1,234,567');
    expect(plain(exactNumber(1_234_567, 'de-DE'))).toBe('1.234.567');
  });

  it('tells how long until a time, up to days', () => {
    const now = new Date('2026-10-22T12:00:00Z').getTime();
    const MINUTE = 60_000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const until = (ms: number) => timeUntil(new Date(now + ms), now, 'en-US');
    expect(
      [-DAY, 59_000, MINUTE, 59 * MINUTE, HOUR, 23 * HOUR, DAY, 6 * DAY + 23 * HOUR, 30 * DAY].map(
        until,
      ),
    ).toEqual([
      'now',
      'now',
      'in 1 minute',
      'in 59 minutes',
      'in 1 hour',
      'in 23 hours',
      'tomorrow',
      'in 6 days',
      'in 30 days',
    ]);
  });

  describe('relativeTime', () => {
    const now = new Date('2026-10-22T12:00:00Z').getTime();
    const SECOND = 1000;
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const ago = (ms: number, locale = 'en-US') => relativeTime(new Date(now - ms), now, locale);

    it('tells times in the largest whole unit (UI-06)', () => {
      expect(
        [
          0,
          59 * SECOND,
          MINUTE,
          4 * MINUTE + 59 * SECOND,
          59 * MINUTE,
          HOUR,
          23 * HOUR,
          DAY,
          3 * DAY,
          6 * DAY,
          7 * DAY,
          29 * DAY,
          30 * DAY,
          364 * DAY,
          365 * DAY,
          3 * 365 * DAY,
        ].map((ms) => ago(ms)),
      ).toEqual([
        'now',
        'now',
        '1 minute ago',
        '4 minutes ago',
        '59 minutes ago',
        '1 hour ago',
        '23 hours ago',
        'yesterday',
        '3 days ago',
        '6 days ago',
        'last week',
        '4 weeks ago',
        'last month',
        '12 months ago',
        'last year',
        '3 years ago',
      ]);
    });

    it('tells a time later than now, from a clock that runs behind, as now', () => {
      expect(ago(-5 * MINUTE)).toBe('now');
    });

    it('tells times for the locale (UI-06)', () => {
      expect(plain(ago(3 * DAY, 'de-DE'))).toBe('vor 3 Tagen');
    });
  });

  it('shows times in full, for the locale (UI-06)', () => {
    const time = new Date('2026-10-21T12:03:00Z');
    expect(plain(exactTime(time, 'en-US', 'UTC'))).toBe('Oct 21, 2026, 12:03 PM');
    expect(plain(exactTime(time, 'de-DE', 'Europe/Berlin'))).toBe('21.10.2026, 14:03');
  });

  it("tells the day a week starts on, and its month, in GitHub's time zone", () => {
    const sunday = new Date('2025-10-26T00:00:00Z');
    expect(plain(weekDate(sunday, 'en-US'))).toBe('Oct 26, 2025');
    expect(plain(weekDate(sunday, 'de-DE'))).toBe('26.10.2025');
    expect(monthLabel(sunday, 'en-US')).toBe('Oct');
    expect(monthLabel(new Date('2025-11-01T00:00:00Z'), 'en-US')).toBe('Nov');
  });

  it('lists items as the locale does', () => {
    expect(list(['repo', 'read:org', 'gist'], 'en-US')).toBe('repo, read:org, gist');
    expect(list(['repo'], 'en-US')).toBe('repo');
  });

  it('shows shares of a whole in percent, for the locale', () => {
    expect([0.624, 0.5, 1, 0.001, 0.0004, 0].map((share) => percent(share, 'en-US'))).toEqual([
      '62.4%',
      '50%',
      '100%',
      '0.1%',
      '<0.1%',
      '0%',
    ]);
    expect(plain(percent(0.624, 'de-DE'))).toBe('62,4 %');
  });
});
