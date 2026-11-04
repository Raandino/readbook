import type { ExtractOptions, ExtractResult, NewReading, SourceAdapter, SourceKind } from "@readbook/core";
import { ExtractionError } from "@readbook/core";

import { classifySource } from "./detect";
import { extractWithFirecrawl } from "./firecrawl";
import { assertFetchableUrl, SafeFetchError } from "./net";
import { readingMinutes, wordCount } from "./reading-time";
import { safeHttpUrl } from "./sanitize";

import { genericAdapter } from "./adapters/generic";
import { redditAdapter } from "./adapters/reddit";
import { substackAdapter } from "./adapters/substack";
import { xAdapter } from "./adapters/x";

export { classifySource } from "./detect";
export { extractFile, extractNote } from "./files";
export type { LocalFileInput, NoteInput } from "./files";
export { isBlockedAddress, assertFetchableUrl, safeFetch, SafeFetchError } from "./net";
export { sanitizeHtml } from "./sanitize";
export { wordCount, readingMinutes } from "./reading-time";

/**
 * Specific adapters first, generic last. `extract` picks the first whose
 * `matches` claims the URL — generic always claims, so this list is exhaustive.
 */
const ADAPTERS: SourceAdapter[] = [xAdapter, redditAdapter, substackAdapter, genericAdapter];

/** Below this word count we consider a primary result thin and worth a Firecrawl retry. */
const THIN_WORDS = 120;

/**
 * Which sources may retry via Firecrawl when the primary (Readability) path fails
 * or comes back thin, and a key exists.
 * - `x` is excluded: it reads the public syndication CDN, and Firecrawl flatly
 *   refuses x.com ("we do not support this site"), so a retry is a wasted call.
 * - `reddit` is excluded: Firecrawl explicitly refuses reddit.com ("we do not
 *   support this site"), so a retry is a guaranteed wasted call. Reddit only works
 *   via its own JSON path today; robust support needs the official Reddit API.
 */
function isFirecrawlRetryEligible(source: SourceKind): boolean {
  return source !== "x" && source !== "reddit";
}

/**
 * Run the full hybrid extraction pipeline and return a persistence-ready
 * NewReading. Always throws ExtractionError (never a raw error) on total failure.
 */
export async function extract(url: string, options: ExtractOptions = {}): Promise<NewReading> {
  const parsed = parseUrl(url, options);
  const source = classifySource(parsed);
  const adapter = pickAdapter(parsed);

  const result = await runHybrid(url, source, adapter, options);
  return finalize(result);
}

/**
 * HYBRID rule: try the adapter's native path. For Readability-based sources, if
 * that path fails OR returns thin content AND a Firecrawl key exists, also try
 * Firecrawl and keep whichever Reading is richer (more words). Non-Readability
 * adapters (X via Firecrawl, Reddit via JSON) own their own strategy.
 */
async function runHybrid(
  url: string,
  source: SourceKind,
  adapter: SourceAdapter,
  options: ExtractOptions,
): Promise<ExtractResult> {
  const canRetry = isFirecrawlRetryEligible(source) && Boolean(options.firecrawlApiKey?.trim());

  let primary: ExtractResult | null = null;
  let primaryError: unknown = null;
  try {
    primary = await adapter.extract(url, options);
  } catch (err) {
    primaryError = err;
  }

  if (!canRetry) {
    if (primary) return primary;
    throw asExtractionError(primaryError, url, `Could not extract a Reading from ${url}`);
  }

  // Eligible for retry: skip it only when the primary result is already rich.
  if (primary && wordsIn(primary) >= THIN_WORDS) return primary;

  // A link we refused on purpose (private address, bad scheme) must not be
  // handed to a third-party service either.
  if (!primary && isPolicyRefusal(primaryError)) {
    throw asExtractionError(primaryError, url, `Could not extract a Reading from ${url}`);
  }

  let fallback: ExtractResult | null = null;
  let fallbackError: unknown = null;
  try {
    fallback = await extractWithFirecrawl(url, source, options);
  } catch (err) {
    fallbackError = err;
  }

  // Both paths failed: report that we tried both, with both reasons.
  if (!primary && !fallback) {
    throw new ExtractionError(
      `Could not extract a Reading from ${url}. Primary: ${reason(primaryError)}; Firecrawl: ${reason(fallbackError)}`,
      url,
      primaryError ?? fallbackError,
    );
  }

  return richer(primary, fallback) ?? primary ?? (fallback as ExtractResult);
}

/** Compute counts + timestamp to turn an ExtractResult into a NewReading. */
function finalize(result: ExtractResult): NewReading {
  const words = wordCount(result.contentText);
  return {
    ...result,
    // Feed cards render this as <img src>; only ever keep a plain http(s) URL.
    leadImageUrl: safeHttpUrl(result.leadImageUrl),
    wordCount: words,
    readingMinutes: readingMinutes(words),
    // ISO 8601 fetch time; the db never overwrites this.
    fetchedAt: new Date().toISOString(),
  };
}

function pickAdapter(url: URL): SourceAdapter {
  // Non-null because genericAdapter.matches() always returns true.
  return ADAPTERS.find((a) => a.matches(url)) ?? genericAdapter;
}

/** Parse + vet the URL (http/https only, no literal private IPs) before any adapter runs. */
function parseUrl(url: string, options: ExtractOptions): URL {
  try {
    return assertFetchableUrl(url, options.allowPrivateNetwork);
  } catch (cause) {
    const message = cause instanceof SafeFetchError ? cause.message : `Not a valid URL: ${url}`;
    throw new ExtractionError(message, url, cause);
  }
}

function wordsIn(result: ExtractResult): number {
  return wordCount(result.contentText);
}

/** Pick the result with more words; either may be null. */
function richer(a: ExtractResult | null, b: ExtractResult | null): ExtractResult | null {
  if (a && b) return wordsIn(a) >= wordsIn(b) ? a : b;
  return a ?? b;
}

/** True when `err` (or its cause) is our own SSRF/scheme refusal rather than a site failure. */
function isPolicyRefusal(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof SafeFetchError && (e.code === "blocked-address" || e.code === "scheme")) return true;
  }
  return false;
}

/** Human-readable one-liner for any thrown value (for combined error messages). */
function reason(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err == null) return "not attempted";
  return String(err);
}

/** Normalize any thrown value into an ExtractionError so callers see one type. */
function asExtractionError(cause: unknown, url: string, message: string): ExtractionError {
  if (cause instanceof ExtractionError) return cause;
  return new ExtractionError(message, url, cause);
}
