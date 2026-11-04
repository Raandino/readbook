import type { NewReading, Reading } from "@readbook/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  allReadings,
  closeDb,
  countByStatus,
  createHighlight,
  deleteReading,
  findByUrl,
  getReading,
  importReading,
  insertReading,
  listHighlights,
  listReadings,
  updateReadingState,
} from "./index.js";

let clock = Date.parse("2024-01-01T00:00:00.000Z");

/** A NewReading with a unique URL and a strictly increasing fetchedAt (feed order). */
function newReading(overrides: Partial<NewReading> = {}): NewReading {
  clock += 60_000;
  const n = clock;
  return {
    url: `https://blog.example/${n}`,
    source: "generic",
    title: `Post ${n}`,
    author: null,
    siteName: "Blog",
    contentHtml: "<p>body</p>",
    contentText: "body",
    excerpt: null,
    leadImageUrl: null,
    publishedAt: null,
    engine: "readability",
    wordCount: 1,
    readingMinutes: 1,
    fetchedAt: new Date(n).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  closeDb(); // fresh in-memory database
});

describe("insertReading / findByUrl / getReading", () => {
  it("assigns an id and reader-state defaults", () => {
    const reading = insertReading(newReading({ title: "Hello" }));
    expect(reading.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(reading).toMatchObject({ status: "unread", progress: 0, note: null, title: "Hello" });
    expect(getReading(reading.id)).toEqual(reading);
    expect(findByUrl(reading.url)).toEqual(reading);
  });

  it("returns null for unknown ids and URLs", () => {
    expect(getReading("nope")).toBeNull();
    expect(findByUrl("https://nowhere.example/")).toBeNull();
  });

  it("enforces URL uniqueness at the storage layer", () => {
    const input = newReading();
    insertReading(input);
    expect(() => insertReading({ ...input, title: "dup" })).toThrow(/UNIQUE/);
  });

  it("round-trips every field", () => {
    const input = newReading({
      author: "Paul Graham",
      excerpt: "An essay.",
      leadImageUrl: "https://cdn.example/a.jpg",
      publishedAt: "2023-07-01T00:00:00.000Z",
      source: "substack",
      engine: "firecrawl",
      wordCount: 11_000,
      readingMinutes: 50,
    });
    const { id, status, progress, note, ...rest } = insertReading(input);
    expect(rest).toEqual(input);
    expect({ status, progress, note }).toEqual({ status: "unread", progress: 0, note: null });
    expect(getReading(id)?.author).toBe("Paul Graham");
  });
});

describe("listReadings", () => {
  it("lists newest first", () => {
    const a = insertReading(newReading());
    const b = insertReading(newReading());
    const c = insertReading(newReading());
    expect(listReadings().map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    expect(allReadings().map((r) => r.id)).toEqual([c.id, b.id, a.id]);
  });

  it("filters by status, and excludeArchived hides only archived", () => {
    const unread = insertReading(newReading());
    const reading = insertReading(newReading());
    const archived = insertReading(newReading());
    updateReadingState(reading.id, { status: "reading" });
    updateReadingState(archived.id, { status: "archived" });

    expect(listReadings({ status: "reading" }).map((r) => r.id)).toEqual([reading.id]);
    expect(listReadings({ status: "archived" }).map((r) => r.id)).toEqual([archived.id]);
    expect(listReadings({ excludeArchived: true }).map((r) => r.id)).toEqual([reading.id, unread.id]);
    // status wins over excludeArchived
    expect(listReadings({ status: "archived", excludeArchived: true }).map((r) => r.id)).toEqual([archived.id]);
  });

  it("searches title, author, site name and body, case-insensitively", () => {
    const byTitle = insertReading(newReading({ title: "How to Do Great Work" }));
    const byAuthor = insertReading(newReading({ author: "Ursula K. Le Guin" }));
    const bySite = insertReading(newReading({ siteName: "Stratechery" }));
    const byBody = insertReading(newReading({ contentText: "the quiet hum of the reactor" }));
    insertReading(newReading());

    expect(listReadings({ query: "great work" }).map((r) => r.id)).toEqual([byTitle.id]);
    expect(listReadings({ query: "LE GUIN" }).map((r) => r.id)).toEqual([byAuthor.id]);
    expect(listReadings({ query: "stratech" }).map((r) => r.id)).toEqual([bySite.id]);
    expect(listReadings({ query: "reactor" }).map((r) => r.id)).toEqual([byBody.id]);
    expect(listReadings({ query: "zzz-nothing" })).toEqual([]);
  });

  it("ignores a blank query", () => {
    insertReading(newReading());
    insertReading(newReading());
    expect(listReadings({ query: "   " })).toHaveLength(2);
  });

  it("combines status and query", () => {
    const a = insertReading(newReading({ title: "Alpha essay" }));
    const b = insertReading(newReading({ title: "Alpha notes" }));
    updateReadingState(b.id, { status: "read" });
    expect(listReadings({ status: "read", query: "alpha" }).map((r) => r.id)).toEqual([b.id]);
    expect(listReadings({ status: "unread", query: "alpha" }).map((r) => r.id)).toEqual([a.id]);
  });

  it("treats LIKE wildcards and the escape character literally", () => {
    const percent = insertReading(newReading({ title: "Growth of 100% in a year" }));
    const underscore = insertReading(newReading({ title: "snake_case naming" }));
    const backslash = insertReading(newReading({ title: "C:\\Users\\path" }));
    insertReading(newReading({ title: "100 points" }));
    insertReading(newReading({ title: "snakeXcase naming" }));

    expect(listReadings({ query: "100%" }).map((r) => r.id)).toEqual([percent.id]);
    expect(listReadings({ query: "%" }).map((r) => r.id)).toEqual([percent.id]);
    expect(listReadings({ query: "e_c" }).map((r) => r.id)).toEqual([underscore.id]);
    expect(listReadings({ query: "_" }).map((r) => r.id)).toEqual([underscore.id]);
    expect(listReadings({ query: "\\Users" }).map((r) => r.id)).toEqual([backslash.id]);
  });

  it("is safe against SQL-ish input", () => {
    insertReading(newReading({ title: "ok" }));
    expect(listReadings({ query: "'; DROP TABLE readings; --" })).toEqual([]);
    expect(listReadings()).toHaveLength(1);
  });
});

describe("countByStatus", () => {
  it("is all zeros on an empty shelf", () => {
    expect(countByStatus()).toEqual({ all: 0, unread: 0, reading: 0, read: 0, archived: 0 });
  });

  it("counts each stage and the total", () => {
    const ids = Array.from({ length: 6 }, () => insertReading(newReading()).id);
    updateReadingState(ids[0]!, { status: "reading" });
    updateReadingState(ids[1]!, { status: "read" });
    updateReadingState(ids[2]!, { status: "read" });
    updateReadingState(ids[3]!, { status: "archived" });
    expect(countByStatus()).toEqual({ all: 6, unread: 2, reading: 1, read: 2, archived: 1 });
  });
});

describe("updateReadingState", () => {
  it("patches only the given fields", () => {
    const r = insertReading(newReading());
    expect(updateReadingState(r.id, { progress: 0.42 })).toMatchObject({ status: "unread", progress: 0.42, note: null });
    expect(updateReadingState(r.id, { status: "reading" })).toMatchObject({ status: "reading", progress: 0.42 });
  });

  it("sets and clears the note", () => {
    const r = insertReading(newReading());
    expect(updateReadingState(r.id, { note: "Reread the second half." })?.note).toBe("Reread the second half.");
    expect(getReading(r.id)?.note).toBe("Reread the second half.");
    expect(updateReadingState(r.id, { note: null })?.note).toBeNull();
  });

  it("an empty patch is a no-op read", () => {
    const r = insertReading(newReading());
    expect(updateReadingState(r.id, {})).toEqual(r);
  });

  it("returns null for an unknown id", () => {
    expect(updateReadingState("missing", { status: "read" })).toBeNull();
  });
});

describe("deleteReading", () => {
  it("removes the Reading and cascades to its highlights only", () => {
    const keep = insertReading(newReading());
    const gone = insertReading(newReading());
    const base = { prefix: "", suffix: "", color: "yellow" as const };
    createHighlight({ ...base, readingId: gone.id, quote: "one" });
    createHighlight({ ...base, readingId: gone.id, quote: "two" });
    const kept = createHighlight({ ...base, readingId: keep.id, quote: "three" });

    deleteReading(gone.id);

    expect(getReading(gone.id)).toBeNull();
    expect(listHighlights(gone.id)).toEqual([]);
    expect(listHighlights(keep.id)).toEqual([kept]);
  });

  it("is a no-op for an unknown id", () => {
    insertReading(newReading());
    deleteReading("missing");
    expect(listReadings()).toHaveLength(1);
  });
});

describe("importReading", () => {
  it("writes a Reading verbatim (id, status, progress, note) and is idempotent", () => {
    const exported: Reading = {
      ...newReading(),
      id: "exported-id",
      status: "read",
      progress: 1,
      note: "Loved it",
    };
    expect(importReading(exported)).toBe(true);
    expect(getReading("exported-id")).toEqual(exported);
    expect(importReading(exported)).toBe(false);
  });

  it("skips a Reading whose URL is already on the shelf", () => {
    const existing = insertReading(newReading());
    expect(importReading({ ...existing, id: "other-id", title: "changed" })).toBe(false);
    expect(getReading(existing.id)?.title).toBe(existing.title);
    expect(getReading("other-id")).toBeNull();
  });
});
