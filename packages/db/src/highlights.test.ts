import type { Highlight, NewReading } from "@readbook/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeDb,
  createHighlight,
  deleteHighlight,
  getHighlight,
  importHighlight,
  insertReading,
  listAllHighlights,
  listHighlights,
  updateHighlight,
} from "./index.js";

function reading(title: string, siteName: string | null = "Blog") {
  const input: NewReading = {
    url: `https://blog.example/${encodeURIComponent(title)}`,
    source: "generic",
    title,
    author: null,
    siteName,
    contentHtml: "<p>body</p>",
    contentText: "body",
    excerpt: null,
    leadImageUrl: null,
    publishedAt: null,
    engine: "readability",
    wordCount: 1,
    readingMinutes: 1,
    fetchedAt: new Date().toISOString(),
  };
  return insertReading(input);
}

/** Advance the fake clock so createdAt values are strictly ordered. */
let now = Date.parse("2024-05-01T12:00:00.000Z");
function tick(): void {
  now += 1000;
  vi.setSystemTime(now);
}

beforeEach(() => {
  closeDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  tick();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("highlights", () => {
  it("creates with timestamps and a null note by default", () => {
    const r = reading("A");
    const h = createHighlight({ readingId: r.id, quote: "a passage", prefix: "before ", suffix: " after", color: "green" });
    expect(h).toMatchObject({ readingId: r.id, quote: "a passage", prefix: "before ", suffix: " after", color: "green", note: null });
    expect(h.createdAt).toBe(h.updatedAt);
    expect(getHighlight(h.id)).toEqual(h);
  });

  it("lists a Reading's highlights oldest first", () => {
    const r = reading("A");
    const other = reading("B");
    const base = { prefix: "", suffix: "", color: "yellow" as const };
    const first = createHighlight({ ...base, readingId: r.id, quote: "first" });
    tick();
    createHighlight({ ...base, readingId: other.id, quote: "elsewhere" });
    tick();
    const second = createHighlight({ ...base, readingId: r.id, quote: "second", note: "why" });
    expect(listHighlights(r.id).map((h) => h.id)).toEqual([first.id, second.id]);
    expect(listHighlights("unknown")).toEqual([]);
  });

  it("lists every highlight newest first with its Reading's title (the notebook)", () => {
    const a = reading("Essay A", "Site A");
    const b = reading("Essay B", null);
    const base = { prefix: "", suffix: "", color: "blue" as const };
    const h1 = createHighlight({ ...base, readingId: a.id, quote: "one" });
    tick();
    const h2 = createHighlight({ ...base, readingId: b.id, quote: "two" });

    const all = listAllHighlights();
    expect(all.map((h) => h.id)).toEqual([h2.id, h1.id]);
    expect(all[0]).toMatchObject({ readingTitle: "Essay B", readingSiteName: null });
    expect(all[1]).toMatchObject({ readingTitle: "Essay A", readingSiteName: "Site A" });
  });

  it("updates color and note, bumping updatedAt", () => {
    const r = reading("A");
    const h = createHighlight({ readingId: r.id, quote: "q", prefix: "", suffix: "", color: "yellow" });
    tick();
    const updated = updateHighlight(h.id, { color: "pink", note: "remember this" });
    expect(updated).toMatchObject({ color: "pink", note: "remember this", createdAt: h.createdAt });
    expect(updated?.updatedAt).not.toBe(h.updatedAt);

    expect(updateHighlight(h.id, { note: null })?.note).toBeNull();
  });

  it("an empty patch changes nothing (not even updatedAt)", () => {
    const r = reading("A");
    const h = createHighlight({ readingId: r.id, quote: "q", prefix: "", suffix: "", color: "yellow" });
    tick();
    expect(updateHighlight(h.id, {})).toEqual(h);
  });

  it("returns null when updating an unknown id", () => {
    expect(updateHighlight("missing", { color: "green" })).toBeNull();
    expect(getHighlight("missing")).toBeNull();
  });

  it("deletes", () => {
    const r = reading("A");
    const h = createHighlight({ readingId: r.id, quote: "q", prefix: "", suffix: "", color: "yellow" });
    deleteHighlight(h.id);
    expect(getHighlight(h.id)).toBeNull();
  });

  it("refuses a highlight for a Reading that doesn't exist (foreign key)", () => {
    expect(() =>
      createHighlight({ readingId: "no-such-reading", quote: "q", prefix: "", suffix: "", color: "yellow" }),
    ).toThrow(/FOREIGN KEY/);
  });

  it("imports verbatim and skips existing ids", () => {
    const r = reading("A");
    const exported: Highlight = {
      id: "h-exported",
      readingId: r.id,
      quote: "q",
      prefix: "p",
      suffix: "s",
      color: "green",
      note: "n",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-02T00:00:00.000Z",
    };
    expect(importHighlight(exported)).toBe(true);
    expect(getHighlight("h-exported")).toEqual(exported);
    expect(importHighlight({ ...exported, quote: "changed" })).toBe(false);
    expect(getHighlight("h-exported")?.quote).toBe("q");
  });
});
