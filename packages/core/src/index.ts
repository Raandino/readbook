/**
 * @readbook/core — the shared contracts every package implements against.
 *
 * The whole product is one idea: any link from anywhere is normalized into a
 * single shape — a `Reading` — and rendered in one calm, book-like feed.
 * This file is that shape. Changing it ripples through db, extractor, and web,
 * so treat it as the source of truth and edit deliberately.
 */

/** Where a Reading came from. `generic` is the catch-all for any other URL. */
export type SourceKind = "substack" | "blog" | "reddit" | "x" | "generic" | "file" | "note";

/** Lifecycle of a Reading in the personal feed. */
export type ReadingStatus = "unread" | "reading" | "read" | "archived";

/** Which engine produced the content (for transparency + debugging extraction). */
export type ExtractorEngine = "readability" | "firecrawl" | "syndication" | "file" | "manual";

/**
 * The normalized article. Every source adapter must produce content that maps
 * cleanly into this shape. `contentHtml` is ALWAYS sanitized before it reaches here.
 */
export interface Reading {
  /** Stable id (slug/uuid). Assigned by the db layer on insert. */
  id: string;
  /** Canonical URL the user pasted (or the resolved canonical link). */
  url: string;
  source: SourceKind;

  title: string;
  /** Author / handle / subreddit poster, when detectable. */
  author: string | null;
  /** Human site name, e.g. "Stratechery", "r/programming". */
  siteName: string | null;

  /** Sanitized, render-ready HTML for the reader view. */
  contentHtml: string;
  /** Plain-text version (used for excerpt, search, word count). */
  contentText: string;
  /** Short summary/dek shown in the feed card. */
  excerpt: string | null;
  /** Hero image URL for the feed card, if any. */
  leadImageUrl: string | null;

  wordCount: number;
  /** Estimated reading time in minutes (>= 1). */
  readingMinutes: number;

  /** Original publish time, ISO 8601, when known. */
  publishedAt: string | null;
  /** When Readbook fetched/normalized it, ISO 8601. */
  fetchedAt: string;

  status: ReadingStatus;
  /** Scroll progress 0..1 for resume-where-you-left-off. */
  progress: number;

  engine: ExtractorEngine;

  /** The reader's own free-form note about this Reading (plain text), if any. */
  note: string | null;
}

/** A Reading without its (potentially large) bodies — for lists, cards and the notebook. */
export type ReadingSummary = Omit<Reading, "contentHtml" | "contentText">;

/**
 * What a source adapter / extractor returns BEFORE the db assigns identity and
 * persistence fields. Everything an extractor can know about the article.
 */
export interface ExtractResult {
  url: string;
  source: SourceKind;
  title: string;
  author: string | null;
  siteName: string | null;
  contentHtml: string;
  contentText: string;
  excerpt: string | null;
  leadImageUrl: string | null;
  publishedAt: string | null;
  engine: ExtractorEngine;
}

/** Fields a new Reading needs on insert (db fills id + status/progress/note defaults). */
export type NewReading = ExtractResult & {
  wordCount: number;
  readingMinutes: number;
  fetchedAt: string;
};

/** A source adapter detects whether it handles a URL and extracts from it. */
export interface SourceAdapter {
  kind: SourceKind;
  /** True if this adapter should own the given URL. */
  matches(url: URL): boolean;
  /** Extract normalized content. Throws ExtractionError on unrecoverable failure. */
  extract(url: string, options: ExtractOptions): Promise<ExtractResult>;
}

/**
 * Runtime knobs the caller (the web app) passes into extraction. The extractor
 * never reads secrets from the environment itself — the app resolves them
 * (Settings page first, env var second) and hands them in.
 */
export interface ExtractOptions {
  /** Firecrawl API key for the paid fallback; omit/empty to run Readability-only. */
  firecrawlApiKey?: string | null;
  /**
   * Allow fetching loopback / private-network / link-local hosts. Off by
   * default so a pasted (or forged) link can't make the server probe your LAN.
   */
  allowPrivateNetwork?: boolean;
  /**
   * User-Agent for page fetches. Empty = Readbook's honest, identifiable
   * default (`READBOOK_USER_AGENT`). Reddit always gets its own API-style UA.
   */
  userAgent?: string | null;
  /**
   * Firecrawl proxy mode. "basic" (default) never escalates; "auto" lets
   * Firecrawl retry through its stealth proxy when a site blocks it.
   */
  firecrawlProxy?: "basic" | "auto";
}

/** Readbook's version, used in the User-Agent and the export format. */
export const READBOOK_VERSION = "0.1.0";

/** Project homepage, used in the User-Agent so site owners can see what we are. */
export const READBOOK_HOMEPAGE = "https://github.com/Raandino/readbook";

/**
 * Honest default User-Agent. The "Mozilla/5.0 (compatible; …)" form is the
 * convention well-behaved crawlers use: identifiable, yet accepted by most sites.
 */
export const READBOOK_USER_AGENT = `Mozilla/5.0 (compatible; Readbook/${READBOOK_VERSION}; +${READBOOK_HOMEPAGE})`;

/** Thrown by adapters/extractors when content cannot be obtained. */
export class ExtractionError extends Error {
  readonly url: string;

  constructor(message: string, url: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ExtractionError";
    this.url = url;
  }
}

/** words-per-minute baseline for reading-time estimates. */
export const WORDS_PER_MINUTE = 220;

/** Highlight colors offered in the reader. Stored as the name, styled by CSS. */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/**
 * A passage the reader marked inside a Reading, optionally with a note.
 *
 * Anchoring follows the W3C Web Annotation "TextQuoteSelector" idea: we store
 * the exact quoted text plus a little context on each side, and re-find it in
 * the rendered article's text on load. That survives re-rendering and CSS
 * changes without depending on fragile DOM paths.
 */
export interface Highlight {
  id: string;
  readingId: string;
  /** The exact highlighted text. */
  quote: string;
  /** Up to ~32 chars of text immediately before the quote (disambiguation). */
  prefix: string;
  /** Up to ~32 chars of text immediately after the quote (disambiguation). */
  suffix: string;
  color: HighlightColor;
  /** Optional note attached to this passage (plain text). */
  note: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/** A highlight joined with the Reading it belongs to (for the notebook view). */
export interface HighlightWithReading extends Highlight {
  readingTitle: string;
  readingSiteName: string | null;
}

/** Fields a client supplies to create a highlight. */
export type NewHighlight = Pick<Highlight, "readingId" | "quote" | "prefix" | "suffix" | "color"> & {
  note?: string | null;
};
