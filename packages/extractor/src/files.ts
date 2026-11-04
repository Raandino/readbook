import { createHash } from "node:crypto";
import { posix as pathPosix } from "node:path";
import type { ExtractResult, NewReading } from "@readbook/core";
import { ExtractionError } from "@readbook/core";
import { unzipSync, strFromU8 } from "fflate";
import { parseHTML } from "linkedom";
import { marked } from "marked";

import { readingMinutes, wordCount } from "./reading-time";
import { sanitizeHtml } from "./sanitize";

export interface LocalFileInput {
  name: string;
  type?: string;
  data: ArrayBuffer | Uint8Array;
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const EPUB_MEDIA_TYPE = "application/epub+zip";

/**
 * Zip-bomb guards for EPUBs: a 1 MB archive can legally inflate to gigabytes.
 * We only decompress the entries we read (XHTML/OPF/container), and refuse
 * archives whose declared uncompressed sizes are absurd.
 */
const MAX_EPUB_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_EPUB_TOTAL_BYTES = 150 * 1024 * 1024;
const MAX_EPUB_ENTRIES = 5_000;
const EPUB_TEXT_ENTRY = /(\.x?html?|\.opf|\.xml|\.ncx)$/i;

export interface NoteInput {
  /** Optional title; falls back to the first Markdown heading, then "Untitled note". */
  title?: string | null;
  /** The note body — Markdown or plain text. */
  body: string;
}

/**
 * Turn text you wrote (or pasted) into a Reading. The body is Markdown, so
 * plain text works too; it is rendered and sanitized like any upload. Each note
 * gets a unique `readbook-note://` URL so it never dedupes against another.
 */
export async function extractNote(input: NoteInput): Promise<NewReading> {
  const body = stripBom(input.body ?? "").trim();
  const url = `readbook-note://${crypto.randomUUID()}`;
  if (!body) throw new ExtractionError("Write something first — the note is empty.", url);

  const explicit = input.title?.trim() || null;
  const parsed = await extractMarkdown("Untitled note.md", url, body, explicit);
  return finalize({ ...parsed, source: "note", siteName: "Note", engine: "manual" });
}

export async function extractFile(input: LocalFileInput): Promise<NewReading> {
  const bytes = toBytes(input.data);
  const url = localFileUrl(input.name, bytes);
  const ext = extension(input.name);
  const type = input.type?.toLowerCase() ?? "";

  if (MARKDOWN_EXTENSIONS.has(ext) || type === "text/markdown" || type === "text/x-markdown") {
    return finalize(await extractMarkdown(input.name, url, decodeUtf8(bytes)));
  }

  if (ext === ".epub" || type === EPUB_MEDIA_TYPE) {
    return finalize(extractEpub(input.name, url, bytes));
  }

  throw new ExtractionError("Upload an EPUB or Markdown file.", url);
}

/**
 * Render Markdown into a Reading. When the document opens with a `# Heading`
 * that becomes the title, the heading is dropped from the body so the reader
 * doesn't show the title twice. Pass `explicitTitle` when the caller already
 * has one; a leading heading that differs from it is kept as content.
 */
async function extractMarkdown(
  name: string,
  url: string,
  markdown: string,
  explicitTitle: string | null = null,
): Promise<ExtractResult> {
  const lead = leadingHeading(markdown);
  const useLead = lead !== null && (!explicitTitle || explicitTitle === lead.title) && lead.rest.trim().length > 0;
  const title = explicitTitle || (useLead ? lead.title : null) || markdownTitle(markdown) || titleFromFileName(name);
  const parsedHtml = await marked.parse(stripBom(useLead ? lead.rest : markdown), { gfm: true });
  const contentHtml = sanitizeHtml(String(parsedHtml));
  const contentText = htmlText(contentHtml);

  if (!contentText) {
    throw new ExtractionError("That Markdown file did not contain readable text.", url);
  }

  return {
    url,
    source: "file",
    title,
    author: null,
    siteName: "Local file",
    contentHtml,
    contentText,
    excerpt: excerptFrom(contentText),
    leadImageUrl: null,
    publishedAt: null,
    engine: "file",
  };
}

function extractEpub(name: string, url: string, bytes: Uint8Array): ExtractResult {
  let files: Record<string, Uint8Array>;
  let entries = 0;
  let total = 0;
  let tooBig = false;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        entries++;
        if (!EPUB_TEXT_ENTRY.test(file.name)) return false; // skip images/fonts entirely
        total += file.originalSize;
        if (file.originalSize > MAX_EPUB_ENTRY_BYTES || total > MAX_EPUB_TOTAL_BYTES || entries > MAX_EPUB_ENTRIES) {
          tooBig = true;
          return false;
        }
        return true;
      },
    });
  } catch (cause) {
    throw new ExtractionError("That EPUB could not be opened.", url, cause);
  }
  if (tooBig) {
    throw new ExtractionError("That EPUB is too large to import.", url);
  }

  const rootPath = opfPath(files, url);
  const opf = readZipText(files, rootPath, url);
  const metadata = epubMetadata(opf);
  const chapterPaths = epubChapterPaths(opf, rootPath);
  const chapters = chapterPaths
    .map((path) => files[path])
    .filter((file): file is Uint8Array => Boolean(file))
    .map((file) => bodyHtml(decodeUtf8(file)).replace(/<img\b[^>]*\/?\s*>/gi, ""))
    .filter((html) => htmlText(html).length > 0);

  if (chapters.length === 0) {
    throw new ExtractionError("That EPUB did not contain readable chapters.", url);
  }

  const contentHtml = sanitizeHtml(chapters.join("\n<hr />\n"));
  const contentText = htmlText(contentHtml);
  if (!contentText) {
    throw new ExtractionError("That EPUB did not contain readable text.", url);
  }

  return {
    url,
    source: "file",
    title: metadata.title ?? firstHeading(contentHtml) ?? titleFromFileName(name),
    author: metadata.author,
    siteName: "Local EPUB",
    contentHtml,
    contentText,
    excerpt: excerptFrom(contentText),
    leadImageUrl: null,
    publishedAt: null,
    engine: "file",
  };
}

function finalize(result: ExtractResult): NewReading {
  const words = wordCount(result.contentText);
  return {
    ...result,
    wordCount: words,
    readingMinutes: readingMinutes(words),
    fetchedAt: new Date().toISOString(),
  };
}

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function localFileUrl(name: string, bytes: Uint8Array): string {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  return `readbook-file://${hash}/${encodeURIComponent(pathPosix.basename(name))}`;
}

function extension(name: string): string {
  return pathPosix.extname(name).toLowerCase();
}

function decodeUtf8(bytes: Uint8Array): string {
  return strFromU8(bytes);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function titleFromFileName(name: string): string {
  const base = pathPosix.basename(name).replace(/\.[^.]+$/, "").trim();
  return base || "Untitled file";
}

/**
 * A heading's text without inline Markdown: "**Context:![][image1]**" → "Context:".
 * Drops images, keeps link text, removes emphasis/code/strike markers.
 */
export function plainInline(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])?/g, "") // images
    .replace(/\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g, "$1") // links → their text
    .replace(/<[^>]+>/g, "") // inline HTML
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1") // backslash escapes
    .replace(/\s+/g, " ")
    .trim();
}

/** If the first non-blank line is a level-1 ATX heading, split it off. */
function leadingHeading(markdown: string): { title: string; rest: string } | null {
  const match = /^\s*#[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/.exec(stripBom(markdown));
  const title = match?.[1] ? plainInline(match[1]) : "";
  if (!match || !title) return null;
  return { title, rest: stripBom(markdown).slice(match[0].length) };
}

function markdownTitle(markdown: string): string | null {
  const match = stripBom(markdown).match(/^#\s+(.+)$/m);
  return match?.[1] ? plainInline(match[1]) || null : null;
}

function htmlText(html: string): string {
  const { document } = parseHTML(`<div id="readbook-file-text">${html}</div>`);
  return (document.querySelector("#readbook-file-text")?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function excerptFrom(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > 220 ? `${normalized.slice(0, 217).trimEnd()}...` : normalized;
}

function opfPath(files: Record<string, Uint8Array>, url: string): string {
  const container = readZipText(files, "META-INF/container.xml", url);
  const rootfile = container.match(/<rootfile\b[^>]*\bfull-path=["']([^"']+)["'][^>]*>/i)?.[1];
  if (!rootfile) {
    throw new ExtractionError("That EPUB is missing its package manifest.", url);
  }
  return rootfile;
}

function readZipText(files: Record<string, Uint8Array>, path: string, url: string): string {
  const file = files[path];
  if (!file) {
    throw new ExtractionError("That EPUB is missing required files.", url);
  }
  return decodeUtf8(file);
}

function epubMetadata(opf: string): { title: string | null; author: string | null } {
  return {
    title: xmlElementText(opf, "title"),
    author: xmlElementText(opf, "creator"),
  };
}

function epubChapterPaths(opf: string, rootPath: string): string[] {
  const base = pathPosix.dirname(rootPath);
  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const tag of opf.match(/<item\b[^>]*>/gi) ?? []) {
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    const mediaType = attr(tag, "media-type") ?? "";
    if (id && href) manifest.set(id, { href, mediaType });
  }

  const paths: string[] = [];
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) ?? []) {
    const idref = attr(tag, "idref");
    const item = idref ? manifest.get(idref) : null;
    if (item && isHtmlMedia(item.mediaType)) paths.push(resolveZipPath(base, item.href));
  }

  if (paths.length > 0) return paths;

  for (const item of manifest.values()) {
    if (isHtmlMedia(item.mediaType)) paths.push(resolveZipPath(base, item.href));
  }
  return paths;
}

function isHtmlMedia(mediaType: string): boolean {
  return mediaType === "application/xhtml+xml" || mediaType === "text/html";
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? null;
}

function resolveZipPath(base: string, href: string): string {
  const withoutFragment = href.split("#", 1)[0] ?? href;
  const decoded = withoutFragment
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join("/");
  return pathPosix.normalize(pathPosix.join(base, decoded)).replace(/^\.\//, "");
}

function bodyHtml(html: string): string {
  return html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
}

function xmlElementText(xml: string, localName: string): string | null {
  const pattern = `<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`;
  const raw = xml.match(new RegExp(pattern, "i"))?.[1];
  if (!raw) return null;
  return htmlText(raw) || null;
}

function firstHeading(html: string): string | null {
  const raw = html.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1];
  return raw ? htmlText(raw) || null : null;
}
