/**
 * @readbook/db — local-first SQLite persistence for Readings.
 *
 * Public surface is intentionally small: one db accessor plus the CRUD/query
 * functions the app and extractor pipeline depend on. The Drizzle schema is
 * exported separately via the "./schema" package entry.
 */
export { getDb, closeDb, resolveDbPath, workspaceRoot } from "./client.js";
export {
  insertReading,
  findByUrl,
  listReadings,
  listReadingSummaries,
  allReadings,
  countByStatus,
  getReading,
  updateReadingState,
  deleteReading,
  importReading,
} from "./queries.js";
export type { ListReadingsOptions } from "./queries.js";
export {
  createHighlight,
  listHighlights,
  listAllHighlights,
  countHighlights,
  getHighlight,
  updateHighlight,
  deleteHighlight,
  importHighlight,
} from "./highlights.js";
export { SETTING_KEYS, getSetting, setSetting, maskSecret } from "./settings.js";
export type { SettingKey } from "./settings.js";
