/** How well a query matches a name, and which of the name's characters it matches. */
export interface Match {
  score: number;
  /** The indexes of the matched characters in the name, in order. */
  matches: number[];
}

/** A run of a name's characters, matched or not, to show the matched ones apart. */
export interface Segment {
  text: string;
  hit: boolean;
}

/** What separates the words of a name, such as `owner/repo-name`. */
const SEPARATORS = new Set(['/', '-', '_', '.', ' ']);

/**
 * How well `query` matches `name`, whatever their letter case, as the command palette ranks its
 * suggestions (FR-SRCH-12), or `undefined` if `name` does not have its characters in its order.
 *
 * The name itself ranks first; then the name of a repository, or an account, that starts with the
 * query, as `axum` of `tokio-rs/axum`; then a name that starts with it; then the query anywhere
 * in the name, better at the start of a word; then its characters scattered over the name,
 * better at the starts of words and next to each other. It takes no longer than the name, to
 * answer each keystroke at once (NFR-PERF-06).
 */
export function fuzzy(query: string, name: string): Match | undefined {
  const needle = query.toLowerCase();
  const text = name.toLowerCase();
  if (needle === '') {
    return { score: 0, matches: [] };
  }
  if (text === needle) {
    return { score: 1000, matches: range(0, needle.length) };
  }
  // A repository's own name, or its owner's, as `axum` or `tokio-rs` of `tokio-rs/axum`.
  const slash = text.indexOf('/');
  if (slash >= 0 && (text.slice(slash + 1) === needle || text.slice(0, slash) === needle)) {
    const at = text.slice(slash + 1) === needle ? slash + 1 : 0;
    return { score: 800, matches: range(at, at + needle.length) };
  }
  const at = substring(text, needle);
  if (at >= 0) {
    const bonus =
      text[at - 1] === '/' ? 250 : at === 0 ? 200 : SEPARATORS.has(text[at - 1]) ? 100 : 0;
    return { score: 500 + bonus, matches: range(at, at + needle.length) };
  }
  const matches = scattered(text, needle, true) ?? scattered(text, needle, false);
  if (matches === undefined) {
    return undefined;
  }
  let score = 100;
  matches.forEach((index, i) => {
    if (isWordStart(text, index)) {
      score += 10;
    }
    if (i > 0 && matches[i - 1] === index - 1) {
      score += 5;
    } else if (i > 0) {
      score -= Math.min(index - matches[i - 1] - 1, 5);
    }
  });
  return { score: Math.min(score, 499), matches };
}

/** `name` cut into runs of matched and unmatched characters, as `matches` says. */
export function segments(name: string, matches: number[]): Segment[] {
  const hits = new Set(matches);
  const result: Segment[] = [];
  for (let i = 0; i < name.length; i++) {
    const hit = hits.has(i);
    const last = result[result.length - 1];
    if (last !== undefined && last.hit === hit) {
      last.text += name[i];
    } else {
      result.push({ text: name[i], hit });
    }
  }
  return result;
}

/** Where `needle` is in `text`, at the start of a word if it is at one, or else first. */
function substring(text: string, needle: string): number {
  let first = -1;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    if (isWordStart(text, at)) {
      return at;
    }
    if (first < 0) {
      first = at;
    }
  }
  return first;
}

/**
 * Where each of `needle`'s characters is in `text`, in order: the next character if it is the
 * one, or else, if `words`, the next at the start of a word, or else the next anywhere. Taking
 * starts of words may leave too little of `text` for the rest; then the next anywhere does not.
 */
function scattered(text: string, needle: string, words: boolean): number[] | undefined {
  const matches: number[] = [];
  let from = 0;
  for (const char of needle) {
    let at = text[from] === char && from > 0 ? from : -1;
    if (at < 0 && words) {
      at = range(from, text.length).find((i) => text[i] === char && isWordStart(text, i)) ?? -1;
    }
    if (at < 0) {
      at = text.indexOf(char, from);
    }
    if (at < 0) {
      return undefined;
    }
    matches.push(at);
    from = at + 1;
  }
  return matches;
}

function isWordStart(text: string, index: number): boolean {
  return index === 0 || SEPARATORS.has(text[index - 1]);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(to - from, 0) }, (_, i) => from + i);
}
