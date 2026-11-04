/**
 * The `readings` table is the single physical shape behind @readbook/core's
 * `Reading`. SQLite is typeless-ish, so we lean on enum lists + Drizzle's
 * `$type<>()` to make the column types line up with the shared contract rather
 * than letting `string` leak in. One column per Reading field, same names.
 */
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import type {
  SourceKind,
  ReadingStatus,
  ExtractorEngine,
  HighlightColor,
} from "@readbook/core";

export const readings = sqliteTable("readings", {
  id: text("id").primaryKey(),
  // Unique so dedupe (findByUrl) is enforced at the storage layer too.
  url: text("url").notNull().unique(),
  source: text("source").$type<SourceKind>().notNull(),

  title: text("title").notNull(),
  author: text("author"),
  siteName: text("site_name"),

  contentHtml: text("content_html").notNull(),
  contentText: text("content_text").notNull(),
  excerpt: text("excerpt"),
  leadImageUrl: text("lead_image_url"),

  wordCount: integer("word_count").notNull(),
  readingMinutes: integer("reading_minutes").notNull(),

  publishedAt: text("published_at"),
  fetchedAt: text("fetched_at").notNull(),

  status: text("status").$type<ReadingStatus>().notNull().default("unread"),
  progress: real("progress").notNull().default(0),

  engine: text("engine").$type<ExtractorEngine>().notNull(),

  note: text("note"),
}, (t) => [
  // Mirrors migration 2 in client.ts so a Drizzle diff stays clean.
  index("readings_fetched_idx").on(t.fetchedAt),
  index("readings_status_idx").on(t.status),
]);

/** Passages marked in the reader. Deleting a Reading deletes its highlights. */
export const highlights = sqliteTable(
  "highlights",
  {
    id: text("id").primaryKey(),
    readingId: text("reading_id")
      .notNull()
      .references(() => readings.id, { onDelete: "cascade" }),
    quote: text("quote").notNull(),
    prefix: text("prefix").notNull().default(""),
    suffix: text("suffix").notNull().default(""),
    color: text("color").$type<HighlightColor>().notNull().default("yellow"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("highlights_reading_idx").on(t.readingId)],
);

/**
 * Key/value app settings edited from the Settings page (e.g. the Firecrawl
 * key). Local-only: it lives in the same SQLite file as your shelf.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Row shapes inferred from the table, for precise row<->Reading mapping. */
export type ReadingRow = typeof readings.$inferSelect;
export type NewReadingRow = typeof readings.$inferInsert;
export type HighlightRow = typeof highlights.$inferSelect;
