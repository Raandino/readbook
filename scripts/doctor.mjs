#!/usr/bin/env node
// Read-only diagnostics:  pnpm run doctor
// (`run` is required: bare `pnpm doctor` is a pnpm builtin that checks pnpm itself.)
//
// Prints what Readbook will see when it starts — versions, config, database,
// port — and changes nothing. Secrets are never printed, only whether they are
// set. Exits 1 when something will stop the app from running.
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { connect } from "node:net";
import { dirname } from "node:path";
import {
  bold,
  DEV_PORT,
  detectPnpmVersion,
  dim,
  displayPath,
  ENV_EXAMPLE_PATH,
  ENV_PATH,
  envValue,
  fail,
  heading,
  info,
  loadBetterSqlite,
  MIN_NODE,
  nodeVersionOk,
  ok,
  parseVersion,
  pinnedPnpmVersion,
  readDotEnv,
  resolveDbPath,
  ROOT,
  sqliteHelp,
  warn,
} from "./lib.mjs";

let problems = 0;
const problem = (msg) => {
  problems++;
  fail(msg);
};
const rel = displayPath;

console.log(bold("Readbook doctor") + dim("  (read-only)"));

// Toolchain ─────────────────────────────────────────────────────────────────
heading("Toolchain");
if (nodeVersionOk()) ok(`Node ${process.versions.node} ${dim(`(${process.platform}-${process.arch})`)}`);
else problem(`Node ${process.versions.node} — needs ${MIN_NODE.join(".")} or newer`);

const pinned = pinnedPnpmVersion();
const pnpm = detectPnpmVersion();
if (!pnpm) problem("pnpm not found — run  corepack enable");
else if (pinned && parseVersion(pnpm)?.[0] !== parseVersion(pinned)?.[0]) warn(`pnpm ${pnpm} (repo pins ${pinned})`);
else ok(`pnpm ${pnpm}${pinned ? dim(` (repo pins ${pinned})`) : ""}`);

const sqlite = loadBetterSqlite();
if (sqlite.missing) problem("Dependencies not installed — run  pnpm install  (or  pnpm run setup)");
else if (sqlite.error) {
  problems++;
  for (const [i, line] of sqliteHelp(sqlite.error).entries()) (i === 0 ? fail : info)(line);
} else ok(`better-sqlite3 loads (SQLite ${sqlite.version})`);

// Configuration ─────────────────────────────────────────────────────────────
heading("Configuration");
const dotEnv = readDotEnv();
if (existsSync(ENV_PATH)) ok(".env present");
else info(`No .env (optional${existsSync(ENV_EXAMPLE_PATH) ? "; `pnpm run setup` creates one from .env.example" : ""})`);

const show = (name, { secret = false, fallback = "not set" } = {}) => {
  const { value, source } = envValue(name, dotEnv);
  const set = value !== undefined && value.trim() !== "";
  const shown = !set ? dim(fallback) : secret ? "set" : JSON.stringify(value);
  info(`${name.padEnd(30)} ${shown}${set && source ? dim(` (from ${source})`) : ""}`);
};
show("FIRECRAWL_API_KEY", { secret: true, fallback: "not set (Readability-only unless set in Settings)" });
show("READBOOK_DB_PATH", { fallback: "default (data/readbook.db)" });
show("READBOOK_ALLOWED_HOSTS", { fallback: "not set (localhost only)" });
show("READBOOK_ALLOW_PRIVATE_NETWORK", { fallback: "not set (private addresses blocked)" });
show("READBOOK_USER_AGENT", { fallback: "not set (Readbook's default)" });
show("READBOOK_FIRECRAWL_PROXY", { fallback: "not set (basic)" });
show("HOST", { fallback: "not set (localhost)" });
show("PORT", { fallback: `not set (${DEV_PORT})` });
info(dim("Values saved on the Settings page override these."));

// Database ──────────────────────────────────────────────────────────────────
heading("Database");
const dbPath = resolveDbPath(dotEnv);
if (dbPath === ":memory:") {
  warn("READBOOK_DB_PATH is :memory: — nothing is saved between restarts");
} else {
  info(`Path: ${dbPath}`);
  if (existsSync(dbPath)) {
    try {
      accessSync(dbPath, constants.R_OK | constants.W_OK);
      accessSync(dirname(dbPath), constants.W_OK); // SQLite writes -wal/-shm files beside it
      ok(`Exists and is writable ${dim(`(${(statSync(dbPath).size / 1024).toFixed(0)} KB)`)}`);
    } catch {
      problem(`${rel(dbPath)} (or its folder) is not writable by this user`);
    }
    describeDatabase(dbPath);
  } else {
    // Find the nearest existing ancestor: that is where the folder would be created.
    let dir = dirname(dbPath);
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
    try {
      accessSync(dir, constants.W_OK);
      ok(`Not created yet — it will be on first run ${dim(`(${rel(dir)} is writable)`)}`);
    } catch {
      problem(`Cannot create the database: ${dir} is not writable`);
    }
  }
}

/** Open read-only to report schema version and counts. Never writes. */
function describeDatabase(path) {
  if (!sqlite.Database) return;
  let db;
  try {
    db = new sqlite.Database(path, { readonly: true, fileMustExist: true });
    const version = db.pragma("user_version", { simple: true });
    const tables = new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map((r) => r.name));
    const count = (table) => (tables.has(table) ? db.prepare(`select count(*) as n from ${table}`).get().n : 0);
    info(`Schema version ${version}; ${count("readings")} readings, ${count("highlights")} highlights`);
    if (tables.has("settings")) {
      const key = db.prepare("select 1 from settings where key = 'firecrawlApiKey'").get();
      info(`Firecrawl key saved in Settings: ${key ? "yes" : "no"}`);
    }
  } catch (error) {
    warn(`Could not read the database: ${error instanceof Error ? error.message : error}`);
  } finally {
    db?.close();
  }
}

// Network ───────────────────────────────────────────────────────────────────
heading("Network");
// Probe by connecting rather than binding: nothing is opened on the port, and
// it catches a server on either 127.0.0.1 or ::1.
const probe = (port) =>
  new Promise((resolve) => {
    const socket = connect({ port, host: "localhost", autoSelectFamily: true, timeout: 2000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(null);
    });
    socket.once("error", (error) => resolve(error.code === "ECONNREFUSED" ? true : null));
  });
// `pnpm dev` always uses 4321; PORT only moves the production server.
const prodPort = Number(envValue("PORT", dotEnv).value) || DEV_PORT;
const ports = [
  [DEV_PORT, prodPort === DEV_PORT ? "pnpm dev / pnpm start" : "pnpm dev"],
  ...(prodPort === DEV_PORT ? [] : [[prodPort, "pnpm start (PORT)"]]),
];
for (const [port, use] of ports) {
  const free = await probe(port);
  if (free === true) ok(`Port ${port} is free ${dim(`(${use})`)}`);
  else if (free === false) warn(`Port ${port} is in use ${dim(`(${use})`)} — is Readbook already running? Otherwise stop that process${port === DEV_PORT ? "" : " or change PORT"}.`);
  else warn(`Could not check port ${port}`);
}

// Summary ───────────────────────────────────────────────────────────────────
console.log("");
if (problems === 0) console.log(`${bold("All good.")} Start with  ${bold("pnpm dev")}  → http://localhost:${DEV_PORT}`);
else console.log(bold(`${problems} problem${problems === 1 ? "" : "s"} found — fix the ✗ items above.`));
process.exit(problems === 0 ? 0 : 1);
