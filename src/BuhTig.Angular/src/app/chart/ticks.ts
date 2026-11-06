import { YearCount } from '../dashboard/resources';
import { monthLabel } from '../format/format';
import { Tick } from './columns';

/**
 * The months under a chart of `weeks`, where each starts, all but each quarter's first minor,
 * as of commit activity and code frequency.
 */
export function monthTicks(weeks: readonly { start: Date }[]): Tick[] {
  return weeks.flatMap((week, index) => {
    const before = weeks[index - 1];
    const month = week.start.getUTCMonth();
    return before !== undefined && before.start.getUTCMonth() !== month
      ? [{ at: index, label: monthLabel(week.start), minor: month % 3 !== 0 }]
      : [];
  });
}

/** The labels of the years, short when there are many, every other one minor when more. */
export function yearTicks(years: readonly Pick<YearCount, 'year'>[]): Tick[] {
  const many = years.length > 6;
  return years.map(({ year }, at) => ({
    at,
    label: many ? `’${String(year).slice(-2)}` : String(year),
    minor: years.length > 8 && at % 2 === 1,
  }));
}
