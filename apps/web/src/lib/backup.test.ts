import { beforeEach, describe, expect, it } from "vitest";
import type { NewReading } from "@readbook/core";
import {
  closeDb,
  createHighlight,
  getReading,
  insertReading,
  listHighlights,
  listReadings,
  updateReadingState,
} from "@readbook/db";
import { BackupError, buildBackup, restoreBackup } from "./backup";

function sample(overrides: Partial<NewReading> = {}): NewReading {
  return {
    url: "https://example.com/essay",
    source: "blog",
    title: "An essay",
    author: "Ada",
    siteName: "Example",
    contentHtml: "<p>Hello, reader.</p>",
    contentText: "Hello, reader.",
    excerpt: "Hello",
    leadImageUrl: null,
    publishedAt: "2024-01-02T00:00:00.000Z",
    engine: "readability",
    wordCount: 2,
    readingMinutes: 1,
    fetchedAt: "2024-01-03T00:00:00.000Z",
    ...overrides,
  };
}

/** A shelf with one Reading (with state + note) and one highlight, exported. */
function seededBackup() {
  const reading = insertReading(sample());
  updateReadingState(reading.id, { status: "reading", progress: 0.4, note: "come back to this" });
  createHighlight({ readingId: reading.id, quote: "Hello", prefix: "", suffix: ", reader.", color: "green", note: "hi" });
  return buildBackup();
}

beforeEach(() => {
  closeDb(); // next getDb() opens a fresh :memory: database
});

describe("buildBackup / restoreBackup", () => {
  it("round-trips readings and highlights into an empty shelf", () => {
    const backup = seededBackup();
    expect(backup.format).toBe("readbook-backup");
    expect(backup.version).toBe(1);
    expect(backup.highlights[0]).not.toHaveProperty("readingTitle");

    closeDb();
    const result = restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect(result).toEqual({ readings: { added: 1, skipped: 0 }, highlights: { added: 1, skipped: 0 } });

    const original = backup.readings[0]!;
    expect(getReading(original.id)).toEqual(original);
    expect(listHighlights(original.id)).toEqual(backup.highlights);
  });

  it("is idempotent: re-importing skips everything already on the shelf", () => {
    const backup = seededBackup();
    const result = restoreBackup(backup);
    expect(result).toEqual({ readings: { added: 0, skipped: 1 }, highlights: { added: 0, skipped: 1 } });
    expect(listReadings()).toHaveLength(1);
  });

  it("attaches highlights to an existing copy of the same URL saved under another id", () => {
    const backup = seededBackup();
    closeDb();
    const existing = insertReading(sample()); // same URL, new id
    const result = restoreBackup(backup);
    expect(result.readings).toEqual({ added: 0, skipped: 1 });
    expect(result.highlights).toEqual({ added: 1, skipped: 0 });
    expect(listHighlights(existing.id)).toHaveLength(1);
  });

  it("skips highlights whose Reading exists nowhere", () => {
    const backup = seededBackup();
    closeDb();
    const result = restoreBackup({ ...backup, readings: [] });
    expect(result.highlights).toEqual({ added: 0, skipped: 1 });
  });

  it("rejects garbage without writing anything", () => {
    const backup = seededBackup();
    closeDb();
    const reading = backup.readings[0]!;

    for (const bad of [
      null,
      "nope",
      [],
      {},
      { ...backup, format: "pocket-export" },
      { ...backup, version: 2 },
      { ...backup, readings: "all of them" },
      { ...backup, readings: [{ ...reading, status: "loved" }] },
      { ...backup, readings: [{ ...reading, id: "../../etc" }] },
      { ...backup, readings: [{ ...reading, url: "javascript:alert(1)" }] },
      { ...backup, readings: [{ ...reading, wordCount: -3 }] },
      { ...backup, readings: [{ ...reading, fetchedAt: "yesterday-ish" }] },
      { ...backup, readings: [{ ...reading, fetchedAt: "1" }] }, // Date.parse accepts this; ISO doesn't
      { ...backup, readings: [{ ...reading, publishedAt: 2024 }] },
      { ...backup, highlights: [{ ...backup.highlights[0], color: "red" }] },
    ]) {
      expect(() => restoreBackup(bad)).toThrow(BackupError);
    }
    expect(listReadings()).toHaveLength(0);
  });

  it("names the offending field in the error", () => {
    const backup = seededBackup();
    const broken = { ...backup, readings: [backup.readings[0], { ...backup.readings[0], title: 42 }] };
    expect(() => restoreBackup(broken)).toThrow("readings[1].title must be a string.");
  });

  it("re-sanitizes contentHtml and clamps progress", () => {
    const backup = seededBackup();
    closeDb();
    const reading = {
      ...backup.readings[0]!,
      contentHtml: '<p onclick="steal()">Safe</p><script>alert(1)</script><img src="javascript:alert(1)">',
      progress: 7,
    };
    restoreBackup({ ...backup, readings: [reading] });

    const stored = getReading(reading.id)!;
    expect(stored.contentHtml).not.toMatch(/script|onclick|javascript:/i);
    expect(stored.contentHtml).toContain("Safe");
    expect(stored.progress).toBe(1);
  });

  it("restores what the extractor stores verbatim instead of rejecting the file", () => {
    const backup = seededBackup();
    closeDb();
    const reading = {
      ...backup.readings[0]!,
      publishedAt: "2 days ago", // raw page metadata, never date-validated on the way in
      excerpt: "x".repeat(20_000), // uncapped by the extractor: clipped, not rejected
      leadImageUrl: "data:image/png;base64,AAAA", // cosmetic: dropped, not rejected
    };
    expect(restoreBackup({ ...backup, readings: [reading] }).readings.added).toBe(1);

    const stored = getReading(reading.id)!;
    expect(stored.publishedAt).toBe("2 days ago");
    expect(stored.excerpt).toHaveLength(10_000);
    expect(stored.leadImageUrl).toBeNull();
  });
});
