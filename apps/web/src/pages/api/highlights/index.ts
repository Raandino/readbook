/**
 * /api/highlights
 *   GET  ?readingId=…  — that Reading's highlights (in the order they were made).
 *   POST {readingId, quote, prefix, suffix, color, note?} — save a new highlight.
 *
 * Anchoring is text-quote based (see lib/anchor.ts): the client sends the exact
 * quoted text plus up to a few dozen characters of context on each side.
 */
import type { APIRoute } from "astro";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@readbook/core";
import { createHighlight, getReading, listHighlights } from "@readbook/db";
import { error, json, optionalText, readJsonObject, isJsonRequest } from "../../../lib/http";

export const prerender = false;

const MAX_QUOTE_CHARS = 5_000;
const MAX_CONTEXT_CHARS = 64;
const MAX_NOTE_CHARS = 5_000;

export const GET: APIRoute = ({ url }) => {
  const readingId = url.searchParams.get("readingId");
  if (!readingId) return error("readingId is required.", 400);
  if (!getReading(readingId)) return error("Reading not found.", 404);
  return json(listHighlights(readingId));
};

export const POST: APIRoute = async ({ request }) => {
  if (!isJsonRequest(request)) {
    return error("Send JSON (Content-Type: application/json).", 415);
  }
  const body = await readJsonObject(request);
  if (!body) return error("Invalid JSON.", 400);

  const { readingId, quote, color } = body;
  if (typeof readingId !== "string" || !readingId) return error("readingId is required.", 400);
  if (typeof quote !== "string" || !quote.trim()) return error("quote is required.", 400);
  if (quote.length > MAX_QUOTE_CHARS) return error(`quote is longer than ${MAX_QUOTE_CHARS} characters.`, 400);
  if (typeof color !== "string" || !HIGHLIGHT_COLORS.includes(color as HighlightColor)) {
    return error(`color must be one of: ${HIGHLIGHT_COLORS.join(", ")}.`, 400);
  }

  const context: Record<"prefix" | "suffix", string> = { prefix: "", suffix: "" };
  for (const key of ["prefix", "suffix"] as const) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || value.length > MAX_CONTEXT_CHARS) {
      return error(`${key} must be a string of at most ${MAX_CONTEXT_CHARS} characters.`, 400);
    }
    context[key] = value;
  }

  if (typeof body.note === "string" && body.note.length > MAX_NOTE_CHARS) {
    return error(`note is longer than ${MAX_NOTE_CHARS} characters.`, 400);
  }
  const note = optionalText(body.note, MAX_NOTE_CHARS);
  if (note === false) return error("note must be a string.", 400);

  if (!getReading(readingId)) return error("Reading not found.", 404);

  const highlight = createHighlight({
    readingId,
    quote,
    prefix: context.prefix,
    suffix: context.suffix,
    color: color as HighlightColor,
    note: note ?? null,
  });
  return json(highlight, 201);
};

