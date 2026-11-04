# Coding Standards — Readbook

> Always-read. Concrete, enforceable rules for THIS stack. Portable-flavored: the TypeScript and
> "where logic lives" rules travel between repos; the Drizzle/Astro/extractor sections are Readbook-specific.

## TypeScript & modules (strict ESM)

- **ESM everywhere.** Every package is `"type": "module"`. No CommonJS, no `require`. Use `import`/`export`.
- **`verbatimModuleSyntax` is on** — use **`import type` / `export type`** for anything used only as a
  type. Mixing a type-only symbol into a value import is a compile error. Prefer:
  ```ts
  import type { Reading, ExtractResult } from "@readbook/core";
  import { ExtractionError, WORDS_PER_MINUTE } from "@readbook/core"; // values
  ```
- **`noUncheckedIndexedAccess` is on** — indexing an array/record yields `T | undefined`. Never assume an
  index hit; guard it (`const first = rows[0]; if (!first) …`) or use `.at()` with a check. No non-null
  `!` to paper over this.
- **`strict` is on** — no implicit `any`, handle `null`/`undefined` explicitly. Avoid `any`; reach for
  `unknown` + narrowing when a type is genuinely open (e.g. caught errors, external JSON).
- **`noImplicitOverride`** — annotate overrides with `override`.
- **`isolatedModules`** — keep modules independently transpilable (already implied by the ESM rules).
- **Import workspace packages by name**, not deep relative paths: `@readbook/core`, `@readbook/db`,
  `@readbook/extractor`. `core` is the only thing the others may all import; respect the dependency
  direction (`core` ← `db`/`extractor`/`web`) — never make `core` depend on anything.
- **Pin versions.** Do not change the scaffolded dependency versions without explicit request.

## The `Reading` contract

- **`packages/core/src/index.ts` is the source of truth.** Any change to `Reading` / `ExtractResult` /
  `NewReading` ripples through `db`, `extractor`, and `web`. Edit deliberately and update all consumers in
  the same change.
- **Map every source into the one shape.** New source support means a new `SourceAdapter` producing a
  valid `ExtractResult` — never a parallel shape or a special-case field bolted onto `Reading`.
- Throw **`ExtractionError`** (with the `url`) for unrecoverable extraction failures — don't return a
  half-filled object or a bare `Error`.

## HTML sanitization (non-negotiable)

- **All extracted HTML MUST pass through `sanitize-html` before it becomes `Reading.contentHtml`.**
  There is no path where raw fetched/Readability/Firecrawl HTML reaches the reader unsanitized.
- Sanitization belongs in the **extractor**, not the web layer. By the time HTML leaves `@readbook/extractor`
  it is render-ready and safe.
- In Astro, render sanitized content with `set:html` only on already-sanitized strings. Never `set:html`
  raw external input.

## Extraction patterns

- **Readability first, Firecrawl as fallback.** Local `@mozilla/readability` + `linkedom` is the default
  path; only fall back to `@mendable/firecrawl-js` when local extraction fails or is insufficient (JS-heavy
  / JavaScript-rendered pages). Never use it to get around logins or paywalls.
- **Firecrawl is optional.** Read `FIRECRAWL_API_KEY` from env; if absent, skip Firecrawl and let
  sites that need it fail with a clear `ExtractionError`. Never hardcode the key. Never make Firecrawl the
  default path (it costs money).
- Record the engine actually used on `ExtractResult.engine` (`"readability" | "firecrawl"`).
- Source adapters live in `packages/extractor/src/adapters/`, one file per `SourceKind`; `matches(url)`
  decides ownership, `generic` is the catch-all.

## Drizzle / database patterns

- **Schema** lives in `packages/db/src/schema.ts`; config in `packages/db/drizzle.config.ts`
  (dialect `sqlite`, output `./drizzle`). The DB layer owns identity (`id`) and `status`/`progress`
  defaults — keep those out of extractor code.
- **Schema changes are migrations.** Append a step to `MIGRATIONS` in `packages/db/src/client.ts`
  (tracked with `PRAGMA user_version`; never edit a shipped step) and mirror it in `schema.ts`. The app
  migrates on startup. Use `pnpm db:studio` only to inspect. Don't hand-edit the SQLite file.
- **Keep queries in `@readbook/db`**, exposed as named functions — the web layer calls db functions, it
  does not build Drizzle queries inline in a page/endpoint.
- **DB path** comes from `READBOOK_DB_PATH` (defaults to `data/readbook.db`). Never commit `data/*.db`.
- Design schema with the **D1 migration in mind** — keep it standard SQLite, no Node-only assumptions
  baked into the data layer.

## Astro / web patterns

- **`output: 'server'`** — this is an on-demand-rendered app. Use **server endpoints** (`src/pages/api/*.ts`
  or `.astro` with server logic) for the paste/extract/store flow and per-request feed reads.
- Endpoints are thin: parse/validate input → call `@readbook/extractor` and/or `@readbook/db` →
  return a response. **Business logic lives in the packages, not in route files.**
- Validate and normalize the pasted URL before extraction; return clear errors (surface
  `ExtractionError` messages to the user calmly).
- Keep the reader's typography rules (serif, ~1.7 line-height, ~66ch/~38rem measure, themes, font-size)
  in shared styles/layout, not duplicated per page.

## Where logic lives

| Concern | Home |
| ------- | ---- |
| The `Reading` contract & shared types | `packages/core` |
| Fetching, Readability/Firecrawl, adapters, **sanitization** | `packages/extractor` |
| Schema, queries, identity, persistence | `packages/db` |
| HTTP endpoints, feed/reader UI, request handling | `apps/web` |

Presentational Astro components hold no business logic. Server actions/utilities and package functions are
where the testable logic lives.

## Naming & style

- **Files:** `kebab-case.ts`. **Types/interfaces/classes:** `PascalCase`. **Functions/vars:** `camelCase`.
  **Constants:** `SCREAMING_SNAKE_CASE` (e.g. `WORDS_PER_MINUTE`).
- Adapter files named for their `SourceKind` (e.g. `reddit.ts`, `generic.ts`).
- Prefer small, named, single-purpose functions; avoid deep nesting — early-return on guards.
- Use the project formatter/`astro check` output as truth; fix lint/typecheck before committing.
