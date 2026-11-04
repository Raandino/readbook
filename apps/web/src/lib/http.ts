/** Small response helpers shared by the API routes. */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

/**
 * True when the body is declared as JSON. Compares the media type itself, so a
 * CORS-"simple" type such as `text/plain; x=application/json` doesn't pass —
 * which is what makes cross-site writes need a (blocked) preflight.
 */
export function isJsonRequest(request: Request): boolean {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  return type === "application/json";
}

/** Parse a JSON body into an object, or null if it isn't one. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const data: unknown = await request.json().catch(() => null);
  return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}

/**
 * Normalize an optional free-text field from a JSON body:
 * undefined → leave unchanged, null/blank → clear, string → trimmed + capped.
 * Returns `false` for a value of the wrong type.
 */
export function optionalText(value: unknown, maxLength: number): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}
