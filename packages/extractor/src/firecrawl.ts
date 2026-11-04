import type { ExtractOptions, ExtractResult, SourceKind } from "@readbook/core";
import { ExtractionError } from "@readbook/core";
import Firecrawl from "@mendable/firecrawl-js";

import { sanitizeHtml } from "./sanitize";

/**
 * The paid, opt-in fallback for JS-rendered pages that the local reader can't
 * see (single-page apps, some Substack custom domains). It is never used to get
 * around logins or paywalls. We ask
 * Firecrawl for cleaned `html` plus `markdown` (a useful text source) and let it
 * isolate the main content server-side, then sanitize the HTML ourselves so the
 * output obeys the same allowlist as the Readability path.
 *
 * Throws ExtractionError if no API key is configured — Firecrawl is opt-in.
 * The key comes from the caller (Settings page or env, resolved by the app).
 */
export async function extractWithFirecrawl(
  url: string,
  source: SourceKind,
  options: ExtractOptions,
): Promise<ExtractResult> {
  const apiKey = options.firecrawlApiKey?.trim();
  if (!apiKey) {
    throw new ExtractionError(`No Firecrawl API key is configured; cannot extract ${url} via Firecrawl`, url);
  }

  const firecrawl = new Firecrawl({ apiKey });

  let doc;
  try {
    doc = await firecrawl.scrape(url, {
      formats: ["html", "markdown"],
      onlyMainContent: true,
      // "basic" by default. "auto" (opt-in from Settings) lets Firecrawl escalate
      // to its costlier stealth proxy when a site blocks the plain request.
      proxy: options.firecrawlProxy === "auto" ? "auto" : "basic",
    });
  } catch (cause) {
    throw new ExtractionError(`Firecrawl scrape failed for ${url}: ${errorMessage(cause)}`, url, cause);
  }

  const rawHtml = doc.html ?? "";
  if (rawHtml.trim().length === 0) {
    throw new ExtractionError(`Firecrawl returned no HTML for ${url}`, url);
  }

  const contentHtml = sanitizeHtml(rawHtml, url);
  // Prefer Firecrawl's markdown as the plain-text source; fall back to stripping
  // tags from the cleaned HTML if markdown is absent.
  const contentText = (doc.markdown ?? stripTags(contentHtml)).trim();

  const meta = doc.metadata ?? {};

  return {
    url,
    source,
    title: meta.title ?? meta.ogTitle ?? url,
    author: typeof meta["author"] === "string" ? (meta["author"] as string) : null,
    siteName: meta.ogSiteName ?? null,
    contentHtml,
    contentText,
    excerpt: meta.description ?? meta.ogDescription ?? null,
    leadImageUrl: meta.ogImage ?? null,
    publishedAt: meta.publishedTime ?? null,
    engine: "firecrawl",
  };
}

/** Pull a human-readable reason out of an unknown thrown value. */
function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return typeof cause === "string" ? cause : String(cause);
}

/** Minimal tag strip for the rare case Firecrawl omits markdown. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
