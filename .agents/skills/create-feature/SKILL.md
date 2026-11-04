---
name: create-feature
description: Turn a rough feature idea into a concrete, implementation-ready spec by asking clarifying questions first, then writing context/features/<kebab-name>-spec.md. Does NOT implement, branch, or touch current-feature.md.
argument-hint: <rough idea in a sentence or two>
---

# create-feature

Turn a rough idea into a reviewable spec. This skill **plans only** — it never
writes code, never creates a branch, and never touches `context/current-feature.md`.
Most important feature prompts are documents, not chat — that is how you stay in control.

## What this skill does NOT do

- Does not implement anything.
- Does not create or switch git branches.
- Does not modify `@context/current-feature.md` or `@context/current-feature-history.md`.
- Stops once the spec file is written. Implementation is the `feature` skill's job.

## Procedure

### 1. Read the idea and the project context

- The argument is the rough idea. If empty, ask the user what they want to build.
- Skim `@context/project-overview.md` and `@context/coding-standards.md` so the spec
  fits the actual product, stack (pnpm + turbo monorepo, TypeScript, Node >=22), and conventions.

### 2. Ask clarifying questions FIRST — do not skip this

Before writing anything, ask the user the questions needed to fill every section of the
template. Group them; ask only what is genuinely unclear from the idea + context. Cover:

- **Problem** — what user problem does this solve, and why now?
- **Users** — who is this for? Which roles/personas?
- **Goals** — what does success look like, as a short list of outcomes?
- **Affected areas** — which apps/packages, routes, data models, or modules are touched?
- **Flow** — the step-by-step user/system flow.
- **Acceptance criteria** — concrete, checkable conditions for "done".
- **Edge cases** — empty/error/loading states, permissions, concurrency, limits.
- **Out of scope** — what we are explicitly NOT doing.
- **Constraints** — performance, accessibility, dependencies, deadlines, compatibility.

Wait for answers. Iterate if answers reveal new unknowns. Do not guess past a real ambiguity.

### 3. Derive the spec file name

- Convert the feature name to **kebab-case**: lowercase, words joined by `-`,
  no spaces or punctuation. Example: "Reading streak tracker" → `reading-streak-tracker`.
- Target path: `context/features/<kebab-name>-spec.md`.
- If that file already exists, tell the user and ask whether to overwrite or pick a new name.

### 4. Write the spec

- Copy the structure from `@.agents/skills/feature/spec-template.md` and fill **every**
  section with the answers gathered. No empty placeholders — if a section truly has nothing,
  write "None" rather than leaving the template text.
- Keep it concrete and implementation-ready: a builder should be able to start from it
  without re-asking the basics.

### 5. Confirm and hand off

- Report the path written.
- Remind the user that nothing was implemented and no branch was created.
- Tell them the next step: `/feature load <kebab-name>` to pull goals into
  `current-feature.md`, then `/feature start`.
