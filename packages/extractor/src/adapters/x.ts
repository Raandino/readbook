import type { ExtractResult, SourceAdapter } from "@readbook/core";
import { ExtractionError } from "@readbook/core";

import { classifySource } from "../detect";
import { safeFetch } from "../net";
import { sanitizeHtml } from "../sanitize";

const SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result";

// Syndication `features` flags adapted from vercel/react-tweet (MIT, Copyright (c)
// 2023 Luis Alvarez) — packages/react-tweet/src/api/fetch-tweet.ts. The endpoint
// 404s without a plausible set. See THIRD_PARTY_NOTICES.md.
const FEATURES = [
  "tfw_timeline_list:",
  "tfw_follower_count_sunset:true",
  "tfw_tweet_edit_backend:on",
  "tfw_refsrc_session:on",
  "tfw_show_business_verified_badge:on",
  "tfw_duplicate_scribes_to_settings:on",
  "tfw_show_blue_verified_badge:on",
  "tfw_show_gov_verified_badge:on",
  "tfw_show_business_affiliate_badge:on",
  "tfw_tweet_edit_frontend:on",
].join(";");

/**
 * X/Twitter renders threads client-side, and Firecrawl refuses x.com ("we do
 * not support this site"). Instead we read the public syndication CDN — the
 * same JSON the official embed widget and Vercel's MIT-licensed `react-tweet`
 * (https://github.com/vercel/react-tweet) use: no key, no login, just the one
 * public tweet. This is an UNOFFICIAL, undocumented interface: it can change or
 * break at any time, and your use of it is subject to X's terms. The token
 * derivation and feature-flag list below are adapted from react-tweet (see
 * THIRD_PARTY_NOTICES.md). Long-form X Articles (`/article/…`) aren't on this CDN, so
 * they fail with a clear message rather than a confusing scrape error.
 */
export const xAdapter: SourceAdapter = {
  kind: "x",
  matches(url: URL): boolean {
    return classifySource(url) === "x";
  },
  extract: extractX,
};

async function extractX(url: string): Promise<ExtractResult> {
  const id = tweetId(url);
  if (!id) {
    throw new ExtractionError(`Not a recognizable X tweet or article URL: ${url}`, url);
  }

  const tweet = await fetchTweet(id, url);
  // X Articles (long-form) ride on a normal tweet that carries an `article`
  // object. The full body is only shown to signed-in X users, but the public payload gives us the
  // real title, a preview, and a cover — enough for a useful preview Reading.
  const article = readArticle(tweet);
  return article ? normalizeArticle(url, tweet, article) : normalize(url, tweet);
}

/** Fetch + validate the syndication payload for a tweet id. */
async function fetchTweet(id: string, url: string): Promise<Tweet> {
  const endpoint = new URL(SYNDICATION_URL);
  endpoint.searchParams.set("id", id);
  endpoint.searchParams.set("lang", "en");
  endpoint.searchParams.set("features", FEATURES);
  endpoint.searchParams.set("token", token(id));

  let payload: unknown;
  try {
    // Fixed public host, so the private-network guard always applies here.
    const res = await safeFetch(endpoint.toString(), { accept: "application/json", maxBytes: 5 * 1024 * 1024 });
    if (res.status === 404) {
      throw new ExtractionError(`Tweet not found, deleted, or protected: ${url}`, url);
    }
    if (!res.ok) {
      throw new ExtractionError(`X syndication fetch failed (${res.status}) for ${url}`, url);
    }
    payload = res.json();
  } catch (cause) {
    if (cause instanceof ExtractionError) throw cause;
    throw new ExtractionError(`Could not load tweet ${url}`, url, cause);
  }

  if (!isRecord(payload) || payload["__typename"] !== "Tweet") {
    throw new ExtractionError(`Tweet is unavailable (protected or removed): ${url}`, url);
  }
  return payload as unknown as Tweet;
}

function normalize(url: string, tweet: Tweet): ExtractResult {
  const name = asString(tweet.user?.name);
  const handle = asString(tweet.user?.screen_name);
  const text = asString(tweet.text) ?? "";
  const photos = readPhotos(tweet);

  const html = sanitizeHtml(buildHtml(tweet, text, photos));
  const author = name && handle ? `${name} (@${handle})` : (name ?? (handle ? `@${handle}` : null));

  return {
    url,
    source: "x",
    title: buildTitle(handle, text, url),
    author,
    siteName: "X",
    contentHtml: html,
    contentText: buildText(tweet, text),
    excerpt: truncate(text.replace(/\s+/g, " ").trim(), 280) || null,
    leadImageUrl: photos[0]?.url ?? null,
    publishedAt: asString(tweet.created_at),
    engine: "syndication",
  };
}

/** Build a preview Reading for an X Article (the full body needs an X login). */
function normalizeArticle(url: string, tweet: Tweet, article: XArticle): ExtractResult {
  const name = asString(tweet.user?.name);
  const handle = asString(tweet.user?.screen_name);
  const author = name && handle ? `${name} (@${handle})` : (name ?? (handle ? `@${handle}` : null));

  const parts: string[] = [];
  if (article.cover) {
    parts.push(`<figure><img src="${escapeAttr(article.cover)}" alt="${escapeHtml(article.title)}" /></figure>`);
  }
  if (article.preview) parts.push(`<p>${escapeHtml(article.preview)}</p>`);
  parts.push("<hr />");
  parts.push(
    `<p><em>This is the public preview of an X Article. The full text is only available on X.</em></p>`,
  );
  parts.push(`<p><a href="${escapeAttr(url)}">Read the full article on X →</a></p>`);

  return {
    url,
    source: "x",
    title: article.title,
    author,
    siteName: "X Article",
    contentHtml: sanitizeHtml(parts.join("\n")),
    contentText: [article.title, article.preview].filter(Boolean).join("\n\n"),
    excerpt: article.preview ? truncate(article.preview, 280) : null,
    leadImageUrl: article.cover,
    publishedAt: asString(tweet.created_at),
    engine: "syndication",
  };
}

// --- rendering ---

function buildHtml(tweet: Tweet, text: string, photos: Photo[]): string {
  const parts: string[] = [];
  parts.push(textToHtml(text, tweet.entities));

  for (const photo of photos) {
    const alt = escapeHtml(photo.alt ?? "");
    parts.push(`<figure><img src="${escapeAttr(photo.url)}" alt="${alt}" /></figure>`);
  }

  const quoted = tweet.quoted_tweet;
  if (isRecord(quoted)) {
    const qName = asString(quoted["user"] && (quoted["user"] as Tweet["user"])?.name);
    const qHandle = asString(quoted["user"] && (quoted["user"] as Tweet["user"])?.screen_name);
    const qText = asString(quoted["text"]) ?? "";
    const who = qName && qHandle ? `${escapeHtml(qName)} (@${escapeHtml(qHandle)})` : "Quoted tweet";
    parts.push(
      `<blockquote><p><strong>${who}</strong></p>${textToHtml(qText, quoted["entities"])}</blockquote>`,
    );
  }

  return parts.filter(Boolean).join("\n");
}

/** Escape, linkify @mentions / #hashtags / t.co URLs, then split into paragraphs. */
function textToHtml(text: string, entities: unknown): string {
  if (!text.trim()) return "";
  let s = escapeHtml(text);

  s = s.replace(/(^|\s)@(\w{1,15})/g, (_m, pre: string, handle: string) =>
    `${pre}<a href="https://x.com/${handle}">@${handle}</a>`,
  );
  s = s.replace(/(^|\s)#(\w+)/g, (_m, pre: string, tag: string) =>
    `${pre}<a href="https://x.com/hashtag/${tag}">#${tag}</a>`,
  );

  for (const u of readUrlEntities(entities)) {
    // t.co tokens carry no HTML-special chars, so the escaped text still contains them verbatim.
    s = s.split(u.url).join(`<a href="${escapeAttr(u.expanded)}">${escapeHtml(u.display)}</a>`);
  }

  return s
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

function buildTitle(handle: string | null, text: string, url: string): string {
  const body = text.replace(/\s+/g, " ").trim();
  const snippet = body.length > 0 ? truncate(body, 100) : null;
  const at = handle ? `@${handle}` : null;
  if (at && snippet) return `${at}: “${snippet}”`;
  if (snippet) return snippet;
  if (at) return `${at} on X`;
  return url;
}

function buildText(tweet: Tweet, text: string): string {
  const lines = [text];
  const quoted = tweet.quoted_tweet;
  if (isRecord(quoted)) {
    const qText = asString(quoted["text"]);
    if (qText) lines.push(`Quoted: ${qText}`);
  }
  return lines.filter(Boolean).join("\n\n");
}

// --- payload parsing ---

interface Tweet {
  __typename: string;
  text?: unknown;
  created_at?: unknown;
  user?: { name?: unknown; screen_name?: unknown };
  entities?: unknown;
  photos?: unknown;
  mediaDetails?: unknown;
  quoted_tweet?: unknown;
  article?: unknown;
}

interface Photo {
  url: string;
  alt: string | null;
}

interface XArticle {
  title: string;
  preview: string | null;
  cover: string | null;
}

/** Pull the Article title/preview/cover out of a tweet that carries one. */
function readArticle(tweet: Tweet): XArticle | null {
  const article = tweet.article;
  if (!isRecord(article)) return null;
  const title = asString(article["title"]);
  if (!title) return null;

  const cover = isRecord(article["cover_media"]) && isRecord(article["cover_media"]["media_info"])
    ? asString(article["cover_media"]["media_info"]["original_img_url"])
    : null;

  return { title, preview: asString(article["preview_text"]), cover };
}

interface UrlEntity {
  url: string;
  expanded: string;
  display: string;
}

function readPhotos(tweet: Tweet): Photo[] {
  const photos: Photo[] = [];

  // mediaDetails carries alt text; photos is the simpler fallback.
  const media = Array.isArray(tweet.mediaDetails) ? tweet.mediaDetails : [];
  for (const m of media) {
    if (!isRecord(m) || m["type"] !== "photo") continue;
    const src = asString(m["media_url_https"]);
    if (src) photos.push({ url: src, alt: asString(m["ext_alt_text"]) });
  }
  if (photos.length > 0) return photos;

  const simple = Array.isArray(tweet.photos) ? tweet.photos : [];
  for (const p of simple) {
    if (!isRecord(p)) continue;
    const src = asString(p["url"]);
    if (src) photos.push({ url: src, alt: null });
  }
  return photos;
}

function readUrlEntities(entities: unknown): UrlEntity[] {
  if (!isRecord(entities)) return [];
  const urls = entities["urls"];
  if (!Array.isArray(urls)) return [];

  const out: UrlEntity[] = [];
  for (const u of urls) {
    if (!isRecord(u)) continue;
    const url = asString(u["url"]);
    const expanded = asString(u["expanded_url"]);
    if (!url || !expanded) continue;
    out.push({ url, expanded, display: asString(u["display_url"]) ?? expanded });
  }
  return out;
}

// --- url helpers ---

/**
 * Trailing numeric id from /status/<id>, /statuses/<id>, /i/web/status/<id>, or
 * an Article URL /<handle>/article/<id> (the id there is still a tweet id).
 */
function tweetId(url: string): string | null {
  const match = /\/(?:status(?:es)?|article)\/(\d+)/.exec(safePathname(url));
  return match?.[1] ?? null;
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * Syndication token derivation adapted from vercel/react-tweet (MIT, Copyright
 * (c) 2023 Luis Alvarez) — required by the endpoint. See THIRD_PARTY_NOTICES.md.
 */
function token(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

// --- small helpers ---

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
