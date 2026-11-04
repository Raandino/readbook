/**
 * /api/settings
 *   GET — the effective configuration and where each value comes from.
 *   PUT — save any subset of settings (JSON only); `null` clears one so it
 *         falls back to the environment / default.
 *
 * The Firecrawl key is write-only from the browser's point of view: responses
 * carry a masked preview, never the key itself, and nothing here logs values.
 */
import type { APIRoute } from "astro";
import { READBOOK_USER_AGENT } from "@readbook/core";
import { setSetting, type SettingKey } from "@readbook/db";
import { allowPrivateNetwork, describeFirecrawlKey, firecrawlProxy, userAgent } from "../../lib/config";
import { error, json, readJsonObject, isJsonRequest } from "../../lib/http";

export const prerender = false;

const MAX_KEY_CHARS = 200;

const MAX_UA_CHARS = 300;
/** Visible ASCII only (no spaces): safe inside an Authorization header. */
const KEY_PATTERN = /^[\x21-\x7E]+$/;
/** Printable ASCII incl. space: a User-Agent goes straight into an HTTP header. */
const UA_PATTERN = /^[\x20-\x7E]+$/;

function currentSettings() {
  return {
    firecrawlApiKey: describeFirecrawlKey(),
    firecrawlProxy: firecrawlProxy(),
    allowPrivateNetwork: allowPrivateNetwork(),
    userAgent: userAgent(),
    defaultUserAgent: READBOOK_USER_AGENT,
  };
}

export const GET: APIRoute = () => json(currentSettings());

type Parsed = { ok: true; value: string | null } | { ok: false; message: string };

/** Each validator maps a JSON value to the stored string (null = clear) or an error. */
const VALIDATORS: Record<SettingKey, (value: unknown) => Parsed> = {
  firecrawlApiKey(value) {
    if (value === null) return { ok: true, value: null };
    if (typeof value !== "string") return { ok: false, message: "firecrawlApiKey must be a string or null." };
    const key = value.trim();
    if (!key) return { ok: true, value: null };
    if (key.length > MAX_KEY_CHARS) {
      return { ok: false, message: `That key is too long (max ${MAX_KEY_CHARS} characters).` };
    }
    if (!KEY_PATTERN.test(key)) {
      return { ok: false, message: "That key contains spaces or unusual characters. Paste it exactly as Firecrawl shows it." };
    }
    return { ok: true, value: key };
  },
  firecrawlProxy(value) {
    if (value === null || value === "basic" || value === "auto") return { ok: true, value };
    return { ok: false, message: 'firecrawlProxy must be "basic", "auto", or null.' };
  },
  allowPrivateNetwork(value) {
    if (value === null) return { ok: true, value: null };
    if (typeof value === "boolean") return { ok: true, value: String(value) };
    return { ok: false, message: "allowPrivateNetwork must be true, false, or null." };
  },
  userAgent(value) {
    if (value === null) return { ok: true, value: null };
    if (typeof value !== "string") return { ok: false, message: "userAgent must be a string or null." };
    const ua = value.trim();
    if (!ua) return { ok: true, value: null };
    if (ua.length > MAX_UA_CHARS) {
      return { ok: false, message: `That User-Agent is too long (max ${MAX_UA_CHARS} characters).` };
    }
    if (!UA_PATTERN.test(ua)) {
      return { ok: false, message: "A User-Agent can only contain plain printable ASCII characters." };
    }
    return { ok: true, value: ua };
  },
};

function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(VALIDATORS, key);
}

export const PUT: APIRoute = async ({ request }) => {
  if (!isJsonRequest(request)) return error("Send settings as application/json.", 415);

  const body = await readJsonObject(request);
  if (!body) return error("Invalid JSON: expected an object of settings.", 400);

  // Validate everything first so a bad field never leaves a half-saved state.
  const updates: Array<[SettingKey, string | null]> = [];
  for (const [key, value] of Object.entries(body)) {
    if (!isSettingKey(key)) return error(`Unknown setting "${key.slice(0, 64)}".`, 400);
    const parsed = VALIDATORS[key](value);
    if (!parsed.ok) return error(parsed.message, 400);
    updates.push([key, parsed.value]);
  }

  for (const [key, value] of updates) setSetting(key, value);
  return json(currentSettings());
};
