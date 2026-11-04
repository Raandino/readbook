/**
 * The db handle is a process-wide singleton: better-sqlite3 is synchronous and
 * cheap, and a single connection keeps WAL semantics simple for a single-reader
 * app. The schema is created and migrated on first use so the app boots with
 * zero manual steps — Readbook is local-first and should "just run".
 *
 * Designed to move to Cloudflare D1 later, so all access goes through getDb()
 * and nothing else imports the raw better-sqlite3 connection.
 */
import { dirname, isAbsolute, join, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

let db: Db | null = null;
let connection: Database.Database | null = null;

/**
 * The monorepo root (the folder holding pnpm-workspace.yaml), found by walking
 * up from the working directory. Turbo runs the web app from apps/web while a
 * user may start it from the root, so anchoring paths here keeps ONE database
 * no matter where the process was launched. Falls back to the cwd.
 */
export function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/** Resolve the sqlite file path: env override (relative = from repo root), else <root>/data/readbook.db. */
export function resolveDbPath(): string {
  const fromEnv = process.env.READBOOK_DB_PATH?.trim();
  // Safety net: a test run must never open your real shelf, even when vitest is
  // started from a sub-package without the root config.
  if (process.env.VITEST && !fromEnv) return ":memory:";
  if (fromEnv === ":memory:") return fromEnv;
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(workspaceRoot(), fromEnv);
  return join(workspaceRoot(), "data", "readbook.db");
}

/**
 * Ordered, append-only schema migrations tracked with SQLite's built-in
 * `PRAGMA user_version`. Each step must be safe to run against a database
 * created by an older Readbook (CREATE ... IF NOT EXISTS, guarded ALTERs).
 * Never edit a shipped step — add a new one.
 */
const MIGRATIONS: ReadonlyArray<(sqlite: Database.Database) => void> = [
  // 1 — the original readings table.
  (sqlite) => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS readings (
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
      )
    `);
  },
  // 2 — reader notes, highlights, settings, feed indexes.
  (sqlite) => {
    const columns = sqlite.prepare("PRAGMA table_info(readings)").all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "note")) {
      sqlite.exec("ALTER TABLE readings ADD COLUMN note TEXT");
    }
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS readings_fetched_idx ON readings (fetched_at);
      CREATE INDEX IF NOT EXISTS readings_status_idx ON readings (status);

      CREATE TABLE IF NOT EXISTS highlights (
        id TEXT PRIMARY KEY,
        reading_id TEXT NOT NULL REFERENCES readings(id) ON DELETE CASCADE,
        quote TEXT NOT NULL,
        prefix TEXT NOT NULL DEFAULT '',
        suffix TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT 'yellow',
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS highlights_reading_idx ON highlights (reading_id);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
];

/** Bring the database up to the latest schema version, one transaction per step. */
function migrate(sqlite: Database.Database): void {
  const current = Number(sqlite.pragma("user_version", { simple: true })) || 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    const step = MIGRATIONS[version];
    if (!step) break;
    sqlite.transaction(() => {
      step(sqlite);
      sqlite.pragma(`user_version = ${version + 1}`);
    })();
  }
}

/** The drizzle db handle. Lazily opens the connection and migrates the schema. */
export function getDb(): Db {
  if (db) return db;

  const dbPath = resolveDbPath();
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  // WAL gives better read/write concurrency and durability for an app db.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);

  connection = sqlite;
  db = drizzle(sqlite, { schema });
  return db;
}

/** Close and forget the singleton (used by tests to get a fresh database). */
export function closeDb(): void {
  connection?.close();
  connection = null;
  db = null;
}
