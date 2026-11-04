# Current Feature

## Status

In Progress — **Open-source release (v0.1)**

## Goals

- Publish Readbook on GitHub under MIT, with a license, provenance and security review
  (`docs/open-source-review.md`, re-runnable via `.claude/workflows/oss-compliance-review.js`).
- Anyone can clone and run it with `pnpm install && pnpm run setup && pnpm dev`; no `.env` required
  (Firecrawl key etc. configurable on the Settings page).
- Security hardening: SSRF-guarded fetches, Host allowlist + same-origin middleware, strict CSP,
  upload/zip-bomb limits, dependency advisories cleared.
- New reading features: highlights + notes, notebook, written notes, feed search/filters/archive,
  backup/restore.
- Tests (vitest) + CI + contributor docs.

## Notes

**Extraction status:**
- generic/blog + Substack → Readability, honest `Readbook/x.y` User-Agent (overridable in Settings).
- X/Twitter → public syndication CDN (unofficial; may break). Firecrawl refuses x.com.
- Reddit → `.json` endpoint with Reddit's required descriptive UA; often 403s unauthenticated.
  Robust support needs the official Reddit OAuth API (good next feature).
- Hybrid: non-X/non-Reddit sources retry via Firecrawl when Readability is thin/fails, only when a
  key is configured. Links refused by the SSRF guard are never forwarded to Firecrawl.
- Firecrawl proxy defaults to `basic`; `auto` (stealth escalation) is opt-in.

**Before the first public push (owner):** choose the git identity to publish (a GitHub noreply
email keeps a personal address out of history), create the `Raandino/readbook` repo, and enable
private vulnerability reporting.

## History

- Bootstrapped the AI Context System (entry chain + always-read context + working files + skeleton).
- Scaffolded the Turborepo monorepo (apps/web Astro 7, packages/core|db|extractor) and shipped a
  verified vertical slice: paste link → hybrid extract → SQLite → calm feed + reader (typecheck/build green).
- Local file upload (EPUB / Markdown) as Readings.
