/**
 * The notebook: every highlight and reading-note on the shelf, grouped by the
 * Reading it belongs to — plus its Markdown export. Pure functions (no db, no
 * DOM) so both the /notebook page and the export endpoint share one shape.
 */
import type { Highlight, Reading } from "@readbook/core";

/** The few Reading fields the notebook needs. */
export type NotebookReading = Pick<Reading, "id" | "title" | "url" | "author" | "siteName" | "note">;

export interface NotebookGroup {
  reading: NotebookReading;
  /** Newest first. */
  highlights: Highlight[];
}

/** The URL as a URL object when it's a real http(s) link, else null (notes, files). */
export function httpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

/** "www.example.com" → "example.com", for quiet "Read the original" labels. */
export function displayHost(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

/**
 * Group highlights under their Readings. Groups with highlights come first,
 * ordered by their most recent highlight; Readings that only carry a note
 * follow, in the order given. Highlights whose Reading is unknown are dropped.
 */
export function buildNotebook(highlights: readonly Highlight[], readings: readonly NotebookReading[]): NotebookGroup[] {
  const byId = new Map(readings.map((r) => [r.id, r]));
  const groups = new Map<string, NotebookGroup>();

  const newestFirst = [...highlights].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const h of newestFirst) {
    const reading = byId.get(h.readingId);
    if (!reading) continue;
    let group = groups.get(reading.id);
    if (!group) {
      group = { reading, highlights: [] };
      groups.set(reading.id, group);
    }
    group.highlights.push(h);
  }

  const noteOnly = readings
    .filter((r) => !groups.has(r.id) && r.note?.trim())
    .map((reading) => ({ reading, highlights: [] }));

  return [...groups.values(), ...noteOnly];
}

// ---- Markdown export ------------------------------------------------------

/** Collapse whitespace so a value can sit on one Markdown line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Escape characters that would change the meaning of inline link text. */
function escapeInline(text: string): string {
  return text.replace(/([\\[\]*_`<>])/g, "\\$1");
}

/**
 * Inline Markdown that could turn plain text into something live: links and
 * images (`[`, `]`, `![`), emphasis (`*`, `_`), code spans, backslashes, and
 * tag-like `<b>` / `<https://…>` autolinks. One pass, so nothing is escaped twice.
 */
const INLINE_SYNTAX = /[\\`*_[\]]|!(?=\[)|<(?=[A-Za-z/!?])/g;

/**
 * Make one line of user/extracted text safe to embed inside a Markdown block:
 * strip indentation (4 spaces would start a code block), backslash-escape
 * inline syntax so a quoted `![x](…)` or `[x](javascript:…)` stays text, and
 * escape a leading block marker (#, >, ```, ~~~, lists, ---/=== rules, tables)
 * so the line can't break out of its blockquote. The text is plain, never HTML.
 */
export function neutralizeLine(line: string): string {
  const text = line
    .replace(/\s+$/, "")
    .replace(/^\s+/, "")
    .replace(INLINE_SYNTAX, "\\$&");
  if (/^\d+[.)]/.test(text)) return text.replace(/^(\d+)([.)])/, "$1\\$2");
  if (/^[#>`~=+*|_-]/.test(text)) return `\\${text}`;
  return text;
}

/** Lines of text as neutralized Markdown, with runs of blank lines collapsed. */
function safeLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = neutralizeLine(raw);
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** A quote as a Markdown blockquote; blank lines become ">" so it stays one quote. */
export function blockquote(text: string): string {
  return safeLines(text)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/** Plain-text note → Markdown paragraphs that can't turn into headings/lists. */
function paragraph(text: string): string {
  return safeLines(text).join("  \n").replace(/  \n  \n/g, "\n\n");
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function groupMarkdown(group: NotebookGroup): string {
  const { reading } = group;
  const parts: string[] = [`## ${escapeInline(oneLine(reading.title) || "Untitled")}`];

  const meta: string[] = [];
  if (reading.author) meta.push(`*${escapeInline(oneLine(reading.author))}*`);
  if (reading.siteName) meta.push(escapeInline(oneLine(reading.siteName)));
  const original = httpUrl(reading.url);
  if (original) meta.push(`[Read the original](<${original.href.replace(/[<>\s]/g, encodeURIComponent)}>)`);
  if (meta.length > 0) parts.push(meta.join(" · "));

  if (reading.note?.trim()) parts.push(`**My notes:**\n\n${paragraph(reading.note)}`);

  // Oldest first reads like the article itself.
  for (const h of [...group.highlights].reverse()) {
    const lines = [blockquote(h.quote), "", `*${capitalize(h.color)} highlight · ${h.createdAt.slice(0, 10)}*`];
    if (h.note?.trim()) lines.push("", paragraph(h.note));
    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n");
}

/**
 * The whole notebook as one Markdown document: a header, then one section per
 * Reading with its note and every highlight as a blockquote.
 */
export function notebookToMarkdown(groups: readonly NotebookGroup[], exportedAt: string): string {
  const count = groups.reduce((n, g) => n + g.highlights.length, 0);
  const header = [
    "# Readbook highlights",
    "",
    `Exported ${exportedAt.slice(0, 10)} · ${count} ${count === 1 ? "highlight" : "highlights"} from ${groups.length} ${
      groups.length === 1 ? "reading" : "readings"
    }`,
  ].join("\n");
  if (groups.length === 0) return `${header}\n\nNothing highlighted yet.\n`;
  return `${[header, ...groups.map(groupMarkdown)].join("\n\n---\n\n")}\n`;
}

/** A filesystem-friendly download name, e.g. "readbook-how-to-do-great-work.md". */
export function exportFilename(exportedAt: string, title?: string): string {
  const slug = (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug ? `readbook-${slug}.md` : `readbook-highlights-${exportedAt.slice(0, 10)}.md`;
}
