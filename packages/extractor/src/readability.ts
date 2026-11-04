import type { ExtractOptions, ExtractResult, SourceKind } from "@readbook/core";
import { ExtractionError, READBOOK_USER_AGENT } from "@readbook/core";

import { blockText, htmlToReading } from "./dom";
import { safeFetch, SafeFetchError } from "./net";
import { sanitizeHtml } from "./sanitize";
import { wordCount } from "./reading-time";

/** Below this, Readability almost certainly captured nav/boilerplate, not an article. */
const MIN_WORDS = 50;

/** Short, user-facing wording for network failures (raw socket errors stay in `cause`). */
function friendlyFetchError(cause: unknown): string {
  if (cause instanceof SafeFetchError) {
    switch (cause.code) {
      case "timeout":
        return "The site took too long to respond.";
      case "too-large":
        return "That page is too large to read.";
      case "redirects":
        return "The link redirects too many times.";
      case "scheme":
      case "blocked-address":
        return cause.message;
      case "network":
        return "The site couldn't be reached. Check the link and your connection.";
    }
  }
  return "The site couldn't be reached.";
}

/**
 * Fetch raw HTML for a URL (SSRF-guarded). Returns the final URL after
 * redirects too, so relative links resolve against where the page really is.
 */
async function fetchHtml(url: string, options: ExtractOptions): Promise<{ html: string; finalUrl: string }> {
  let res;
  try {
    res = await safeFetch(url, {
      accept: "text/html,application/xhtml+xml",
      allowPrivateNetwork: options.allowPrivateNetwork,
      userAgent: options.userAgent?.trim() || READBOOK_USER_AGENT,
    });
  } catch (cause) {
    throw new ExtractionError(friendlyFetchError(cause), url, cause);
  }
  if (!res.ok) {
    throw new ExtractionError(`The site answered with an error (HTTP ${res.status}).`, url);
  }
  return { html: res.text(), finalUrl: res.url };
}

/**
 * The free, fast path: fetch the page and let Readability find the article.
 * `source` is threaded through so each adapter can stamp its own SourceKind on
 * the otherwise-identical result.
 */
export async function extractWithReadability(
  url: string,
  source: SourceKind,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const { html, finalUrl } = await fetchHtml(url, options);
  const article = htmlToReading(html, finalUrl);

  if (!article || !article.content || !article.textContent) {
    throw new ExtractionError(`Readability found no article content at ${url}`, url);
  }

  // Guard against boilerplate-only extractions; the hybrid layer may then retry
  // via Firecrawl for richer content.
  if (wordCount(article.textContent) < MIN_WORDS) {
    throw new ExtractionError(`Article too short to be a real Reading at ${url}`, url);
  }

  return {
    url,
    source,
    title: cleanTitle(article.title, url, article.siteName) ?? url,
    author: article.byline ?? null,
    siteName: article.siteName ?? null,
    contentHtml: sanitizeHtml(article.content, finalUrl),
    contentText: blockText(article.content),
    excerpt: cleanExcerpt(article.excerpt, blockText(article.content)),
    leadImageUrl: absoluteUrl(article.leadImage, finalUrl) ?? leadImageFrom(article.content, finalUrl),
    publishedAt: article.publishedTime ?? null,
    engine: "readability",
  };
}

/**
 * Drop a trailing site-name suffix from a <title> ("Essay - Example Blog",
 * "Essay | Wikisource, the free online library"), but only when the suffix
 * clearly names the site (its siteName, or a label of the hostname), so real
 * titles containing a dash are left alone.
 */
export function cleanTitle(title: string | null, url: string, siteName: string | null): string | null {
  const stripped = stripSiteSuffix(title, url, siteName);
  return stripped ? lastPathSegmentTitle(stripped, url) : null;
}

/**
 * Wikis title subpages with their full path ("The Four Million/The Gift of the
 * Magi"). When the URL's last path segment spells the same final part, keep
 * just that part. Titles like "TCP/IP explained" are untouched because the URL
 * won't end in "IP explained".
 */
function lastPathSegmentTitle(title: string, url: string): string {
  if (!title.includes("/")) return title;
  const last = title.slice(title.lastIndexOf("/") + 1).trim();
  if (last.length < 2) return title;
  let segment = "";
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    segment = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)).replace(/_/g, " ").trim();
  } catch {
    return title;
  }
  return segment.toLowerCase() === last.toLowerCase() ? last : title;
}

function stripSiteSuffix(title: string | null, url: string, siteName: string | null): string | null {
  const trimmed = title?.trim();
  if (!trimmed) return null;
  const match = /^(.{3,}?)\s+[|–—-]\s+([^|–—-]+)$/.exec(trimmed);
  if (!match?.[1] || !match[2]) return trimmed;
  const suffix = match[2].toLowerCase();
  let labels: string[] = [];
  try {
    labels = new URL(url).hostname.toLowerCase().split(".").filter((l) => l.length > 3 && l !== "www");
  } catch {
    // Not a URL we can read labels from; only siteName can match.
  }
  const namesSite =
    (siteName && suffix.includes(siteName.toLowerCase())) || labels.some((label) => suffix.replace(/\s+/g, "").includes(label));
  return namesSite ? match[1].trim() : trimmed;
}

/** Resolve a possibly-relative URL against the page; null if it can't be parsed. */
function absoluteUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;

/**
 * A card-worthy excerpt: the page's own description when it is real prose,
 * otherwise the first ~220 characters of the article. Rejects junk such as a
 * lone "←" or a zero-width space that some sites put in their meta tags.
 */
export function cleanExcerpt(excerpt: string | null, text: string): string | null {
  const normalize = (v: string) => v.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  const candidate = excerpt ? normalize(excerpt) : "";
  const words = candidate.split(" ").filter((w) => /\p{L}/u.test(w));
  // A heading ("ESSAY II: Self-Reliance") is not a summary; want a sentence.
  if (words.length >= 5 && candidate.length >= 40) return candidate.length > 300 ? `${candidate.slice(0, 297).trimEnd()}…` : candidate;
  // Skip leading heading-like blocks (title, "ESSAY II", dates) when choosing prose.
  const blocks = text.split(/\n{2,}/).map(normalize).filter(Boolean);
  const firstProse = blocks.findIndex((block) => block.split(" ").length >= 8);
  const body = (firstProse > 0 ? blocks.slice(firstProse) : blocks).join(" ");
  if (!body) return null;
  return body.length > 220 ? `${body.slice(0, 217).trimEnd()}…` : body;
}

/**
 * Pick a card hero from the article body: the first image that isn't obviously
 * an icon, logo or spacer (tiny declared size, "20px-" thumbnails, etc.).
 */
function leadImageFrom(contentHtml: string, baseUrl: string): string | null {
  for (const tag of contentHtml.match(/<img\b[^>]*>/gi) ?? []) {
    const src = /\ssrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!src) continue;
    const width = Number(/\swidth=["']?(\d+)/i.exec(tag)?.[1] ?? NaN);
    const height = Number(/\sheight=["']?(\d+)/i.exec(tag)?.[1] ?? NaN);
    if (width < 120 || height < 80) continue;
    if (/\/\d{1,2}px-|logo|icon|sprite|avatar|badge|pixel|spacer/i.test(src)) continue;
    const resolved = absoluteUrl(src, baseUrl);
    if (resolved) return resolved;
  }
  return null;
}
