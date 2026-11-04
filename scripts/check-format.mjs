#!/usr/bin/env node
// Whitespace hygiene for every file git knows about:  pnpm format:check
//
// Readbook has no Prettier/ESLint (fewer moving parts for contributors); this
// enforces the .editorconfig basics instead: LF line endings, a final newline,
// no trailing whitespace, no tab indentation in source. Exits 1 on any issue.
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { bold, ROOT } from "./lib.mjs";

const TEXT_EXTENSIONS = new Set([
  ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".astro", ".css", ".html", ".json",
  ".md", ".yml", ".yaml", ".toml", ".svg", ".txt", ".example",
]);
const TEXT_NAMES = new Set(["Dockerfile", ".gitignore", ".dockerignore", ".editorconfig", ".nvmrc", "LICENSE"]);
// Markdown uses two trailing spaces as a hard line break; leave it alone there.
const TRAILING_OK = new Set([".md"]);
const NO_TABS = new Set([".ts", ".mts", ".js", ".mjs", ".astro", ".css", ".json", ".yml", ".yaml"]);
const SKIP = [/^pnpm-lock\.yaml$/, /(^|\/)dist\//, /(^|\/)\.astro\//];

// Tracked + untracked-but-not-ignored files, so new files are checked before they're committed.
const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (listed.status !== 0) {
  console.error("format:check needs git (it checks the files git tracks).");
  process.exit(2);
}

const files = [...new Set(listed.stdout.split("\0").filter(Boolean))].filter((file) => {
  if (SKIP.some((re) => re.test(file))) return false;
  const name = file.split("/").pop() ?? file;
  return TEXT_EXTENSIONS.has(extname(file)) || TEXT_NAMES.has(name);
});

const issues = [];
for (const file of files) {
  const path = join(ROOT, file);
  let text;
  try {
    if (!statSync(path).isFile()) continue;
    text = readFileSync(path, "utf8");
  } catch {
    continue; // deleted in the working tree, or a dangling symlink
  }
  if (text.length === 0) continue;
  const ext = extname(file);
  if (text.includes("\r\n")) issues.push(`${file}: CRLF line endings (use LF)`);
  if (!text.endsWith("\n")) issues.push(`${file}: missing final newline`);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (!TRAILING_OK.has(ext) && /[ \t]+\r?$/.test(line)) issues.push(`${file}:${i + 1}: trailing whitespace`);
    if (NO_TABS.has(ext) && /^\t/.test(line)) issues.push(`${file}:${i + 1}: tab indentation (use 2 spaces)`);
  });
}

if (issues.length === 0) {
  console.log(`format:check — ${files.length} files OK`);
} else {
  for (const issue of issues) console.log(`  ${issue}`);
  console.log(bold(`\nformat:check — ${issues.length} issue${issues.length === 1 ? "" : "s"} in ${files.length} files`));
  process.exit(1);
}
