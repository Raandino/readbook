# Contributing to Readbook

Thanks for wanting to make Readbook better. It is a small, opinionated project: a calm,
local-first place to read. Contributions that keep it calm, private and dependable are very
welcome.

## Before you start

- **Bugs:** open an issue with steps to reproduce. For extraction bugs, include the URL.
  The bug template asks for the rest.
- **Features:** open an issue first so we can agree on the shape before you write code.
  Readbook deliberately has no accounts, no social features and no algorithmic feed, so
  ideas in that direction will probably be declined.
- **Security issues:** don't open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

Requirements: **Node.js ≥ 22.12** and **pnpm** (the exact version is pinned in
`package.json` → `packageManager`; `corepack enable` installs it for you).

```sh
git clone https://github.com/Raandino/readbook.git
cd readbook
pnpm install
pnpm run setup      # checks your toolchain, creates .env and data/ (safe to re-run)
pnpm dev            # http://localhost:4321
```

`pnpm run doctor` prints read-only diagnostics if something doesn't work.

## Project layout

```
apps/web            Astro (SSR, Node adapter): pages, API routes, UI, middleware
packages/core       The shared contract: the `Reading` and `Highlight` types
packages/db         SQLite via Drizzle + better-sqlite3: schema, migrations, queries
packages/extractor  Fetching (SSRF-guarded), Readability/Firecrawl, source adapters, sanitizing
```

Dependency direction: `core` ← `db` / `extractor` ← `web`. `core` depends on nothing.

## The rules that matter

1. **All extracted HTML is sanitized in the extractor** (`packages/extractor/src/sanitize.ts`)
   before it is stored. Only `Reading.contentHtml` may be rendered with `set:html`.
2. **All outbound fetches go through `safeFetch`** (`packages/extractor/src/net.ts`). Never call
   `fetch()` directly on a user-supplied URL.
3. **No inline `<script is:inline>` bodies or `define:vars`.** The Content-Security-Policy only
   allows hashed, bundled scripts. Pass server data to scripts with `data-*` attributes. The one
   exception is the external, blocking `/theme-init.js` in `Base.astro`, which prevents a theme
   flash and is allowed by `'self'`.
4. **Mutating API routes accept JSON** and validate every field. Business logic lives in
   `packages/*` or `apps/web/src/lib`, not in route files.
5. **Schema changes are new migrations.** Append a step to `MIGRATIONS` in
   `packages/db/src/client.ts`. Never edit a shipped step.
6. **New source adapters** implement `SourceAdapter` (`packages/core`), live in
   `packages/extractor/src/adapters/`, and must produce a normal `ExtractResult`. Use an
   honest User-Agent and respect the site's published terms.
7. TypeScript is strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Use
   `import type` for types.

## Checks

```sh
pnpm typecheck   # tsc + astro check across the monorepo
pnpm test        # vitest unit tests
pnpm build       # production build
pnpm check       # typecheck + format check + tests + build — what CI runs
```

Tests live next to the code as `*.test.ts`. Database tests run against an in-memory SQLite
database (`READBOOK_DB_PATH=:memory:`); call `closeDb()` in `beforeEach` to get a fresh one.

## Pull requests

- Keep PRs focused: one feature or fix each.
- Add or update tests for behavior changes.
- Check UI changes in **all three themes** (light, sepia, dark) and at phone width.
- Make sure `pnpm check` passes.
- Use a clear title, e.g. `extractor: handle Substack custom domains`.

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
