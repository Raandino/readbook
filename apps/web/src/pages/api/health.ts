/**
 * GET /api/health — a cheap liveness check (used by the Docker HEALTHCHECK).
 * Touches the database so "healthy" means "can actually serve your shelf".
 */
import type { APIRoute } from "astro";
import { READBOOK_VERSION } from "@readbook/core";
import { countHighlights } from "@readbook/db";
import { json } from "../../lib/http";

export const prerender = false;

export const GET: APIRoute = () => {
  try {
    countHighlights();
    return json({ ok: true, version: READBOOK_VERSION });
  } catch {
    return json({ ok: false }, 503);
  }
};
