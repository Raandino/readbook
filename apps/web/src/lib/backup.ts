/**
 * Backup + restore: the whole shelf (Readings + highlights) as one JSON file.
 *
 * A backup is untrusted input the moment it leaves this machine — it may have
 * been hand-edited, come from someone else, or be a different app's file. So
 * restore validates every field strictly, re-sanitizes `contentHtml`, and
 * writes nothing unless the entire file is valid. Settings (and so the
 * Firecrawl key) are deliberately NOT part of a backup.
 *
 * Restore merges rather than replaces: a Reading whose id or URL is already on
 * the shelf is skipped (yours wins), so re-importing the same file is a no-op.
 */
import {
  HIGHLIGHT_COLORS,
  READBOOK_VERSION,
  type ExtractorEngine,
  type Highlight,
  type HighlightColor,
  type Reading,
  type ReadingStatus,
  type SourceKind,
} from "@readbook/core";
import {
  allReadings,
  findByUrl,
  getDb,
  getReading,
  importHighlight,
  importReading,
  listAllHighlights,
} from "@readbook/db";
import { sanitizeHtml } from "@readbook/extractor";

export const BACKUP_FORMAT = "readbook-backup";
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** ISO 8601. */
  exportedAt: string;
  /** READBOOK_VERSION of the app that wrote the file. */
  app: string;
  readings: Reading[];
  highlights: Highlight[];
}

export interface RestoreResult {
  readings: { added: number; skipped: number };
  highlights: { added: number; skipped: number };
}

/** A backup that failed validation. The message names the offending field. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

/** Snapshot the whole shelf. */
export function buildBackup(): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: READBOOK_VERSION,
    readings: allReadings(),
    // listAllHighlights joins the Reading title for the notebook; strip it back to a Highlight.
    highlights: listAllHighlights().map(
      ({ readingTitle: _title, readingSiteName: _site, ...highlight }) => highlight,
    ),
  };
}

/**
 * Validate and merge a parsed backup into the shelf, in one SQLite
 * transaction: either every new row lands or none do. Throws BackupError
 * (before touching the db) if anything in the file is malformed.
 */
export function restoreBackup(data: unknown): RestoreResult {
  const { readings, highlights } = parseBackup(data);
  const result: RestoreResult = {
    readings: { added: 0, skipped: 0 },
    highlights: { added: 0, skipped: 0 },
  };

  // The db helpers all use the same singleton connection, so they run inside
  // this transaction; a throw anywhere rolls the whole restore back.
  getDb().transaction(() => {
    // Backup reading id -> the id it lives under on this shelf. Differs when
    // the same URL was already saved here under another id, so highlights from
    // the backup still attach to the reader's existing copy.
    // null = the backup's Reading collided with a DIFFERENT article here, so
    // its highlights have nowhere safe to go.
    const placed = new Map<string, string | null>();

    for (const reading of readings) {
      if (importReading(reading)) {
        result.readings.added++;
        placed.set(reading.id, reading.id);
        continue;
      }
      result.readings.skipped++;
      if (placed.has(reading.id)) continue; // duplicate id within the file itself
      const existing = getReading(reading.id) ?? findByUrl(reading.url);
      placed.set(reading.id, existing && existing.url === reading.url ? existing.id : null);
    }

    for (const highlight of highlights) {
      // Highlights for Readings not in the file may still attach to one already on the shelf.
      const readingId = placed.has(highlight.readingId)
        ? placed.get(highlight.readingId)
        : getReading(highlight.readingId)?.id;
      if (readingId && importHighlight({ ...highlight, readingId })) result.highlights.added++;
      else result.highlights.skipped++;
    }
  });

  return result;
}

// ---- Validation ------------------------------------------------------------

/*
 * The enum lists are `Record<Union, true>` so adding a value to a core union
 * without updating restore is a compile error here, not a silently rejected file.
 */
const SOURCE_KINDS: Record<SourceKind, true> = {
  substack: true,
  blog: true,
  reddit: true,
  x: true,
  generic: true,
  file: true,
  note: true,
};
const STATUSES: Record<ReadingStatus, true> = { unread: true, reading: true, read: true, archived: true };
const ENGINES: Record<ExtractorEngine, true> = {
  readability: true,
  firecrawl: true,
  syndication: true,
  file: true,
  manual: true,
};

/** Schemes a Reading URL may use: the web, plus Readbook's own note/file identifiers. */
const READING_URL_SCHEMES = new Set(["http:", "https:", "readbook-note:", "readbook-file:"]);
/** Ids appear in URLs (/read/<id>), so keep them to a safe slug/uuid alphabet. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Generous caps: they exist to reject absurd input, not to trim real articles.
// Fields the extractor copies verbatim from page metadata (title, author,
// excerpt, publishedAt, ...) are never length-checked on the way in, so they
// are clipped here instead of rejected: a backup Readbook itself wrote must
// always restore.
const MAX_SHORT = 10_000;
const MAX_LONG = 100_000;
const MAX_URL = 8_192;
const MAX_DATE = 64;
/** Timestamps Readbook writes itself (fetchedAt, createdAt, ...) are ISO 8601. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

type Fields = Record<string, unknown>;

function fail(path: string, problem: string): never {
  throw new BackupError(`${path} ${problem}.`);
}

function asObject(value: unknown, path: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "must be an object");
  return value as Fields;
}

function str(obj: Fields, key: string, path: string, max: number, { nonEmpty = false } = {}): string {
  const value = obj[key];
  if (typeof value !== "string") fail(`${path}.${key}`, "must be a string");
  if (value.length > max) fail(`${path}.${key}`, `is longer than ${max} characters`);
  if (nonEmpty && value.trim() === "") fail(`${path}.${key}`, "must not be empty");
  return value;
}

/** Nullable string; a missing field is treated as null (lenient on omission, strict on type). */
function nullableStr(obj: Fields, key: string, path: string, max: number): string | null {
  if (obj[key] === undefined || obj[key] === null) return null;
  return str(obj, key, path, max);
}

/** A string that is clipped to `max` rather than rejected (see the caps above). */
function clipped(obj: Fields, key: string, path: string, max: number): string {
  return str(obj, key, path, Infinity).slice(0, max);
}

function nullableClipped(obj: Fields, key: string, path: string, max: number): string | null {
  if (obj[key] === undefined || obj[key] === null) return null;
  return clipped(obj, key, path, max);
}

function date(obj: Fields, key: string, path: string): string {
  const value = str(obj, key, path, MAX_DATE);
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) fail(`${path}.${key}`, "must be an ISO 8601 date");
  return value;
}

function count(obj: Fields, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${path}.${key}`, "must be a non-negative integer");
  }
  return value;
}

function oneOf<T extends string>(obj: Fields, key: string, path: string, allowed: Record<T, true>): T {
  const value = obj[key];
  if (typeof value !== "string" || !Object.hasOwn(allowed, value)) {
    fail(`${path}.${key}`, `must be one of: ${Object.keys(allowed).join(", ")}`);
  }
  return value as T;
}

function id(obj: Fields, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    fail(`${path}.${key}`, "must be an id of letters, digits, '-' or '_'");
  }
  return value;
}

function readingUrl(obj: Fields, path: string): string {
  const value = str(obj, "url", path, MAX_URL, { nonEmpty: true });
  let scheme: string;
  try {
    scheme = new URL(value).protocol;
  } catch {
    fail(`${path}.url`, "must be an absolute URL");
  }
  if (!READING_URL_SCHEMES.has(scheme)) fail(`${path}.url`, "must be an http(s) link, a note, or a file");
  return value;
}

/**
 * The feed card renders this as <img src>, so only a plain http(s) URL is
 * kept. Anything else (data:, javascript:, a relative path from an older
 * build) is dropped to null rather than failing the whole restore: it is
 * cosmetic, and the article itself is unaffected.
 */
function imageUrl(obj: Fields, path: string): string | null {
  const value = nullableStr(obj, "leadImageUrl", path, Infinity);
  if (value === null || value.length > MAX_URL) return null;
  try {
    const { protocol } = new URL(value);
    if (protocol === "http:" || protocol === "https:") return value;
  } catch {
    // fall through
  }
  return null;
}

function parseReading(value: unknown, path: string): Reading {
  const r = asObject(value, path);
  const progress = r.progress;
  if (typeof progress !== "number" || !Number.isFinite(progress)) fail(`${path}.progress`, "must be a number");

  return {
    id: id(r, "id", path),
    url: readingUrl(r, path),
    source: oneOf(r, "source", path, SOURCE_KINDS),
    title: clipped(r, "title", path, MAX_SHORT),
    author: nullableClipped(r, "author", path, MAX_SHORT),
    siteName: nullableClipped(r, "siteName", path, MAX_SHORT),
    // Never trust stored markup from a file: run it through the same
    // allowlist the extractor uses before it can reach the reader. No base
    // URL on purpose: restore must not rewrite links the way extraction did.
    contentHtml: sanitizeHtml(str(r, "contentHtml", path, Infinity)),
    contentText: str(r, "contentText", path, Infinity),
    excerpt: nullableClipped(r, "excerpt", path, MAX_SHORT),
    leadImageUrl: imageUrl(r, path),
    wordCount: count(r, "wordCount", path),
    readingMinutes: count(r, "readingMinutes", path),
    // Free text copied from page metadata ("2 days ago" happens), so it is
    // only type-checked, like the extractor does.
    publishedAt: nullableClipped(r, "publishedAt", path, MAX_DATE * 4),
    fetchedAt: date(r, "fetchedAt", path),
    status: oneOf(r, "status", path, STATUSES),
    progress: Math.min(1, Math.max(0, progress)),
    engine: oneOf(r, "engine", path, ENGINES),
    note: nullableStr(r, "note", path, MAX_LONG),
  };
}

const COLORS = Object.fromEntries(HIGHLIGHT_COLORS.map((c) => [c, true])) as Record<HighlightColor, true>;

/** prefix/suffix default to "" when absent (matches the db column default). */
function context(obj: Fields, key: string, path: string): string {
  return obj[key] === undefined ? "" : str(obj, key, path, MAX_SHORT);
}

function parseHighlight(value: unknown, path: string): Highlight {
  const h = asObject(value, path);
  return {
    id: id(h, "id", path),
    readingId: id(h, "readingId", path),
    quote: str(h, "quote", path, MAX_LONG, { nonEmpty: true }),
    prefix: context(h, "prefix", path),
    suffix: context(h, "suffix", path),
    color: oneOf(h, "color", path, COLORS),
    note: nullableStr(h, "note", path, MAX_LONG),
    createdAt: date(h, "createdAt", path),
    updatedAt: date(h, "updatedAt", path),
  };
}

/** Validate the envelope and every record; returns only known fields, fully typed. */
function parseBackup(data: unknown): { readings: Reading[]; highlights: Highlight[] } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new BackupError("That file is not a Readbook backup (expected a JSON object).");
  }
  const root = data as Fields;
  if (root.format !== BACKUP_FORMAT) {
    throw new BackupError("That file is not a Readbook backup (missing \"format\": \"readbook-backup\").");
  }
  if (root.version !== BACKUP_VERSION) {
    throw new BackupError(
      `This backup uses format version ${JSON.stringify(root.version)}; this Readbook understands version ${BACKUP_VERSION}.`,
    );
  }
  if (!Array.isArray(root.readings)) fail("readings", "must be an array");
  if (!Array.isArray(root.highlights)) fail("highlights", "must be an array");

  return {
    readings: root.readings.map((r, i) => parseReading(r, `readings[${i}]`)),
    highlights: root.highlights.map((h, i) => parseHighlight(h, `highlights[${i}]`)),
  };
}
