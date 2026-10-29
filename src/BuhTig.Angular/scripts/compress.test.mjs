// Tests of compress.mjs: npm run test:scripts
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { imports, isCompressible, main, references } from './compress.mjs';

test('a page references its scripts, styles, icon and preloads, and nothing elsewhere', () => {
  const html = `<!doctype html>
    <link rel="icon" type="image/x-icon" href="favicon.ico">
    <link rel="stylesheet" href="styles-ABCDEFGH.css" nonce="BUHTIG_CSP_NONCE">
    <link rel="modulepreload" href="chunk-AAAAAAAA.js">
    <link rel="canonical" href="https://buhtig.example.com/">
    <link rel="stylesheet" href="https://fonts.example.com/font.css">
    <base href="/">
    <script src="main-ABCDEFGH.js?v=1" type="module"></script>
    <script>inline()</script>`;
  assert.deepEqual(references(html), [
    'favicon.ico',
    'styles-ABCDEFGH.css',
    'chunk-AAAAAAAA.js',
    'main-ABCDEFGH.js',
  ]);
});

test('a script imports some at once and some when they are needed', () => {
  const code =
    'import{a as b}from"./chunk-AAAAAAAA.js";import"./chunk-BBBBBBBB.js";' +
    'export{c}from"./chunk-CCCCCCCC.js";const d=()=>import("./chunk-DDDDDDDD.js").then(e=>e.D);' +
    'const e=()=>import(`./chunk-EEEEEEEE.js`);' +
    'import{f}from"@angular/core";';
  assert.deepEqual(imports(code), {
    eager: ['./chunk-AAAAAAAA.js', './chunk-BBBBBBBB.js', './chunk-CCCCCCCC.js'],
    lazy: ['./chunk-DDDDDDDD.js', './chunk-EEEEEEEE.js'],
  });
});

test('only files that are not compressed already get copies', () => {
  for (const name of ['main-ABCDEFGH.js', 'styles.css', 'favicon.ico', 'media/logo.svg']) {
    assert.ok(isCompressible(name), name);
  }
  for (const name of ['index.html', 'photo.png', 'font.woff2', 'main.js.br']) {
    assert.ok(!isCompressible(name), name);
  }
});

let folder;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'buhtig-compress-'));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** A build whose home page loads main and its chunk, and the dashboard's chunks ahead of need. */
function build() {
  const files = {
    'index.html':
      '<link rel="icon" href="favicon.ico"><link rel="stylesheet" href="styles.css">' +
      '<script src="main.js" type="module"></script>',
    'main.js':
      'import{a}from"./chunk-shared.js";const dashboard=()=>import(`./chunk-dashboard.js`);' +
      `console.log("${'home page '.repeat(200)}");`,
    'chunk-shared.js': `export const a = "${'shared '.repeat(200)}";`,
    'chunk-dashboard.js': 'import{a}from"./chunk-widgets.js";export const D = "dashboard";',
    'chunk-widgets.js': `export const a = "${'widgets '.repeat(200)}";`,
    'chunk-elsewhere.js': 'export const unused = 1;',
    'styles.css': 'body { color: #123456; } '.repeat(50),
    'favicon.ico': 'icon '.repeat(100),
    'photo.png': 'not compressible',
    // Left behind by an earlier build.
    'gone.js.br': 'stale',
    'index.html.gz': 'stale',
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(folder, name), content);
}

test('each file that compresses gets a brotli and a gzip copy of itself', () => {
  build();
  const result = main(folder, 300_000, { quiet: true });
  assert.ok(result.ok);
  for (const name of ['main.js', 'chunk-shared.js', 'styles.css', 'favicon.ico']) {
    const original = readFileSync(join(folder, name));
    assert.deepEqual(brotliDecompressSync(readFileSync(join(folder, `${name}.br`))), original);
    assert.deepEqual(gunzipSync(readFileSync(join(folder, `${name}.gz`))), original);
  }
  // Not compressible, or too small to gain, or rewritten by BuhTig for each response.
  for (const name of ['photo.png', 'chunk-elsewhere.js', 'index.html']) {
    assert.ok(!existsSync(join(folder, `${name}.br`)), name);
    assert.ok(!existsSync(join(folder, `${name}.gz`)), name);
  }
  assert.ok(!existsSync(join(folder, 'gone.js.br')));
});

test('the home page counts what it loads at once and ahead of need', () => {
  build();
  const result = main(folder, 300_000, { quiet: true });
  assert.deepEqual(result.initial.sort(), [
    'chunk-shared.js',
    'favicon.ico',
    'index.html',
    'main.js',
    'styles.css',
  ]);
  assert.deepEqual(result.lazy.sort(), ['chunk-dashboard.js', 'chunk-widgets.js']);
  const brotli = (name) => readFileSync(join(folder, `${name}.br`)).length;
  const expected =
    readFileSync(join(folder, 'index.html')).length +
    ['main.js', 'chunk-shared.js', 'styles.css', 'favicon.ico', 'chunk-widgets.js']
      .map(brotli)
      .reduce((a, b) => a + b) +
    // Smaller than any copy of it.
    readFileSync(join(folder, 'chunk-dashboard.js')).length;
  assert.equal(result.total, expected);
});

test('a home page over its budget fails', (context) => {
  build();
  context.mock.method(console, 'error', () => {});
  const result = main(folder, 100, { quiet: true });
  assert.ok(!result.ok);
  assert.match(console.error.mock.calls[0].arguments[0], /over its 0\.1 kB budget \(NFR-PERF-02\)/);
});

test('a folder without a build is an error', () => {
  assert.throws(() => main(folder, 300_000, { quiet: true }), /no index\.html: run ng build/);
});
