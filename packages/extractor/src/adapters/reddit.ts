import type { ExtractOptions, ExtractResult, SourceAdapter } from "@readbook/core";
import { ExtractionError, READBOOK_HOMEPAGE, READBOOK_VERSION } from "@readbook/core";

import { classifySource } from "../detect";
import { safeFetch } from "../net";
import { sanitizeHtml } from "../sanitize";

/**
 * Reddit's API rules ask every client for a unique, descriptive User-Agent in
 * the form `<platform>:<app id>:<version> (by …)` and forbid impersonating a
 * browser, so this adapter never uses the generic/custom UA.
 */
const REDDIT_USER_AGENT = `server:readbook:${READBOOK_VERSION} (self-hosted read-it-later; +${READBOOK_HOMEPAGE})`;

/** How many top-level comments we fold into the Reading body. */
const MAX_COMMENTS = 5;

/**
 * Reddit exposes a clean JSON view of any post by appending `.json` to its URL.
 * We use that instead of Readability because it gives us structured author,
 * subreddit, body, and comments — and avoids Reddit's JS-heavy web shell.
 */
export const redditAdapter: SourceAdapter = {
  kind: "reddit",
  matches(url: URL): boolean {
    return classifySource(url) === "reddit";
  },
  extract: extractReddit,
};

async function extractReddit(url: string, options: ExtractOptions): Promise<ExtractResult> {
  const jsonUrl = toJsonUrl(url);

  let payload: unknown;
  try {
    const res = await safeFetch(jsonUrl, {
      accept: "application/json",
      maxBytes: 5 * 1024 * 1024,
      allowPrivateNetwork: options.allowPrivateNetwork,
      userAgent: REDDIT_USER_AGENT,
    });
    if (!res.ok) throw new ExtractionError(`Reddit JSON fetch failed (${res.status}) for ${url}`, url);
    payload = res.json();
  } catch (cause) {
    if (cause instanceof ExtractionError) throw cause;
    throw new ExtractionError(`Could not load Reddit post ${url}`, url, cause);
  }

  const post = readPost(payload);
  if (!post) throw new ExtractionError(`Unexpected Reddit JSON shape for ${url}`, url);

  const comments = readComments(payload);
  const html = buildHtml(post, comments);
  const text = buildText(post, comments);

  return {
    url,
    source: "reddit",
    title: post.title,
    author: post.author,
    siteName: `r/${post.subreddit}`,
    contentHtml: sanitizeHtml(html),
    contentText: text,
    excerpt: post.selftext.slice(0, 280) || `Discussion in r/${post.subreddit}`,
    leadImageUrl: post.thumbnail,
    publishedAt: post.createdAt,
    engine: "readability",
  };
}

/** A Reddit listing URL with `.json` appended before the query string. */
function toJsonUrl(url: string): string {
  const u = new URL(url);
  if (!u.pathname.endsWith(".json")) {
    u.pathname = `${u.pathname.replace(/\/$/, "")}.json`;
  }
  return u.toString();
}

interface RedditPost {
  title: string;
  author: string | null;
  subreddit: string;
  selftext: string;
  selftextHtml: string | null;
  createdAt: string | null;
  thumbnail: string | null;
}

interface RedditComment {
  author: string | null;
  bodyHtml: string | null;
  body: string;
}

/** The post is the first child of listing[0]. */
function readPost(payload: unknown): RedditPost | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const data = childData(payload[0]);
  if (!data) return null;

  const subreddit = asString(data["subreddit"]) ?? "unknown";
  const createdUtc = data["created_utc"];

  return {
    title: asString(data["title"]) ?? "Reddit post",
    author: asString(data["author"]),
    subreddit,
    selftext: asString(data["selftext"]) ?? "",
    selftextHtml: decodeHtmlEntities(asString(data["selftext_html"])),
    createdAt: typeof createdUtc === "number" ? new Date(createdUtc * 1000).toISOString() : null,
    thumbnail: validThumbnail(asString(data["thumbnail"])),
  };
}

/** Top-level comments live in listing[1]. */
function readComments(payload: unknown): RedditComment[] {
  if (!Array.isArray(payload) || payload.length < 2) return [];
  const listing = payload[1];
  const children = listingChildren(listing);

  const comments: RedditComment[] = [];
  for (const child of children) {
    if (comments.length >= MAX_COMMENTS) break;
    if (!isRecord(child) || child["kind"] !== "t1") continue;
    const data = isRecord(child["data"]) ? child["data"] : null;
    if (!data) continue;
    const body = asString(data["body"]);
    if (!body) continue;
    comments.push({
      author: asString(data["author"]),
      bodyHtml: decodeHtmlEntities(asString(data["body_html"])),
      body,
    });
  }
  return comments;
}

function buildHtml(post: RedditPost, comments: RedditComment[]): string {
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(post.title)}</h1>`);
  if (post.author) parts.push(`<p><strong>Posted by u/${escapeHtml(post.author)}</strong></p>`);
  parts.push(post.selftextHtml ?? `<p>${escapeHtml(post.selftext)}</p>`);

  if (comments.length > 0) {
    parts.push("<hr />");
    parts.push("<h2>Top comments</h2>");
    for (const c of comments) {
      const who = c.author ? `u/${escapeHtml(c.author)}` : "comment";
      parts.push(`<blockquote><p><strong>${who}</strong></p>${c.bodyHtml ?? `<p>${escapeHtml(c.body)}</p>`}</blockquote>`);
    }
  }
  return parts.join("\n");
}

function buildText(post: RedditPost, comments: RedditComment[]): string {
  const lines = [post.title, post.selftext];
  for (const c of comments) lines.push(`${c.author ?? "comment"}: ${c.body}`);
  return lines.filter(Boolean).join("\n\n");
}

// --- small JSON helpers (Reddit's shape is loosely typed) ---

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function childData(listing: unknown): Record<string, unknown> | null {
  const children = listingChildren(listing);
  const first = children[0];
  if (!isRecord(first)) return null;
  return isRecord(first["data"]) ? first["data"] : null;
}

function listingChildren(listing: unknown): unknown[] {
  if (!isRecord(listing)) return [];
  const data = listing["data"];
  if (!isRecord(data)) return [];
  const children = data["children"];
  return Array.isArray(children) ? children : [];
}

/** Reddit only sets a real thumbnail URL; otherwise it sends sentinels like "self". */
function validThumbnail(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith("http") ? value : null;
}

/** Reddit double-encodes selftext_html/body_html; undo the entity encoding once. */
function decodeHtmlEntities(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
