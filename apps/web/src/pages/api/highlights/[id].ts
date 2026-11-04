/**
 * /api/highlights/[id]
 *   PATCH  {color?, note?} — recolor a highlight and/or edit its note (null/"" clears it).
 *   DELETE                 — remove it (204).
 */
import type { APIRoute } from "astro";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@readbook/core";
import { deleteHighlight, getHighlight, updateHighlight } from "@readbook/db";
import { error, json, optionalText, readJsonObject, isJsonRequest } from "../../../lib/http";

export const prerender = false;

const MAX_NOTE_CHARS = 5_000;

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return error("Missing id.", 400);
  if (!isJsonRequest(request)) {
    return error("Send JSON (Content-Type: application/json).", 415);
  }
  const body = await readJsonObject(request);
  if (!body) return error("Invalid JSON.", 400);

  const patch: { color?: HighlightColor; note?: string | null } = {};

  if (body.color !== undefined) {
    if (typeof body.color !== "string" || !HIGHLIGHT_COLORS.includes(body.color as HighlightColor)) {
      return error(`color must be one of: ${HIGHLIGHT_COLORS.join(", ")}.`, 400);
    }
    patch.color = body.color as HighlightColor;
  }

  if (typeof body.note === "string" && body.note.length > MAX_NOTE_CHARS) {
    return error(`note is longer than ${MAX_NOTE_CHARS} characters.`, 400);
  }
  const note = optionalText(body.note, MAX_NOTE_CHARS);
  if (note === false) return error("note must be a string or null.", 400);
  if (note !== undefined) patch.note = note;

  const updated = updateHighlight(id, patch);
  if (!updated) return error("Highlight not found.", 404);
  return json(updated);
};

export const DELETE: APIRoute = ({ params }) => {
  const id = params.id;
  if (!id) return error("Missing id.", 400);
  if (!getHighlight(id)) return error("Highlight not found.", 404);
  deleteHighlight(id);
  return new Response(null, { status: 204 });
};

