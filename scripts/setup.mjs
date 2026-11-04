#!/usr/bin/env node
// One-command setup:  pnpm run setup   (alias: pnpm bootstrap)
// (`run` is required: bare `pnpm setup` is a pnpm builtin that installs pnpm itself.)
//
// Safe to run any number of times. It never overwrites your .env or touches an
// existing database. Steps:
//   1. check Node and pnpm versions
//   2. install dependencies if they are missing (skip with --no-install)
//   3. create .env from .env.example (only if .env doesn't exist)
//   4. create the folder that will hold the SQLite database
//   5. make sure the native better-sqlite3 module loads
import { spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  bold,
  DEV_PORT,
  detectPnpmVersion,
  dim,
  displayPath,
  ENV_EXAMPLE_PATH,
  ENV_PATH,
  fail,
  heading,
  info,
  loadBetterSqlite,
  MIN_NODE,
  nodeVersionOk,
  ok,
  parseVersion,
  pinnedPnpmVersion,
  resolveDbPath,
  ROOT,
  sqliteHelp,
  warn,
  WEB_DIR,
} from "./lib.mjs";

const skipInstall = process.argv.includes("--no-install");
const rel = displayPath;

console.log(bold("Readbook setup"));

// 1. Toolchain ──────────────────────────────────────────────────────────────
heading("Toolchain");
if (!nodeVersionOk()) {
  fail(`Node ${process.versions.node} is too old — Readbook needs Node ${MIN_NODE.join(".")} or newer.`);
  info("Install the current LTS from https://nodejs.org (or `nvm install` — the repo has an .nvmrc).");
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

const pinned = pinnedPnpmVersion();
const pnpm = detectPnpmVersion();
if (!pnpm) {
  fail("pnpm is not installed.");
  info(`Enable it with Node's bundled Corepack:  corepack enable   (installs pnpm ${pinned ?? ""} on first use)`);
  info("Or see https://pnpm.io/installation");
  process.exit(1);
}
if (pinned && parseVersion(pnpm)?.[0] !== parseVersion(pinned)?.[0]) {
  warn(`pnpm ${pnpm} — this repo is pinned to pnpm ${pinned}. Run  corepack enable  to use the pinned version.`);
} else {
  ok(`pnpm ${pnpm}${pinned && pnpm !== pinned ? dim(` (repo pins ${pinned}; same major, fine)`) : ""}`);
}

// 2. Dependencies ───────────────────────────────────────────────────────────
heading("Dependencies");
const installed = existsSync(join(ROOT, "node_modules", ".modules.yaml")) && existsSync(join(WEB_DIR, "node_modules"));
if (installed) {
  ok("node_modules present");
} else if (skipInstall) {
  warn("Dependencies are not installed (skipped because of --no-install). Run  pnpm install");
} else {
  info("Installing dependencies (pnpm install)…");
  const result = spawnSync("pnpm", ["install"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    fail("pnpm install failed — see the output above.");
    process.exit(1);
  }
  ok("Dependencies installed");
}

// 3. .env ───────────────────────────────────────────────────────────────────
heading("Configuration");
if (existsSync(ENV_PATH)) {
  ok(".env already exists — left untouched");
} else if (!existsSync(ENV_EXAMPLE_PATH)) {
  warn(".env.example is missing; skipping .env (it is optional anyway)");
} else {
  try {
    // COPYFILE_EXCL: never overwrite, even if .env appeared since the check above.
    copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH, constants.COPYFILE_EXCL);
    ok("Created .env from .env.example");
    info("Everything in it is optional; the Settings page can do the same from the browser.");
  } catch (error) {
    if (error?.code === "EEXIST") ok(".env already exists — left untouched");
    else warn(`Could not create .env: ${error instanceof Error ? error.message : error}`);
  }
}

// 4. Data folder ────────────────────────────────────────────────────────────
const dbPath = resolveDbPath();
if (dbPath === ":memory:") {
  warn("READBOOK_DB_PATH is :memory: — your shelf will vanish when the server stops.");
} else {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
    ok(`Database will live at ${rel(dbPath)}${existsSync(dbPath) ? dim(" (exists)") : dim(" (created on first run)")}`);
  } catch (error) {
    fail(`Could not create ${rel(dirname(dbPath))}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

// 5. Native SQLite ──────────────────────────────────────────────────────────
heading("SQLite");
const sqlite = loadBetterSqlite();
if (sqlite.missing) {
  warn("better-sqlite3 is not installed yet. Run  pnpm install  and then this script again.");
  process.exitCode = 1;
} else if (sqlite.error) {
  for (const [i, line] of sqliteHelp(sqlite.error).entries()) (i === 0 ? fail : info)(line);
  process.exit(1);
} else {
  ok(`better-sqlite3 loads (SQLite ${sqlite.version})`);
}

// Next steps ────────────────────────────────────────────────────────────────
heading(sqlite.missing ? "Almost there — install dependencies, then" : "Ready. Next steps");
const step = (cmd, text) => console.log(`  ${cmd.padEnd(17)}${text}`.replace(cmd, bold(cmd)));
step("pnpm dev", `start Readbook → ${bold(`http://localhost:${DEV_PORT}`)}`);
step("Settings page", "optional: add a Firecrawl API key for JS-heavy sites (or FIRECRAWL_API_KEY in .env)");
step("pnpm start", "build and run the production server");
step("pnpm run doctor", "diagnose problems");
console.log("");
