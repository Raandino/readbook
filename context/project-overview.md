# Project Overview — Readbook

> Always-read. The single source of truth for *what* Readbook is and *where it's headed*.
> Build for the direction in "The Future," not just today's MVP.

## What it is

Readbook is a personal, single-reader **read-it-later** that turns ANY link into ONE calm, book-like reading experience. The entire product is one idea: **heterogeneous links collapse into a single normalized shape (a `Reading`) and render in one distraction-free feed + reader.** A Substack post, a personal blog, a Reddit thread, an X/Twitter thread, and a random URL all become the same consistent, owned format.

**Value proposition:** one owned, consistent format for everything you read — warm, focused, and yours. No accounts, no social graph, no ads, no algorithmic timeline. It's your shelf.

## Who it's for

A single reader (the owner). Explicitly **single-user, no auth** — authentication and multi-user are out of scope. There is no sharing, no social layer, no following.

## The core flow

```
paste a link
  └─▶ extract real article content   (HYBRID: Readability local first, Firecrawl API fallback)
       └─▶ normalize into a Reading   (title, author, clean sanitized HTML, excerpt, lead image,
            │                          word count, reading minutes)
            └─▶ store in local SQLite
                 └─▶ show in a feed of cards
                      └─▶ open a typography-obsessed reader (resume where you left off)
```

## MVP features

- **Paste a link** — a server endpoint accepts any URL and kicks off extraction.
- **Hybrid extraction** — see "Extraction strategy" below.
- **Normalize to a `Reading`** — every source maps cleanly into the one shape (see "Data model").
- **Local-first storage** — Drizzle ORM over better-sqlite3, file at `data/readbook.db`.
- **Feed** — a calm list of cards (title, excerpt, lead image, author/site, reading minutes, status).
- **Reader** — a typography-obsessed long-form view:
  - warm serif body type (Bookerly-style), generous line-height (~1.7), a ~66ch / ~38rem measure;
  - light + sepia + dark themes; adjustable font size;
  - **resume-where-you-left-off** scroll progress (`progress` 0..1 on the `Reading`).
- **Status lifecycle** — `unread → reading → read → archived`.

## The normalized `Reading` data model

The contract lives in **`packages/core/src/index.ts`** and is the source of truth — editing it ripples through `db`, `extractor`, and `web`, so change it deliberately. Key types:

- **`Reading`** — the normalized article + persistence/lifecycle fields:
  `id`, `url`, `source`, `title`, `author`, `siteName`, `contentHtml` (always sanitized, render-ready),
  `contentText`, `excerpt`, `leadImageUrl`, `wordCount`, `readingMinutes`, `publishedAt`, `fetchedAt`,
  `status`, `progress` (0..1 scroll position), `engine`.
- **`ExtractResult`** — what an extractor/adapter returns *before* the db assigns identity/persistence
  fields (no `id`, `status`, `progress`, counts, or `fetchedAt`).
- **`NewReading`** — `ExtractResult` + `wordCount`, `readingMinutes`, `fetchedAt` (db fills `id` and
  `status`/`progress` defaults on insert).
- **`SourceKind`** — `"substack" | "blog" | "reddit" | "x" | "generic"` (`generic` is the catch-all).
- **`ReadingStatus`** — `"unread" | "reading" | "read" | "archived"`.
- **`ExtractorEngine`** — `"readability" | "firecrawl"` (records which engine produced the content, for
  transparency + debugging).
- **`SourceAdapter`** — `{ kind, matches(url), extract(url) }`; an adapter detects whether it owns a URL
  and extracts from it.
- **`ExtractionError`** — thrown when content can't be obtained (carries `url` + `cause`).
- **`WORDS_PER_MINUTE = 220`** — baseline for reading-time estimates.

## Architecture at a glance

A **Turborepo + pnpm** monorepo. Workspaces: `apps/*` and `packages/*`.

```
readbook/
├── apps/
│   └── web/         Astro 7, output: 'server', @astrojs/node standalone adapter (port 4321).
│                    Hosts the paste endpoint, feed, and reader. Server endpoints do extraction +
│                    SQLite reads/writes per request.
└── packages/
    ├── core/        @readbook/core — the shared contracts (the Reading shape). No runtime deps.
    │                Imported by every other package.
    ├── db/          @readbook/db — Drizzle ORM + better-sqlite3. Schema, queries, drizzle.config.ts.
    │                Local file at data/readbook.db (READBOOK_DB_PATH override).
    └── extractor/   @readbook/extractor — hybrid extraction + sanitization. @mozilla/readability +
                     linkedom (local), @mendable/firecrawl-js (fallback), sanitize-html (always).
                     Houses source adapters under src/adapters/.
```

Dependency direction: `core` ← `db`, `extractor`, `web`. `web` depends on all three.

## The hybrid extraction strategy

Heterogeneous links must collapse into one clean `Reading`. Extraction runs in two tiers:

1. **Local Mozilla Readability first** — free and fast. Fetch HTML, parse with `linkedom`, run
   `@mozilla/readability` to pull the real article content. This handles most blogs and Substack.
2. **Firecrawl API as the fallback** — used only when local extraction fails or is insufficient, e.g.
   JavaScript-rendered pages the local reader cannot see. Requires `FIRECRAWL_API_KEY`; **optional** — with no
   key, Readbook is Readability-only and sites that need Firecrawl fail gracefully with a clear
   `ExtractionError`.

**Sanitization is non-negotiable:** all extracted HTML passes through `sanitize-html` before it becomes
`Reading.contentHtml`. Content that reaches the reader is always render-ready and safe. The chosen engine
is recorded on `Reading.engine` for transparency and debugging.

Source-specific adapters (`SourceAdapter`) live in `packages/extractor/src/adapters/` and decide which
`SourceKind` owns a URL; `generic` is the catch-all.

## Tech stack (scaffolded — do NOT change versions)

- **Monorepo:** Turborepo `2.10.0` + pnpm `10.32.1` workspaces. Node `>=22`.
- **Language:** TypeScript `5.9.3`, strict ESM (`module: ESNext`, `moduleResolution: Bundler`,
  `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `isolatedModules`). Target ES2022.
- **Web:** Astro `7.0.2`, `output: 'server'`, `@astrojs/node` `11.0.0` standalone adapter, port 4321.
  Typecheck/lint via `@astrojs/check` `0.9.9` (`astro check`).
- **DB:** Drizzle ORM `0.45.2` + better-sqlite3 `12.11.1`; drizzle-kit `0.31.10` (`db:studio` for inspection; schema changes are migrations in `packages/db/src/client.ts`).
- **Extractor:** `@mozilla/readability` `0.6.0`, `linkedom` `0.18.12`, `sanitize-html` `2.17.5`,
  `@mendable/firecrawl-js` `4.28.3`.

## Constraints / known reality

- **Single-user, no auth** — out of scope; do not add accounts or a social graph.
- **Local-first.** Storage is a local SQLite file; this is intentional for now.
- **Firecrawl is optional** and costs money — keep it the fallback, never the default path.
- **All HTML must be sanitized** before it reaches the reader.
- **Versions are pinned** — do not bump or change the scaffolded stack without explicit request.
- Much of `db`/`extractor`/`web` `src/` is still scaffolding; `packages/core` holds the live contract.

## The future (direction — do NOT build yet)

Build with these in mind, but do not implement until requested:

- **Full-text search** over `contentText`.
- **Tags / collections** to organize the shelf.
- **Highlights / annotations** on readings.
- **RSS auto-ingest** — subscribe to feeds and auto-create readings.
- **Offline** reading.
- **Cloudflare Workers + D1 deploy** — the Astro adapter swaps from `@astrojs/node` to the Cloudflare
  adapter, and `db` moves from better-sqlite3 to D1. The architecture is already shaped for this move
  (server endpoints, per-request reads, the `Reading` contract is storage-agnostic). **OFF LIMITS until
  explicitly requested.**
