# AI Interaction — Readbook

> Always-read. How the agent behaves on this project + the feature-workflow state machine.
> Portable-flavored: reusable across repos, lightly tuned to Readbook's commands and branch base.

## You are the builder, not the architect

The human plans, structures, reviews, and tests; you implement. Treat all your output as **unverified** —
APIs can be hallucinated, plausible code can be buggy. Build verification into the loop (typecheck/build,
read the real code, ask). Decisions that matter get written into `context/` files, not left in chat —
nothing carries across sessions otherwise.

## Behavior & tone

- Be **concise and direct**. Lead with the answer; skip preamble and flattery.
- **Ground claims in the actual code.** Read `packages/core/src/index.ts` (the `Reading` contract) and the
  relevant package before changing it. Don't invent undocumented behavior.
- **Stay in scope.** Implement the stated goals; don't gold-plate or pull in unrelated changes.
- Prefer the smallest change that satisfies the goal.

## Collaboration rules (hard)

- **Ask when unclear.** If intent, the org "why", or a tradeoff is ambiguous, ask rather than guess.
- **Never commit or push without explicit permission.** Don't commit on a red gate (failing build/typecheck).
- **No large, unannounced refactors.** Propose a refactor and get a yes before doing it.
- **Don't delete files without asking.**
- **Branch per feature/fix off `main`** — never work directly on `main`.
- **When stuck after 2–3 failed attempts, stop and explain** — describe what you tried, what failed, and
  your hypotheses, and ask for direction instead of thrashing.

## Environment guardrails

- `FIRECRAWL_API_KEY` is optional; read from env, never hardcode. No key → Readability-only.
- Local SQLite at `data/readbook.db` (`READBOOK_DB_PATH` override); never commit `data/*.db`.
- **Cloudflare (Workers + D1) / production is OFF LIMITS** until explicitly requested.

## The feature workflow (state machine)

The live feature rides two files: **`current-feature.md`** (active workspace) and
**`current-feature-history.md`** (append-only archive). Lifecycle:

```
spec ──▶ not-started ──▶ in-progress ──▶ review ──▶ complete ──▶ history
```

| Action | What it does |
| ------ | ------------ |
| `create-feature` | Clarify with questions first (user problem, users, affected areas, flow, acceptance criteria, edge cases, out-of-scope, constraints), then write `context/features/<kebab-name>-spec.md`. **No branch, no code, doesn't touch `current-feature.md`.** |
| `feature load` | Single-word arg → load `context/features/{name}.md` (also checks `fixes/`); multi-word → inline description + generated goals. Populate `current-feature.md`; Status = **Not Started**. (Small features need no spec file.) |
| `feature start` | Verify goals are populated (else "run load first"); Status = **In Progress**; **create a branch off `main` derived from the feature name** (`feature/<name>` or `fix/<name>`); implement goals one by one. |
| `feature test` | Write unit tests for **server actions & utilities only (not presentational components)**, happy + error cases, by judgment — never tests-for-tests'-sake. Run the suite. |
| `feature review` | Check goals met (✅), missing (❌), quality/bugs (⚠️), **scope creep beyond goals (🚫)**; verdict: ready or needs changes. **No status change.** |
| `feature explain` | Read-only. List every changed file + a 1–2 line explanation of what & why and how it connects. **This is the anti-vibe-coding step.** |
| `feature complete` | Gate (build + tests pass) → **ASK for permission** → commit → merge to `main` → delete branch → archive the spec to `features/completed/` → append a full entry to `current-feature-history.md` → reset `current-feature.md` (+ one-line history entry) → push once. |

### Conventions that make it robust

- **Branch per feature/fix** off `main`; delete after merge.
- **Guard every action** with precondition checks and helpful errors.
- **Commit only after build + typecheck (+ tests) pass**, and only with permission.
- Commit trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- On `complete`, the live file resets and history accumulates — the active file always shows only current work.
- **Direct → execute → approve.** Review every diff; no blanket auto-approve.

## Testing discipline

- Test where logic lives — **server actions, package functions, and utilities; not presentational
  components.** Cover happy path + error cases. Don't chase coverage. Tests sit on top of manual
  verification + a green build, not instead of them.

## Token discipline

- One session per feature → summarize → clear. Keep `current-feature.md` short; archive completed work to
  history. Don't re-read files already in context.
