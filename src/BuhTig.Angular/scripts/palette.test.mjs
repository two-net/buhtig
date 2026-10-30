// Tests of BuhTig's palette, in src/styles.css, against WCAG 2.2 AA (NFR-UX-02): npm run test:scripts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** What is between the braces after the first `start` in `css`, with the blocks within. */
function block(css, start) {
  const open = css.indexOf('{', css.indexOf(start));
  let depth = 0;
  for (let at = open; at < css.length; at++) {
    if (css[at] === '{') depth++;
    if (css[at] === '}' && --depth === 0) return css.slice(open + 1, at);
  }
  throw new Error(`No block after ${start}`);
}

/** The custom properties that `css` sets to a color as `#rrggbb`, by name. */
function colors(css) {
  return Object.fromEntries(
    [...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(([, name, hex]) => [
      name,
      hex.toLowerCase(),
    ]),
  );
}

/** The relative luminance of `hex` (WCAG 2.2). */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two colors (WCAG 2.2), from 1 to 21. */
function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

const styles = read('src/styles.css');
const dark = '(prefers-color-scheme: dark)';
const light = colors(block(styles, ':root'));
const themes = { light, dark: { ...light, ...colors(block(styles, dark)) } };

for (const [theme, color] of Object.entries(themes)) {
  /** Asserts that `foreground` is at least `minimum`:1 against each of `backgrounds`. */
  const atLeast = (minimum, foreground, ...backgrounds) => {
    for (const background of backgrounds) {
      assert.ok(color[foreground] && color[background], `${foreground} or ${background} is unset`);
      const ratio = contrast(color[foreground], color[background]);
      assert.ok(
        ratio >= minimum,
        `In the ${theme} theme, ${foreground} on ${background} is ${ratio.toFixed(2)}:1, ` +
          `under ${minimum}:1`,
      );
    }
  };

  test(`${theme}: text is at least 4.5:1 against what it sits on`, () => {
    const texts = [
      'fg',
      'fg-muted',
      'fg-accent',
      'fg-success',
      'fg-danger',
      'fg-attention',
      'fg-done',
    ];
    for (const text of texts) atLeast(4.5, text, 'bg', 'bg-muted', 'bg-inset');
    atLeast(4.5, 'on-primary', 'btn-primary');
  });

  test(`${theme}: lines that mark controls are at least 3:1 against what they sit on`, () => {
    atLeast(3, 'control-line', 'bg', 'bg-muted', 'bg-inset');
  });

  test(`${theme}: the colors of charts are at least 3:1 against the background`, () => {
    const names = Object.keys(color).filter((name) => /^(s\d|s-other|st-)/.test(name));
    // Eight series and "Other", and the states of issues and pull requests.
    assert.equal(names.length, 12);
    for (const name of names) atLeast(3, name, 'bg');
  });
}

test("the favicon is a B in the background's color on the accent's circle, in each theme", () => {
  const icon = read('public/favicon.svg');
  const inDark = block(icon, dark);
  assert.deepEqual(
    {
      light: [/<circle[^>]*\bfill="(#\w+)"/, /<path[^>]*\bstroke="(#\w+)"/].map(
        (pattern) => icon.match(pattern)[1],
      ),
      dark: [/circle\s*\{\s*fill:\s*(#\w+)/, /path\s*\{\s*stroke:\s*(#\w+)/].map(
        (pattern) => inDark.match(pattern)[1],
      ),
    },
    {
      light: [themes.light['fg-accent'], themes.light.bg],
      dark: [themes.dark['fg-accent'], themes.dark.bg],
    },
  );
});
