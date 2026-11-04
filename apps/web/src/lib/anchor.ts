/**
 * Text-quote anchoring for highlights (W3C Web Annotation "TextQuoteSelector").
 *
 * A highlight is stored as the quoted text plus a little context on each side,
 * never as a DOM path. On load we re-find the quote in the article's plain text
 * (the `textContent` of `.prose`) and pick the occurrence whose surroundings best
 * match the stored context. Pure string functions: no DOM, fully unit-tested.
 */

/** How much context to keep on each side of a quote. */
export const CONTEXT_CHARS = 32;

export interface TextQuote {
  quote: string;
  /** Up to CONTEXT_CHARS characters immediately before the quote. */
  prefix: string;
  /** Up to CONTEXT_CHARS characters immediately after the quote. */
  suffix: string;
}

/** A half-open [start, end) span of character offsets into a text. */
export interface TextSpan {
  start: number;
  end: number;
}

const WHITESPACE = /\s/;

/**
 * Shrink [start, end) so it neither starts nor ends on whitespace (selections
 * often grab a trailing space or newline). Returns null when nothing is left.
 */
export function trimSpan(text: string, start: number, end: number): TextSpan | null {
  let s = Math.max(0, Math.min(start, text.length));
  let e = Math.max(s, Math.min(end, text.length));
  while (s < e && WHITESPACE.test(text.charAt(s))) s++;
  while (e > s && WHITESPACE.test(text.charAt(e - 1))) e--;
  return s < e ? { start: s, end: e } : null;
}

/**
 * Describe the span [start, end) of `text` as a quote with context. The span is
 * trimmed of surrounding whitespace first; returns null if it is empty.
 */
export function describeRange(text: string, start: number, end: number): TextQuote | null {
  const span = trimSpan(text, start, end);
  if (!span) return null;
  return {
    quote: text.slice(span.start, span.end),
    prefix: text.slice(Math.max(0, span.start - CONTEXT_CHARS), span.start),
    suffix: text.slice(span.end, span.end + CONTEXT_CHARS),
  };
}

/**
 * Drop all whitespace, remembering where each kept character came from so
 * matches can be mapped back to the original. Matching ignores whitespace
 * entirely: re-rendered articles shift line breaks, and block boundaries
 * (<p>…</p><p>…</p>) often have no whitespace in `textContent` at all while the
 * stored quote spells them as a paragraph break.
 */
interface Normalized {
  text: string;
  /** `map[i]` = index in the original text of normalized character i. */
  map: number[];
}

/** The last text normalized: a page locates every highlight against one string. */
let lastNormalized: { source: string; result: Normalized } | null = null;

function normalize(text: string): Normalized {
  if (lastNormalized?.source === text) return lastNormalized.result;
  const kept: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (WHITESPACE.test(ch)) continue;
    kept.push(ch);
    map.push(i);
  }
  const result = { text: kept.join(""), map };
  lastNormalized = { source: text, result };
  return result;
}

/** Strip whitespace (for comparing stored context against the page). */
function squash(text: string): string {
  return text.replace(/\s+/g, "");
}

/** Length of the common suffix of a and b. */
function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a.charAt(a.length - 1 - n) === b.charAt(b.length - 1 - n)) n++;
  return n;
}

/** Length of the common prefix of a and b. */
function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a.charAt(n) === b.charAt(n)) n++;
  return n;
}

/**
 * Find `selector.quote` in `text`. Every occurrence is scored by how well the
 * text around it matches the stored prefix/suffix; the best wins (earliest on a
 * tie). Whitespace is ignored when matching — the page may have been
 * re-rendered with different line breaks — but the returned offsets always
 * point into the ORIGINAL `text`. Returns null when the quote isn't there.
 */
export function locateQuote(text: string, selector: TextQuote): TextSpan | null {
  const quote = squash(selector.quote);
  if (!quote) return null;

  const norm = normalize(text);
  const prefix = squash(selector.prefix);
  const suffix = squash(selector.suffix);

  let best: { at: number; score: number } | null = null;
  for (let at = norm.text.indexOf(quote); at !== -1; at = norm.text.indexOf(quote, at + 1)) {
    const before = norm.text.slice(Math.max(0, at - prefix.length), at);
    const after = norm.text.slice(at + quote.length, at + quote.length + suffix.length);
    const score = commonSuffix(before, prefix) + commonPrefix(after, suffix);
    if (!best || score > best.score) best = { at, score };
  }
  if (!best) return null;

  const start = norm.map[best.at];
  const last = norm.map[best.at + quote.length - 1];
  if (start === undefined || last === undefined) return null;
  // map[] only holds non-whitespace characters, so the span starts and ends
  // exactly on the quote's first and last visible characters.
  return { start, end: last + 1 };
}
