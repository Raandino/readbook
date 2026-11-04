/**
 * GET /api/highlights/export[?readingId=…]
 *
 * Every highlight (and reading-note) as a Markdown download, grouped by
 * Reading. With ?readingId, just that one Reading. Built in lib/notebook.ts.
 */
import type { APIRoute } from "astro";
import { getReading, listAllHighlights, listHighlights, listReadingSummaries } from "@readbook/db";
import { error } from "../../../lib/http";
import { buildNotebook, exportFilename, notebookToMarkdown } from "../../../lib/notebook";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const exportedAt = new Date().toISOString();
  const readingId = url.searchParams.get("readingId");

  let markdown: string;
  let filename: string;
  if (readingId) {
    const reading = getReading(readingId);
    if (!reading) return error("Reading not found.", 404);
    markdown = notebookToMarkdown(buildNotebook(listHighlights(readingId), [reading]), exportedAt);
    filename = exportFilename(exportedAt, reading.title);
  } else {
    markdown = notebookToMarkdown(buildNotebook(listAllHighlights(), listReadingSummaries()), exportedAt);
    filename = exportFilename(exportedAt);
  }

  return new Response(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // The filename is slugged to [a-z0-9-] so it needs no quoting tricks.
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
