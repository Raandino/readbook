import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

/** Normalized result of running Readability over a fetched HTML document. */
export interface ReadabilityResult {
  title: string | null;
  /** Raw (not-yet-sanitized) article HTML. */
  content: string | null;
  textContent: string | null;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
  publishedTime: string | null;
  /** og:image / twitter:image from the page head, as written (may be relative). */
  leadImage: string | null;
}

/**
 * Elements that are invisible on the real page but whose text Readability would
 * happily keep (MediaWiki metadata, screen-reader-only duplicates, print-only
 * navigation). Removed before parsing so they never leak into the article.
 */
const HIDDEN_SELECTORS = [
  "[hidden]",
  '[aria-hidden="true"]',
  '[style*="display:none"]',
  '[style*="display: none"]',
  '[style*="visibility:hidden"]',
  '[style*="visibility: hidden"]',
  ".noprint",
  ".ws-noexport",
  ".mw-hidden",
  ".mw-editsection",
  "template",
].join(",");

function metaContent(document: Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute("content")?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Run Mozilla Readability against a raw HTML string using linkedom as the DOM.
 * linkedom is a lightweight, server-safe DOM — far cheaper than jsdom — and its
 * `document` satisfies Readability's expected surface.
 *
 * Returns null when Readability cannot find a candidate article at all.
 */
export function htmlToReading(html: string, url: string): ReadabilityResult | null {
  // linkedom needs a base URL to resolve relative links/images; Readability also
  // reads the document URI to canonicalize. We set both via the parsed window.
  const { document } = parseHTML(html);

  const leadImage = metaContent(document as unknown as Document, [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
  ]);
  for (const node of Array.from(document.querySelectorAll(HIDDEN_SELECTORS))) node.remove();

  // Readability mutates the document, so this DOM is single-use.
  const article = new Readability(document).parse();
  if (!article) return null;

  return {
    title: article.title ?? null,
    content: article.content ?? null,
    textContent: article.textContent ?? null,
    excerpt: article.excerpt ?? null,
    byline: article.byline ?? null,
    siteName: article.siteName ?? null,
    publishedTime: article.publishedTime ?? null,
    leadImage,
    // `url` is accepted for parity/future canonicalization; linkedom does not
    // expose a settable documentURI, so relative assets are best-effort.
  } satisfies ReadabilityResult;
}

/**
 * Plain text of an HTML fragment with a break between block elements, so
 * "<h2>Walking.</h2><p>I wish…" becomes "Walking.\n\nI wish…" rather than
 * "Walking.I wish…" (which is what `textContent` gives). Used for excerpts,
 * word counts and search.
 */
export function blockText(html: string): string {
  const spaced = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|h[1-6]|li|blockquote|pre|figure|figcaption|tr|dd|dt)>/gi, "$&\n\n");
  const { document } = parseHTML(`<div id="readbook-block-text">${spaced}</div>`);
  const text = document.querySelector("#readbook-block-text")?.textContent ?? "";
  return text
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
