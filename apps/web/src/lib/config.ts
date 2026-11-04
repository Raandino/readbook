/**
 * Runtime configuration, resolved per request so a change on the Settings page
 * takes effect immediately without a restart.
 *
 * Precedence: a value saved in Settings (SQLite) wins, then the environment
 * (`.env` / shell), then the built-in default. That way `.env` keeps working
 * for people who prefer it, and the UI is the zero-config path for everyone else.
 */
import type { ExtractOptions } from "@readbook/core";
import { getSetting, maskSecret } from "@readbook/db";

export type ConfigSource = "settings" | "env" | "default";

export interface ResolvedSecret {
  configured: boolean;
  source: ConfigSource;
  /** Masked preview for the UI ("fc-1…9f2c"); never the raw value. */
  preview: string | null;
}

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function firecrawlApiKey(): { value: string | null; source: ConfigSource } {
  const saved = getSetting("firecrawlApiKey");
  if (saved) return { value: saved, source: "settings" };
  const env = process.env.FIRECRAWL_API_KEY?.trim();
  if (env) return { value: env, source: "env" };
  return { value: null, source: "default" };
}

export function allowPrivateNetwork(): { value: boolean; source: ConfigSource } {
  const saved = getSetting("allowPrivateNetwork");
  if (saved !== null) return { value: saved === "true", source: "settings" };
  if (process.env.READBOOK_ALLOW_PRIVATE_NETWORK !== undefined) {
    return { value: envFlag("READBOOK_ALLOW_PRIVATE_NETWORK"), source: "env" };
  }
  return { value: false, source: "default" };
}

/** Custom User-Agent for page fetches; null = Readbook's honest default. */
export function userAgent(): { value: string | null; source: ConfigSource } {
  const saved = getSetting("userAgent");
  if (saved) return { value: saved, source: "settings" };
  const env = process.env.READBOOK_USER_AGENT?.trim();
  if (env) return { value: env, source: "env" };
  return { value: null, source: "default" };
}

/** Firecrawl proxy mode: "basic" unless the reader opted into "auto" (stealth escalation). */
export function firecrawlProxy(): { value: "basic" | "auto"; source: ConfigSource } {
  const saved = getSetting("firecrawlProxy");
  if (saved === "auto" || saved === "basic") return { value: saved, source: "settings" };
  const env = process.env.READBOOK_FIRECRAWL_PROXY?.trim();
  if (env === "auto" || env === "basic") return { value: env, source: "env" };
  return { value: "basic", source: "default" };
}

/** What the extractor needs for one run. */
export function extractOptions(): ExtractOptions {
  return {
    firecrawlApiKey: firecrawlApiKey().value,
    allowPrivateNetwork: allowPrivateNetwork().value,
    userAgent: userAgent().value,
    firecrawlProxy: firecrawlProxy().value,
  };
}

/** Safe-to-render description of the Firecrawl key (for the Settings page / API). */
export function describeFirecrawlKey(): ResolvedSecret {
  const { value, source } = firecrawlApiKey();
  return { configured: Boolean(value), source, preview: value ? maskSecret(value) : null };
}
