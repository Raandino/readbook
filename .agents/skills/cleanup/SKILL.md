---
name: cleanup
description: Dry-run-by-default maintenance pass. Report numbered findings and change NOTHING until told which to fix. Verify context files match reality, order the history file, and remove cruft (unused imports, stale TODOs, orphaned files, dead code).
argument-hint: [optional scope hint] | fix <numbers> | fix all
---

# cleanup

A maintenance skill that is **dry-run by default**. It reports, it does not edit — until the
user explicitly tells it which findings to apply.

## Default mode: report only

When invoked with no `fix` argument:

1. **Change nothing.** No file edits, no commits, no branches.
2. Scan and produce a **numbered list of findings**. Each finding has:
   - a number,
   - a category (see below),
   - the file path (+ line if relevant),
   - the problem in one line,
   - the proposed fix in one line.
3. End by telling the user how to apply: `cleanup fix <numbers>` or `cleanup fix all`.

## What to check

### 1. Context files match reality

- `@context/current-feature.md`: does its Status/Goals reflect the actual working tree and
  branch? Flag stale "In Progress" features with nothing in flight, or a missing/empty live
  file when a feature branch exists.
- `@context/project-overview.md` and `@context/coding-standards.md`: flag claims that no
  longer match the code (e.g. referenced scripts, paths, or stack versions that drifted).
- Verify referenced commands still exist in `package.json`
  (`pnpm dev | build | lint | typecheck | test | check | db:studio`).

### 2. Order the history file

- `@context/current-feature-history.md` should be ordered consistently (newest-first or
  oldest-first — pick the file's existing convention and make it uniform). Flag out-of-order
  or duplicated entries, and entries missing Problem / Fix / Files / Verification.

### 3. Remove cruft

- Unused imports and unreferenced exports.
- Stale `TODO` / `FIXME` comments (resolved or obsolete).
- Orphaned files (specs in `context/features/` for shipped work not archived to
  `completed/`; dead modules nothing imports).
- Dead code, commented-out blocks, hardcoded values that should be config.
- Empty or leftover skeleton dirs without `.gitkeep` where one is expected.

## Verify findings before reporting (zero false positives)

- Read the actual code/file before flagging — do not report from a hunch.
- Do not flag things that are intentionally not implemented yet.
- Do not flag what the framework/turbo/pnpm toolchain already handles.

## Apply mode: `fix <numbers>` / `fix all`

Only when the user passes `fix`:

- Apply exactly the selected numbered findings (or all of them for `fix all`).
- After edits, run the verification gate `pnpm typecheck && pnpm build` and report results.
- Do **not** commit unless the user asks; cleanup edits should flow through normal review.
- Re-report any findings that could not be safely auto-applied.
