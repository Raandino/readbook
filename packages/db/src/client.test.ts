import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, getReading, listReadings, resolveDbPath, updateReadingState, workspaceRoot } from "./index.js";

const V1_SCHEMA = `
  CREATE TABLE readings (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    site_name TEXT,
    content_html TEXT NOT NULL,
    content_text TEXT NOT NULL,
    excerpt TEXT,
    lead_image_url TEXT,
    word_count INTEGER NOT NULL,
    reading_minutes INTEGER NOT NULL,
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unread',
    progress REAL NOT NULL DEFAULT 0,
    engine TEXT NOT NULL
  )`;

const V1_ROW = `
  INSERT INTO readings (id, url, source, title, content_html, content_text, word_count, reading_minutes, fetched_at, status, progress, engine)
  VALUES ('old-1', 'https://old.example/a', 'generic', 'From v1', '<p>x</p>', 'x', 1, 1, '2023-01-01T00:00:00.000Z', 'reading', 0.5, 'readability')`;

let dir: string;
let savedPath: string | undefined;

beforeEach(() => {
  closeDb();
  savedPath = process.env.READBOOK_DB_PATH;
  dir = mkdtempSync(join(tmpdir(), "readbook-db-test-"));
});

afterEach(() => {
  closeDb();
  if (savedPath === undefined) delete process.env.READBOOK_DB_PATH;
  else process.env.READBOOK_DB_PATH = savedPath;
  rmSync(dir, { recursive: true, force: true });
});

function columns(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

function tables(sqlite: Database.Database): string[] {
  return (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map(
    (t) => t.name,
  );
}

describe.each([
  ["an untracked v1 database (user_version 0)", 0],
  ["a tracked v1 database (user_version 1)", 1],
])("migrating %s", (_label, userVersion) => {
  it("adds the note column, highlights and settings, and keeps existing rows", () => {
    const path = join(dir, "old.db");
    const seed = new Database(path);
    seed.exec(V1_SCHEMA);
    seed.exec(V1_ROW);
    seed.pragma(`user_version = ${userVersion}`);
    seed.close();

    process.env.READBOOK_DB_PATH = path;
    getDb();

    const old = getReading("old-1");
    expect(old).toMatchObject({ title: "From v1", status: "reading", progress: 0.5, note: null });
    expect(updateReadingState("old-1", { note: "migrated" })?.note).toBe("migrated");
    closeDb();

    const check = new Database(path, { readonly: true });
    expect(columns(check, "readings")).toContain("note");
    expect(tables(check)).toEqual(expect.arrayContaining(["readings", "highlights", "settings"]));
    expect(Number(check.pragma("user_version", { simple: true }))).toBe(2);
    check.close();
  });
});

describe("getDb", () => {
  it("creates a fresh file database (and its folder) at the latest version", () => {
    const path = join(dir, "nested", "deeper", "readbook.db");
    process.env.READBOOK_DB_PATH = path;
    expect(listReadings()).toEqual([]);
    closeDb();

    const check = new Database(path, { readonly: true });
    expect(Number(check.pragma("user_version", { simple: true }))).toBe(2);
    expect(columns(check, "readings")).toContain("note");
    expect(String(check.pragma("journal_mode", { simple: true }))).toBe("wal");
    check.close();
  });

  it("is idempotent: reopening a migrated database is a no-op", () => {
    const path = join(dir, "readbook.db");
    process.env.READBOOK_DB_PATH = path;
    getDb();
    closeDb();
    expect(() => getDb()).not.toThrow();
    closeDb();
    const check = new Database(path, { readonly: true });
    expect(Number(check.pragma("user_version", { simple: true }))).toBe(2);
    check.close();
  });

  it("returns the same handle until closeDb()", () => {
    expect(getDb()).toBe(getDb());
    const first = getDb();
    closeDb();
    expect(getDb()).not.toBe(first);
  });
});

describe("resolveDbPath", () => {
  it("passes :memory: through", () => {
    process.env.READBOOK_DB_PATH = ":memory:";
    expect(resolveDbPath()).toBe(":memory:");
  });

  it("keeps absolute paths and resolves relative ones from the workspace root", () => {
    process.env.READBOOK_DB_PATH = "/abs/elsewhere.db";
    expect(resolveDbPath()).toBe("/abs/elsewhere.db");
    process.env.READBOOK_DB_PATH = "./data/custom.db";
    expect(resolveDbPath()).toBe(join(workspaceRoot(), "data", "custom.db"));
  });

  it("defaults to <root>/data/readbook.db outside of tests", () => {
    const vitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
      delete process.env.READBOOK_DB_PATH;
      expect(resolveDbPath()).toBe(join(workspaceRoot(), "data", "readbook.db"));
      process.env.READBOOK_DB_PATH = "   ";
      expect(resolveDbPath()).toBe(join(workspaceRoot(), "data", "readbook.db"));
    } finally {
      process.env.VITEST = vitest;
    }
  });

  it("never opens the real shelf under vitest when no path is set", () => {
    delete process.env.READBOOK_DB_PATH;
    expect(resolveDbPath()).toBe(":memory:");
  });
});
