/**
 * All persistence operations for Readings. These are the only sanctioned way to
 * touch the table; they map rows precisely to the @readbook/core `Reading` shape
 * so the rest of the app never sees raw SQLite columns.
 */
import { and, desc, eq, getTableColumns, or, sql, type SQL } from "drizzle-orm";
import type { NewReading, Reading, ReadingStatus, ReadingSummary } from "@readbook/core";
import { getDb } from "./client.js";
import { readings, type ReadingRow } from "./schema.js";

/**
 * Map a stored row to the public Reading. The `$type<>()` annotations already
 * narrow the enum columns, so this is a structural rename only — kept explicit
 * so any drift between row and contract surfaces at compile time here.
 */
export function rowToReading(row: ReadingRow): Reading {
  return {
    id: row.id,
    url: row.url,
    source: row.source,
    title: row.title,
    author: row.author,
    siteName: row.siteName,
    contentHtml: row.contentHtml,
    contentText: row.contentText,
    excerpt: row.excerpt,
    leadImageUrl: row.leadImageUrl,
    wordCount: row.wordCount,
    readingMinutes: row.readingMinutes,
    publishedAt: row.publishedAt,
    fetchedAt: row.fetchedAt,
    status: row.status,
    progress: row.progress,
    engine: row.engine,
    note: row.note,
  };
}

/** Persist a freshly extracted Reading. Assigns id + status/progress defaults. */
export function insertReading(input: NewReading): Reading {
  const db = getDb();
  const reading: Reading = {
    id: crypto.randomUUID(),
    status: "unread",
    progress: 0,
    note: null,
    ...input,
  };
  db.insert(readings).values(reading).run();
  return reading;
}

/** Dedupe lookup by canonical URL. */
export function findByUrl(url: string): Reading | null {
  const db = getDb();
  const row = db.select().from(readings).where(eq(readings.url, url)).get();
  return row ? rowToReading(row) : null;
}

export interface ListReadingsOptions {
  /** Only this lifecycle stage. */
  status?: ReadingStatus;
  /**
   * Hide archived Readings (the default shelf view). Ignored when `status` is
   * set, so `status: "archived"` still lists them.
   */
  excludeArchived?: boolean;
  /** Case-insensitive match against title, author, site name, and body text. */
  query?: string;
}

/** Escape LIKE wildcards so a search for "100%" matches literally. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** WHERE clause shared by the full and summary list queries. */
function listConditions(opts: ListReadingsOptions): SQL | undefined {
  const conditions: SQL[] = [];

  if (opts.status) conditions.push(eq(readings.status, opts.status));
  else if (opts.excludeArchived) conditions.push(sql`${readings.status} <> 'archived'`);

  const query = opts.query?.trim();
  if (query) {
    const pattern = likePattern(query);
    const match = or(
      sql`${readings.title} LIKE ${pattern} ESCAPE '\\'`,
      sql`${readings.author} LIKE ${pattern} ESCAPE '\\'`,
      sql`${readings.siteName} LIKE ${pattern} ESCAPE '\\'`,
      sql`${readings.contentText} LIKE ${pattern} ESCAPE '\\'`,
    );
    if (match) conditions.push(match);
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** The feed: newest first by fetch time, optionally filtered by status and/or a search query. */
export function listReadings(opts: ListReadingsOptions = {}): Reading[] {
  const db = getDb();
  const rows = db.select().from(readings).where(listConditions(opts)).orderBy(desc(readings.fetchedAt)).all();
  return rows.map(rowToReading);
}

/**
 * Same as listReadings, but without the article bodies — what the shelf, the
 * notebook and exports need. Search still matches against the body text.
 */
export function listReadingSummaries(opts: ListReadingsOptions = {}): ReadingSummary[] {
  const db = getDb();
  const { contentHtml: _html, contentText: _text, ...columns } = getTableColumns(readings);
  return db
    .select(columns)
    .from(readings)
    .where(listConditions(opts))
    .orderBy(desc(readings.fetchedAt))
    .all()
    .map((row) => ({ ...row }));
}

/** Every Reading, for export/backup. */
export function allReadings(): Reading[] {
  return listReadings();
}

/** How many Readings sit in each lifecycle stage (for the feed filter tabs). */
export function countByStatus(): Record<ReadingStatus | "all", number> {
  const db = getDb();
  const rows = db
    .select({ status: readings.status, n: sql<number>`count(*)` })
    .from(readings)
    .groupBy(readings.status)
    .all();
  const counts: Record<ReadingStatus | "all", number> = { all: 0, unread: 0, reading: 0, read: 0, archived: 0 };
  for (const row of rows) {
    counts[row.status] = row.n;
    counts.all += row.n;
  }
  return counts;
}

export function getReading(id: string): Reading | null {
  const db = getDb();
  const row = db.select().from(readings).where(eq(readings.id, id)).get();
  return row ? rowToReading(row) : null;
}

/**
 * Update reader-state fields (status / scroll progress / note). Returns the
 * updated Reading, or null if the id is unknown. An empty patch is a no-op read.
 */
export function updateReadingState(
  id: string,
  patch: { status?: ReadingStatus; progress?: number; note?: string | null },
): Reading | null {
  const db = getDb();

  const changes: Partial<Pick<Reading, "status" | "progress" | "note">> = {};
  if (patch.status !== undefined) changes.status = patch.status;
  if (patch.progress !== undefined) changes.progress = patch.progress;
  if (patch.note !== undefined) changes.note = patch.note;

  if (Object.keys(changes).length > 0) {
    db.update(readings).set(changes).where(eq(readings.id, id)).run();
  }
  return getReading(id);
}

export function deleteReading(id: string): void {
  const db = getDb();
  db.delete(readings).where(eq(readings.id, id)).run();
}

/**
 * Insert a Reading exactly as exported (keeping id, status, progress, note).
 * Skips silently when the URL or id already exists, so re-importing a backup
 * is idempotent. Returns true when a row was written.
 */
export function importReading(reading: Reading): boolean {
  const db = getDb();
  const result = db.insert(readings).values(reading).onConflictDoNothing().run();
  return result.changes > 0;
}
