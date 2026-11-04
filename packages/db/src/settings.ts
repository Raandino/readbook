/**
 * Key/value settings. Values are stored as plain strings in the local SQLite
 * file — the same trust boundary as the rest of your shelf. Callers that hold
 * secrets (the Firecrawl key) must never send the raw value back to a browser;
 * see `maskSecret`.
 */
import { eq } from "drizzle-orm";
import { getDb } from "./client.js";
import { settings } from "./schema.js";

/** Every setting Readbook understands. Unknown keys are rejected at the API. */
export const SETTING_KEYS = ["firecrawlApiKey", "firecrawlProxy", "allowPrivateNetwork", "userAgent"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export function getSetting(key: SettingKey): string | null {
  const db = getDb();
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

/** Upsert a setting. An empty or null value deletes it (falls back to env/default). */
export function setSetting(key: SettingKey, value: string | null): void {
  const db = getDb();
  if (value === null || value === "") {
    db.delete(settings).where(eq(settings.key, key)).run();
    return;
  }
  const updatedAt = new Date().toISOString();
  db.insert(settings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
    .run();
}

/** Show just enough of a secret to recognize it: "fc-1…9f2c". Never the whole thing. */
export function maskSecret(secret: string): string {
  if (secret.length <= 10) return "•".repeat(secret.length);
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}
