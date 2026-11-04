---
name: feature
description: Run the feature lifecycle with discrete actions (load | start | test | review | explain | complete) on context/current-feature.md (live) and context/current-feature-history.md (archive). Branch per feature off main; commit only after build + tests pass; guard every action with precondition checks.
argument-hint: load <name|description> | start | test | review | explain | complete
---

# feature

One skill, discrete actions, operating on two working files:

- `@context/current-feature.md` — the **live** workspace for the in-flight feature.
- `@context/current-feature-history.md` — the **append-only archive** of completed work.

You are the architect; the AI is the builder. **Review every diff. Commit only after the
build and tests pass.** Do not enable blanket auto-approve.

## Repo specifics (this repo)

- **Monorepo:** pnpm + turbo, TypeScript, Node >=22. Source of truth is `main`.
- **Test runner:** there is **no unit-test runner in this repo yet**. The verification gate
  is `pnpm typecheck` then `pnpm build` (both run through turbo). When a unit-test runner is
  introduced, add it to the `test` action and to the commit gate.
- **Branch naming:** `feature/<kebab-name>` for features, `fix/<kebab-name>` for fixes,
  branched off `main`. Delete the branch after merge.
- Tests are **by judgment** for now (see the `test` action) — never tests-for-tests'-sake.

## State machine

`current-feature.md` always carries a `## Status` field. Valid states and transitions:

```
(reset / empty)
      │  load
      ▼
 Not Started ──start──▶ In Progress ──complete──▶ (reset to empty)
```

- `test`, `review`, `explain` operate **within** `In Progress` and do not change Status.
- Status values: **Not Started** → **In Progress** → (on complete) reset to empty.

## Guards (run before every action)

Every action begins with precondition checks and fails with a helpful error if unmet:

- Read `@context/current-feature.md` first to learn the current Status and goals.
- If a precondition is unmet, **stop** and tell the user the exact command to run instead.
- Never skip the build/test gate before a commit.

## Per-action behavior

### `load <name|description>`

**Precondition:** none (this is the entry action). If a feature is already In Progress,
warn that loading will overwrite the live file and ask for confirmation.

- **Single-word arg** → treat as a spec name. Load `context/features/<name>.md`
  (try `<name>-spec.md` too). Also check `context/fixes/<name>.md` (and `<name>-spec.md`)
  for fixes. If found, derive Goals from the spec's Goals/Acceptance criteria.
- **Multi-word arg** → treat as an inline description; generate a short Goals list from it.
  (Small features need no spec file.)
- Fill `current-feature.md`: feature **name**, `## Status` = **Not Started**, `## Goals`
  (checkbox list), empty `## Notes`, empty `## History`.
- Report the goals and tell the user to run `/feature start`.

### `start`

**Precondition:** Goals in `current-feature.md` are populated. If not → error:
"No goals loaded — run `/feature load <name>` first."

- Set `## Status` = **In Progress**.
- **Create the branch** off `main`: `feature/<kebab-name>` (or `fix/<kebab-name>` for a fix).
  Confirm the working tree is clean and `main` is current before branching.
- Implement the goals **one by one**, checking each off in `current-feature.md` as it lands.
- Record notable decisions in `## Notes`.

### `test`

**Precondition:** Status = **In Progress**.

- Write unit tests **for server actions & utilities only — not presentational components**.
  Cover **happy path + error cases**. Add tests **by judgment** where meaningful logic lives;
  never write tests for tests' sake.
- **This repo has no unit-test runner yet**, so for now the verification step is to run the
  gate `pnpm typecheck && pnpm build` and report results. When a runner is added, run the
  suite here and make it part of the commit gate.

### `review`

**Precondition:** Status = **In Progress**.

- Check each goal: met (✅), missing (❌), quality/bug concern (⚠️),
  and **scope creep beyond the goals (🚫)**.
- Give a clear verdict: **ready to complete** or **needs changes** (with the specific changes).

### `explain`

**Precondition:** Status = **In Progress**.

- List **every changed file** with a 1–2 line explanation of what changed and how it
  connects to the rest of the system. This is the **anti-vibe-coding step** — the point is
  that the architect understands what was built before it ships.

### `complete`

**Precondition:** Status = **In Progress**, `review` passed, and the gate
`pnpm typecheck && pnpm build` is **green**. If the gate fails → stop, do not commit.

In order:

1. **Commit** on the feature branch (only after the gate passes).
2. **Merge to `main`** and **delete** the feature branch.
3. **Archive the spec** to `context/features/completed/` (or `context/fixes/` archive for a fix).
4. **Append a full entry** to `@context/current-feature-history.md`:
   **Problem / Fix / Files / Verification** (and the date).
5. **Reset** `@context/current-feature.md` to empty placeholder sections, leaving a
   one-line history pointer.
6. **Push once.**

## Conventions

- Branch per feature/fix; delete after merge.
- Guard every action; fail with the exact corrective command.
- Commit only after `pnpm typecheck && pnpm build` pass (add the test suite to the gate
  once a runner exists).
- On `complete` the live file resets and history accumulates — the active file always shows
  only the current work.
- **Direct → execute → approve.** Review every diff; no blanket auto-approve.
- Reference durable context with `@`-mentions (`@context/project-overview.md`,
  `@context/coding-standards.md`).
