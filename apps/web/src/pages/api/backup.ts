/**
 * /api/backup
 *   GET  — download the whole shelf as readbook-backup-YYYY-MM-DD.json.
 *   POST — restore (merge) a backup sent as the raw JSON request body.
 *
 * Validation and the merge itself live in lib/backup.ts; this route only
 * handles the HTTP side (content type, size cap, error mapping).
 */
import type { APIRoute } from "astro";
import { countByStatus, countHighlights } from "@readbook/db";
import { BackupError, buildBackup, restoreBackup } from "../../lib/backup";
import { error, json, isJsonRequest } from "../../lib/http";

export const prerender = false;

const MAX_BACKUP_BYTES = 200 * 1024 * 1024;


export const GET: APIRoute = () => {
  const backup = buildBackup();
  const day = backup.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="readbook-backup-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
};

/** Read the body as text, giving up as soon as it passes `limit` bytes. Null = too large. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const POST: APIRoute = async ({ request }) => {
  if (!isJsonRequest(request)) return error("Send the backup file as application/json.", 415);

  const text = await readCapped(request, MAX_BACKUP_BYTES);
  if (text === null) return error("That backup is larger than 200 MB.", 413);

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return error("That file isn't valid JSON. Choose a backup downloaded from Readbook.", 400);
  }

  try {
    const result = restoreBackup(data);
    // Fresh totals so the Settings page can update its counts without a reload.
    return json({ ...result, totals: { readings: countByStatus(), highlights: countHighlights() } });
  } catch (err) {
    if (err instanceof BackupError) return error(`Not restored: ${err.message}`, 400);
    console.error("[readbook] backup restore failed:", err instanceof Error ? err.message : err);
    return error("Restore failed; nothing was changed.", 500);
  }
};
