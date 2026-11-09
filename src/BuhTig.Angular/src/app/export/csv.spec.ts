import { field, isoDay, toCsv } from './csv';

describe('CSV files (FR-EXP-03, FR-EXP-05)', () => {
  it('start with a byte order mark and a header, and end each line with CRLF (RFC 4180)', () => {
    const text = toCsv({
      columns: ['name', 'stars'],
      rows: [
        ['widget', 12],
        ['gadget', 3],
      ],
    });
    expect(text).toBe('\uFEFFname,stars\r\nwidget,12\r\ngadget,3\r\n');
  });

  it('have a header alone when there are no rows', () => {
    expect(toCsv({ columns: ['week_start', 'commits'], rows: [] })).toBe(
      '\uFEFFweek_start,commits\r\n',
    );
  });

  it('keep numbers exact, without grouping, and in no language of their own', () => {
    expect([1234567, 0, -3, 0.1 + 0.2, 1e21].map(field)).toEqual([
      '1234567',
      '0',
      // A figure that went down stays a number: it is not text that could be a formula.
      '-3',
      '0.30000000000000004',
      '1e+21',
    ]);
    expect([NaN, Infinity].map(field)).toEqual(['', '']);
  });

  it('give times in UTC to the millisecond, and days as dates alone (ISO 8601)', () => {
    const time = new Date(Date.UTC(2026, 10, 9, 10, 0, 0, 123));
    expect(field(time)).toBe('2026-11-09T10:00:00.123Z');
    expect(isoDay(new Date(Date.UTC(2025, 9, 26)))).toBe('2025-10-26');
    expect(field(new Date(NaN))).toBe('');
    expect(isoDay(new Date(NaN))).toBeUndefined();
  });

  it('say yes or no as true or false, and leave what is not known empty, never 0', () => {
    expect([true, false, undefined].map(field)).toEqual(['true', 'false', '']);
    expect(toCsv({ columns: ['a', 'b', 'c'], rows: [[undefined, '', undefined]] })).toBe(
      '\uFEFFa,b,c\r\n,,\r\n',
    );
  });

  it('quote text with commas, quotes or line breaks, and double its quotes', () => {
    expect(field('Widgets, for everyone')).toBe('"Widgets, for everyone"');
    expect(field('The "best" widgets')).toBe('"The ""best"" widgets"');
    expect(field('First line\nsecond line')).toBe('"First line\nsecond line"');
    expect(field('First line\r\nsecond line')).toBe('"First line\r\nsecond line"');
    // Spaces at either end, which some spreadsheets would drop otherwise.
    expect(field(' padded ')).toBe('" padded "');
    expect(field('plain')).toBe('plain');
  });

  it('keep any Unicode as it is', () => {
    for (const text of ['ウィジェット', 'widgets 🚀', 'café', 'Zoë', 'עברית', 'e\u0301']) {
      expect(field(text)).toBe(text);
    }
  });

  it('keep text that a spreadsheet would take for a formula as text, never to be run', () => {
    expect(field('=HYPERLINK("https://evil.example","Click")')).toBe(
      `"'=HYPERLINK(""https://evil.example"",""Click"")"`,
    );
    expect(field('+1+2')).toBe("'+1+2");
    expect(field('-2+3')).toBe("'-2+3");
    expect(field('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(field('\t=1+1')).toBe("'\t=1+1");
    expect(field('\r=1+1')).toBe(`"'\r=1+1"`);
    expect(field('\n=1+1')).toBe(`"'\n=1+1"`);
    // Only at the start, where a spreadsheet looks.
    expect(field('a=1')).toBe('a=1');
    expect(field('1-2')).toBe('1-2');
  });
});
