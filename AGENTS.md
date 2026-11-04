# Readbook — Agent Entry

**Readbook** is a personal, single-reader "read-it-later" that turns ANY link — Substack, a blog, a Reddit post, an X/Twitter thread, or any generic URL — into ONE calm, book-like reading experience. Paste a link, the app extracts the real article content (hybrid: local Mozilla Readability first, Firecrawl API as fallback for JavaScript-rendered sites), normalizes it into a single shape called a `Reading`, stores it in local SQLite, and renders it in a distraction-free feed of cards plus a typography-obsessed reader (warm serif, ~66ch measure, light/sepia/dark, resume-where-you-left-off). No accounts, no social graph, no ads, no algorithmic timeline — it is YOUR shelf. Single-user, no auth (out of scope). Local-first now; designed to move to Cloudflare Workers + D1 later.

This file is a **thin entry point**: it routes to context, it is not a dumping ground. Read the always-load files below at the start of every session, then pull in the routing-table docs on demand.

## Always load

Load these every session:

- `@context/project-overview.md` — what Readbook is and where it's headed: product, audience, the `Reading` data model, architecture, hybrid extraction, tech stack, constraints, and the future.
- `@context/coding-standards.md` — enforceable rules for this stack (strict ESM TypeScript, Drizzle, Astro endpoints, sanitize-all-HTML).
- `@context/ai-interaction.md` — how to behave + the feature-workflow state machine + collaboration rules.
- `@context/current-feature.md` — the live workspace for the ONE in-flight feature.
- `PROJECT.md` — human "why" / org context (load if present; the human-layer doc, may not exist yet).

## Load when relevant

| When you're… | Load… |
| ------------ | ----- |
| Reviewing what's already shipped | `context/current-feature-history.md` |
| Implementing a planned feature from a spec | `context/features/<kebab-name>-spec.md` |
| Fixing a bug from a spec | `context/fixes/<kebab-name>-spec.md` |
| Touching the normalized article shape | `packages/core/src/index.ts` (the `Reading` / `ExtractResult` contract — source of truth) |
| Working on extraction (Readability/Firecrawl, adapters, sanitization) | `packages/extractor/src/` + `coding-standards.md` (sanitize rule) |
| Working on persistence (schema, queries, migrations) | `packages/db/src/`, `packages/db/drizzle.config.ts` |
| Working on the UI (feed, reader, paste flow, server endpoints) | `apps/web/src/`, `apps/web/astro.config.mjs` |
| Doing research / writing a plan doc (no code) | `context/research/findings/` |

## Commands

| Task | Command |
| ---- | ------- |
| Dev (all packages, watch) | `pnpm dev` |
| Build | `pnpm build` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Test | `pnpm test` |
| Full CI gate (typecheck + format + test + build) | `pnpm check` |
| First-run setup / diagnostics | `pnpm run setup` / `pnpm run doctor` |
| Production server | `pnpm start` |
| Open Drizzle Studio | `pnpm db:studio` |

- **Branch base:** `main`. One branch per feature/fix off `main`; delete after merge.
- **Commit trailer:** end commit messages with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Commit only after **build + typecheck pass**, and only with explicit permission.

## Environment safety

- `FIRECRAWL_API_KEY` is **optional**. With no key, Readbook runs Readability-only; sites that need Firecrawl fail gracefully with a clear error. Never hardcode the key; read from env. See `.env.example`.
- Local SQLite lives at `data/readbook.db` (override with `READBOOK_DB_PATH`). The `data/*.db` files are gitignored — never commit them.
- **Production / Cloudflare (Workers + D1) is OFF LIMITS** until explicitly requested. Do not add the Cloudflare adapter, D1 bindings, or deploy config on your own. The current target is local Node standalone.

## Hard rules

- **Branch per feature off `main`** — never work directly on `main`.
- **Never commit or push without explicit permission**, and never on a red gate (failing build/typecheck).
- **Don't delete files without asking.**
- **No large, unannounced refactors** — propose first.
- **Ask when unclear** rather than guessing intent or inventing undocumented behavior.
