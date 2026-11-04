/**
 * Highlight persistence. Highlights belong to a Reading (cascade on delete) and
 * are anchored by quote + context — see `Highlight` in @readbook/core.
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Highlight, HighlightColor, HighlightWithReading, NewHighlight } from "@readbook/core";
import { getDb } from "./client.js";
import { highlights, readings, type HighlightRow } from "./schema.js";

function rowToHighlight(row: HighlightRow): Highlight {
  return {
    id: row.id,
    readingId: row.readingId,
    quote: row.quote,
    prefix: row.prefix,
    suffix: row.suffix,
    color: row.color,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createHighlight(input: NewHighlight): Highlight {
  const db = getDb();
  const now = new Date().toISOString();
  const highlight: Highlight = {
    id: crypto.randomUUID(),
    readingId: input.readingId,
    quote: input.quote,
    prefix: input.prefix,
    suffix: input.suffix,
    color: input.color,
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(highlights).values(highlight).run();
  return highlight;
}

/** Highlights for one Reading, in the order they were made. */
export function listHighlights(readingId: string): Highlight[] {
  const db = getDb();
  return db
    .select()
    .from(highlights)
    .where(eq(highlights.readingId, readingId))
    .orderBy(asc(highlights.createdAt))
    .all()
    .map(rowToHighlight);
}

/** Every highlight on the shelf, newest first, with its Reading's title (the notebook). */
export function listAllHighlights(): HighlightWithReading[] {
  const db = getDb();
  return db
    .select({ h: highlights, readingTitle: readings.title, readingSiteName: readings.siteName })
    .from(highlights)
    .innerJoin(readings, eq(highlights.readingId, readings.id))
    .orderBy(desc(highlights.createdAt))
    .all()
    .map((row) => ({
      ...rowToHighlight(row.h),
      readingTitle: row.readingTitle,
      readingSiteName: row.readingSiteName,
    }));
}

/** Total number of highlights on the shelf. */
export function countHighlights(): number {
  const db = getDb();
  const row = db.select({ n: sql<number>`count(*)` }).from(highlights).get();
  return row?.n ?? 0;
}

export function getHighlight(id: string): Highlight | null {
  const db = getDb();
  const row = db.select().from(highlights).where(eq(highlights.id, id)).get();
  return row ? rowToHighlight(row) : null;
}

/** Change a highlight's color and/or note. Returns null if the id is unknown. */
export function updateHighlight(
  id: string,
  patch: { color?: HighlightColor; note?: string | null },
): Highlight | null {
  const db = getDb();
  const changes: Partial<Pick<HighlightRow, "color" | "note" | "updatedAt">> = {};
  if (patch.color !== undefined) changes.color = patch.color;
  if (patch.note !== undefined) changes.note = patch.note;
  if (Object.keys(changes).length > 0) {
    changes.updatedAt = new Date().toISOString();
    db.update(highlights).set(changes).where(eq(highlights.id, id)).run();
  }
  return getHighlight(id);
}

export function deleteHighlight(id: string): void {
  const db = getDb();
  db.delete(highlights).where(eq(highlights.id, id)).run();
}

/** Insert an exported highlight verbatim; skips ids that already exist. */
export function importHighlight(highlight: Highlight): boolean {
  const db = getDb();
  const result = db.insert(highlights).values(highlight).onConflictDoNothing().run();
  return result.changes > 0;
}
