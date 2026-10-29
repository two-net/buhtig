// What `npm run build` does after `ng build`: it compresses the UI's files for BuhTig to
// serve, and checks that the home page comes within its budget (NFR-PERF-02).
//
//   node scripts/compress.mjs [folder]
//
// Each file that compresses gets a brotli copy, `name.br`, and a gzip one, `name.gz`,
// beside it, if they come out smaller. BuhTig sends a browser the copy it accepts in place
// of the file (src/BuhTig/src/ui.rs). index.html gets none: BuhTig writes a new nonce
// into it for each response.
//
// The home page's files are index.html, what it links to, and the scripts that those
// import, together with the scripts that they import lazily: the home page loads the
// dashboard's ahead of need, so that it opens at once. Their brotli copies, or the files
// as they are if they have none, must come to no more than the budget.

import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/** NFR-PERF-02, in bytes, as Angular counts its budgets in kB of 1000 bytes. */
export const BUDGET = 300_000;

/** The files worth compressing, by their extension. Images and fonts are compressed already. */
const COMPRESSIBLE = ['.js', '.mjs', '.css', '.html', '.ico', '.svg', '.txt', '.json', '.map'];

/** The extensions of the copies, by the coding each is in. */
const COPIES = { br: '.br', gzip: '.gz' };

/** Whether `name` gets compressed copies. */
export function isCompressible(name) {
  return COMPRESSIBLE.includes(extname(name).toLowerCase()) && basename(name) !== 'index.html';
}

/** Whether `name` is a compressed copy of another file. */
function isCopy(name) {
  return Object.values(COPIES).some((extension) => name.endsWith(extension));
}

/**
 * The files that a page links to, as paths relative to it: its scripts, styles, icons and
 * preloads, but nothing on another host.
 */
export function references(html) {
  const files = [];
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/\b(src|href|rel)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(
        ([, name, ...values]) => [name.toLowerCase(), values.find((value) => value !== undefined)],
      ),
    );
    const isLink = /^<link/i.test(tag);
    const rel = (attributes.rel ?? '').toLowerCase().split(/\s+/);
    const linked = ['stylesheet', 'modulepreload', 'preload', 'icon'].some((r) => rel.includes(r));
    const url = isLink ? (linked ? attributes.href : undefined) : attributes.src;
    const file = local(url);
    if (file !== undefined) files.push(file);
  }
  return files;
}

/** The scripts that `code` imports, relative to it: `eager` at once, and `lazy` when needed. */
export function imports(code) {
  const paths = (pattern) => [...code.matchAll(pattern)].map((match) => match[1]);
  return {
    eager: paths(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+)["']/g),
    // esbuild writes these with backquotes.
    lazy: paths(/\bimport\(\s*["'`](\.{1,2}\/[^"'`$]+)["'`]\s*\)/g),
  };
}

/** The files that a style sheet's `url()`s name, relative to it. */
function urls(css) {
  return [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)]
    .map((match) => local(match[1]))
    .filter((file) => file !== undefined);
}

/** `url` as a path relative to the page, unless it is elsewhere or names no file. */
function local(url) {
  if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) return undefined;
  const path = url.split(/[?#]/)[0].replace(/^\.?\//, '');
  return path === '' ? undefined : path;
}

/** Brotli and gzip copies of `data`, at their best. */
export function compress(data, name) {
  const text = extname(name).toLowerCase() !== '.ico';
  return {
    br: brotliCompressSync(data, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_MODE]: text
          ? constants.BROTLI_MODE_TEXT
          : constants.BROTLI_MODE_GENERIC,
        [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
      },
    }),
    gzip: gzipSync(data, { level: 9 }),
  };
}

/** Every file in `folder` and below it, as paths relative to it, with `/` between folders. */
function walk(folder, under = '') {
  return readdirSync(join(folder, under), { withFileTypes: true }).flatMap((entry) => {
    const path = under ? posix.join(under, entry.name) : entry.name;
    return entry.isDirectory() ? walk(folder, path) : [path];
  });
}

/**
 * Compresses the build in `folder` and weighs its home page against `budget`. Returns what it
 * found, and prints it, unless `quiet`.
 */
export function main(folder, budget = BUDGET, { quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const read = (path) => readFileSync(join(folder, path));
  let index;
  try {
    index = read('index.html').toString();
  } catch {
    throw new Error(`${folder} has no index.html: run ng build first`);
  }

  // Copies of files that are no longer there, or no longer compressed, would be served.
  const files = walk(folder);
  for (const path of files.filter(isCopy)) {
    const original = path.slice(0, path.lastIndexOf('.'));
    if (!files.includes(original) || !isCompressible(original)) rmSync(join(folder, path));
  }

  const sizes = new Map();
  let raw = 0,
    br = 0,
    gzip = 0,
    count = 0;
  for (const path of files.filter((path) => !isCopy(path))) {
    const data = read(path);
    let size = data.length;
    if (isCompressible(path)) {
      const copies = compress(data, path);
      for (const [coding, extension] of Object.entries(COPIES)) {
        const copy = join(folder, path + extension);
        if (copies[coding].length < data.length) writeFileSync(copy, copies[coding]);
        else rmSync(copy, { force: true });
      }
      count++;
      raw += data.length;
      br += Math.min(copies.br.length, data.length);
      gzip += Math.min(copies.gzip.length, data.length);
      size = Math.min(copies.br.length, data.length);
    }
    sizes.set(path, size);
  }
  log(
    `Compressed ${count} files: ${kB(raw)} kB, ${kB(br)} kB with brotli, ${kB(gzip)} kB with gzip.`,
  );

  // The home page's files, those it loads at once and those it loads ahead of need.
  const initial = new Set(['index.html']);
  const lazy = new Set();
  const queue = references(index).map((path) => [path, initial]);
  while (queue.length > 0) {
    const [path, set] = queue.shift();
    if (initial.has(path) || set.has(path) || !sizes.has(path)) continue;
    set.add(path);
    const text = read(path).toString();
    const at = (relativePath) => posix.normalize(posix.join(posix.dirname(path), relativePath));
    if (/\.m?js$/.test(path)) {
      const { eager, lazy: later } = imports(text);
      queue.push(...eager.map((file) => [at(file), set]), ...later.map((file) => [at(file), lazy]));
    } else if (path.endsWith('.css')) {
      queue.push(...urls(text).map((file) => [at(file), set]));
    }
  }
  const weigh = (set) => [...set].reduce((total, path) => total + sizes.get(path), 0);
  const total = weigh(initial) + weigh(lazy);
  const ok = total <= budget;
  const summary =
    `Home page (NFR-PERF-02): ${kB(total)} kB of ${kB(budget)} kB with brotli, ` +
    `${kB(weigh(lazy))} kB of it loaded ahead of need.`;
  if (ok) {
    log(summary);
  } else {
    console.error(
      `Home page transfer is ${kB(total)} kB with brotli, over its ${kB(budget)} kB budget ` +
        `(NFR-PERF-02). Keep what only the dashboards need out of the home page's imports, ` +
        `or drop the dependency that grew.`,
    );
    const largest = [...initial, ...lazy].sort((a, b) => sizes.get(b) - sizes.get(a));
    for (const path of largest) {
      console.error(
        `  ${kB(sizes.get(path)).padStart(7)} kB  ${path}${lazy.has(path) ? ' (ahead of need)' : ''}`,
      );
    }
  }
  return { ok, total, initial: [...initial], lazy: [...lazy] };
}

function kB(bytes) {
  return (bytes / 1000).toFixed(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const folder = process.argv[2] ?? join(here, '..', 'dist', 'BuhTig', 'browser');
  try {
    if (!main(folder).ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
