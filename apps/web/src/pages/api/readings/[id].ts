/**
 * /api/readings/[id]
 *   GET    — the Reading as JSON (without the heavy HTML body unless ?full=1).
 *   PATCH  — update status, scroll progress, and/or the reader's note.
 *   DELETE — remove a Reading from the shelf.
 *
 * Progress patches arrive frequently (throttled scroll), so this stays minimal.
 */
import type { APIRoute } from "astro";
import type { ReadingStatus } from "@readbook/core";
import { updateReadingState, deleteReading, getReading } from "@readbook/db";
import { error, isJsonRequest, json, optionalText, readJsonObject } from "../../../lib/http";

export const prerender = false;

const VALID_STATUS: readonly ReadingStatus[] = [
  "unread",
  "reading",
  "read",
  "archived",
];

const MAX_NOTE_CHARS = 20_000;

export const GET: APIRoute = ({ params, url }) => {
  const reading = params.id ? getReading(params.id) : null;
  if (!reading) return error("Not found.", 404);
  if (url.searchParams.get("full") === "1") return json(reading);
  const { contentHtml: _html, contentText: _text, ...summary } = reading;
  return json(summary);
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: "Missing id." }, 400);

  if (!isJsonRequest(request)) return error("Send changes as application/json.", 415);
  const body = await readJsonObject(request);
  if (!body) return json({ error: "Invalid JSON." }, 400);

  const patch: { status?: ReadingStatus; progress?: number; note?: string | null } = {};

  if (body.status !== undefined) {
    if (
      typeof body.status !== "string" ||
      !VALID_STATUS.includes(body.status as ReadingStatus)
    ) {
      return json({ error: "Invalid status." }, 400);
    }
    patch.status = body.status as ReadingStatus;
  }

  if (body.progress !== undefined) {
    if (typeof body.progress !== "number" || !Number.isFinite(body.progress)) {
      return json({ error: "Invalid progress." }, 400);
    }
    // Clamp to 0..1 so the resume bar can trust stored values.
    patch.progress = Math.min(1, Math.max(0, body.progress));
  }

  const note = optionalText(body.note, MAX_NOTE_CHARS);
  if (note === false) return json({ error: "Invalid note." }, 400);
  if (note !== undefined) patch.note = note;

  const updated = updateReadingState(id, patch);
  if (!updated) return json({ error: "Not found." }, 404);
  const { contentHtml: _html, contentText: _text, ...summary } = updated;
  return json(summary, 200);
};

export const DELETE: APIRoute = ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: "Missing id." }, 400);

  if (!getReading(id)) return json({ error: "Not found." }, 404);
  deleteReading(id);
  return new Response(null, { status: 204 });
};
