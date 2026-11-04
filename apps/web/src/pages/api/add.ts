/**
 * POST /api/add — the one ingress for the whole product.
 *
 * Paste a link / upload a file / write a note -> validate -> dedupe -> extract
 * -> persist -> return id. Dedupe returns the existing Reading so re-adding a
 * link is idempotent and calm rather than an error.
 *
 * Accepts either JSON (`{ url }` or `{ note: { title?, body } }`) or a
 * multipart form with `url` or `file`.
 */
import type { APIRoute } from "astro";
import { findByUrl, insertReading } from "@readbook/db";
import { extract, extractFile, extractNote } from "@readbook/extractor";
import { ExtractionError, type NewReading } from "@readbook/core";
import { extractOptions } from "../../lib/config";
import { error, isJsonRequest, json } from "../../lib/http";

export const prerender = false;

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_NOTE_CHARS = 500_000;
const MAX_URL_CHARS = 4_096;

type AddInput =
  | { kind: "url"; value: string }
  | { kind: "file"; value: File }
  | { kind: "note"; title: string | null; body: string };

/** Accept JSON posts (url or note) and multipart form posts (url or file). */
async function readInput(request: Request): Promise<AddInput | null> {
  if (isJsonRequest(request)) {
    const data = (await request.json().catch(() => null)) as { url?: unknown; note?: unknown } | null;
    if (typeof data?.url === "string") return { kind: "url", value: data.url };
    const note = data?.note as { title?: unknown; body?: unknown } | undefined;
    if (note && typeof note.body === "string") {
      return { kind: "note", title: typeof note.title === "string" ? note.title : null, body: note.body };
    }
    return null;
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (file instanceof File && file.size > 0) {
    return { kind: "file", value: file };
  }
  const value = form?.get("url");
  return typeof value === "string" ? { kind: "url", value } : null;
}

/** Store a freshly extracted Reading unless its URL is already on the shelf. */
function save(extracted: NewReading): Response {
  const existing = findByUrl(extracted.url);
  if (existing) return json({ id: existing.id, deduped: true }, 200);
  const reading = insertReading(extracted);
  return json({ id: reading.id }, 201);
}

function failure(err: unknown, what: string): Response {
  if (err instanceof ExtractionError) return error(err.message, 422);
  console.error(`[readbook] unexpected error reading ${what}:`, err);
  return error(`Something went wrong reading that ${what}.`, 500);
}

/**
 * A plain HTML form post (JavaScript off) navigates the browser to this
 * endpoint; answer it with a redirect back to the shelf instead of raw JSON.
 */
function isFormNavigation(request: Request): boolean {
  return !isJsonRequest(request) && (request.headers.get("accept") ?? "").includes("text/html");
}

async function respondForNavigation(response: Response): Promise<Response> {
  const body = (await response.clone().json().catch(() => ({}))) as { id?: string; deduped?: boolean };
  const target = new URL("/", "http://localhost");
  if (body.id) {
    target.searchParams.set("added", body.id);
    if (body.deduped) target.searchParams.set("deduped", "1");
  } else {
    // A fixed code, never free text: the shelf maps it to its own message, so a
    // crafted link can't make the page display arbitrary words.
    const code = response.status === 413 ? "too_large" : response.status === 422 ? "unreadable" : response.status === 400 ? "invalid" : "unknown";
    target.searchParams.set("add_error", code);
  }
  return new Response(null, { status: 303, headers: { Location: `${target.pathname}${target.search}` } });
}

export const POST: APIRoute = async ({ request }) => {
  const response = await handleAdd(request);
  return isFormNavigation(request) ? respondForNavigation(response) : response;
};

async function handleAdd(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + 1024 * 1024) {
    return error("Files must be 50 MB or smaller.", 413);
  }

  const input = await readInput(request);
  if (!input) {
    return error("Paste a link, write a note, or upload an EPUB/Markdown file.", 400);
  }

  if (input.kind === "file") {
    const file = input.value;
    if (file.size > MAX_FILE_BYTES) return error("Files must be 50 MB or smaller.", 413);
    try {
      return save(await extractFile({ name: file.name, type: file.type, data: await file.arrayBuffer() }));
    } catch (err) {
      return failure(err, "file");
    }
  }

  if (input.kind === "note") {
    if (input.body.length > MAX_NOTE_CHARS) return error("That note is too long.", 413);
    try {
      return save(await extractNote({ title: input.title?.slice(0, 300) ?? null, body: input.body }));
    } catch (err) {
      return failure(err, "note");
    }
  }

  const raw = input.value.trim();
  if (!raw) return error("Please paste a link.", 400);
  if (raw.length > MAX_URL_CHARS) return error("That link is too long.", 400);

  // Normalize/validate up front so obviously broken input fails fast and cheap.
  let url: string;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return error("Only http and https links can be read.", 400);
    }
    url = parsed.toString();
  } catch {
    return error("That doesn't look like a valid URL.", 400);
  }

  const existing = findByUrl(url);
  if (existing) return json({ id: existing.id, deduped: true }, 200);

  try {
    return save(await extract(url, extractOptions()));
  } catch (err) {
    return failure(err, "link");
  }
}
