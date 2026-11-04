// Shared helpers for scripts/setup.mjs and scripts/doctor.mjs.
// Plain Node ESM with zero dependencies: these must run before `pnpm install`.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Namespace import: a named import of a missing export would crash old Node
// versions before we get the chance to print a friendly version error.
import * as util from "node:util";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WEB_DIR = join(ROOT, "apps", "web");
export const ENV_PATH = join(ROOT, ".env");
export const ENV_EXAMPLE_PATH = join(ROOT, ".env.example");

/** Minimum Node version (Astro 7 requires ^22.12). Keep in sync with package.json "engines". */
export const MIN_NODE = [22, 12, 0];
export const DEV_PORT = 4321;

// ── Output ──────────────────────────────────────────────────────────────────

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : String(text));
export const bold = paint("1");
export const dim = paint("2");
const green = paint("32");
const yellow = paint("33");
const red = paint("31");

export const ok = (msg) => console.log(`  ${green("✓")} ${msg}`);
export const warn = (msg) => console.log(`  ${yellow("!")} ${msg}`);
export const fail = (msg) => console.log(`  ${red("✗")} ${msg}`);
export const info = (msg) => console.log(`    ${dim(msg)}`);
export const heading = (msg) => console.log(`\n${bold(msg)}`);

/** Repo-relative path for display; absolute when it lives outside the repo. */
export function displayPath(path) {
  const rel = relative(ROOT, path);
  return rel === "" ? "." : rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}

// ── Versions ────────────────────────────────────────────────────────────────

/** "22.12.0" → [22, 12, 0]; tolerates a leading "v" and pre-release suffixes. */
export function parseVersion(raw) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(raw));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** -1 / 0 / 1 like a sort comparator. */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

export function nodeVersionOk() {
  const current = parseVersion(process.versions.node);
  return current !== null && compareVersions(current, MIN_NODE) >= 0;
}

/** The pnpm version pinned in the root package.json "packageManager" field, e.g. "10.32.1". */
export function pinnedPnpmVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    return /^pnpm@(\d+\.\d+\.\d+)/.exec(pkg.packageManager ?? "")?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The pnpm version in use: from npm_config_user_agent when run via `pnpm run`,
 * otherwise by asking the `pnpm` on PATH. Null when pnpm is not installed.
 */
export function detectPnpmVersion() {
  const agent = process.env.npm_config_user_agent ?? "";
  const fromAgent = /\bpnpm\/(\d+\.\d+\.\d+)/.exec(agent)?.[1];
  if (fromAgent) return fromAgent;
  const result = spawnSync("pnpm", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 15_000,
  });
  if (result.status !== 0) return null;
  return parseVersion(result.stdout)?.join(".") ?? null;
}

// ── Environment ─────────────────────────────────────────────────────────────

/** Values from the root .env (without touching process.env), or {} if there is none. */
export function readDotEnv() {
  if (!existsSync(ENV_PATH)) return {};
  try {
    const text = readFileSync(ENV_PATH, "utf8");
    if (typeof util.parseEnv === "function") return util.parseEnv(text);
    // Minimal fallback for Node versions without util.parseEnv (KEY=value lines only).
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
    return values;
  } catch {
    return {};
  }
}

/**
 * Where a variable's effective value comes from. Mirrors Node's --env-file and
 * process.loadEnvFile, which never override a variable already in the shell.
 */
export function envValue(name, dotEnv = readDotEnv()) {
  if (process.env[name] !== undefined) return { value: process.env[name], source: "shell" };
  if (dotEnv[name] !== undefined) return { value: dotEnv[name], source: ".env" };
  return { value: undefined, source: null };
}

/** Same rules as resolveDbPath() in packages/db/src/client.ts. */
export function resolveDbPath(dotEnv = readDotEnv()) {
  const fromEnv = envValue("READBOOK_DB_PATH", dotEnv).value?.trim();
  if (fromEnv === ":memory:") return fromEnv;
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(ROOT, fromEnv);
  return join(ROOT, "data", "readbook.db");
}

// ── Native module ───────────────────────────────────────────────────────────

/** better-sqlite3 as the web app sees it, or null if dependencies aren't installed. */
export function loadBetterSqlite() {
  const require = createRequire(join(WEB_DIR, "package.json"));
  try {
    require.resolve("better-sqlite3");
  } catch {
    return { Database: null, error: null, missing: true };
  }
  try {
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    const version = db.prepare("select sqlite_version() as v").get().v;
    db.close();
    return { Database, version, error: null, missing: false };
  } catch (error) {
    return { Database: null, error, missing: false };
  }
}

/** Platform-specific advice for a better-sqlite3 that won't load. */
export function sqliteHelp(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lines = [`better-sqlite3 failed to load: ${message.split("\n")[0]}`];
  if (/NODE_MODULE_VERSION|was compiled against a different Node/i.test(message)) {
    lines.push("It was built for a different Node version. Rebuild it with:  pnpm -r rebuild better-sqlite3");
  } else {
    lines.push("It is a native module: pnpm downloads a prebuilt binary, or compiles one if none matches.");
    lines.push("If compiling failed, install build tools and run  pnpm -r rebuild better-sqlite3 :");
    if (process.platform === "darwin") lines.push("  macOS:   xcode-select --install");
    else if (process.platform === "win32") lines.push('  Windows: Visual Studio Build Tools with the "Desktop development with C++" workload');
    else lines.push("  Linux:   sudo apt install python3 make g++   (or your distro's equivalent)");
  }
  return lines;
}
