// @ts-check
import { fileURLToPath } from "node:url";
import { defineConfig, passthroughImageService } from "astro/config";
import node from "@astrojs/node";

// The app reads its config from process.env (FIRECRAWL_API_KEY,
// READBOOK_DB_PATH, ...). Load the repo-root .env into process.env so they
// resolve in `astro dev` / `astro build` / `astro preview`. Uses Node's built-in
// env-file loader (no extra deps) and never overrides variables already set in
// the shell. This file is NOT evaluated by the built server: `pnpm start` loads
// the same .env with `node --env-file-if-exists` (see apps/web/package.json),
// and Docker/hosted deploys pass real environment variables instead.
const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
try {
  process.loadEnvFile(envPath);
} catch {
  // No .env present — that's fine (Readability-only mode).
}

// On-demand rendering: Readbook needs server endpoints (paste a link -> extract
// -> store) and per-request feed reads from SQLite. Node standalone adapter runs
// this locally. (A Cloudflare Workers + D1 target is planned; see context/.)
export default defineConfig({
  output: "server",
  // Cap request bodies just above the largest route limit (200 MB backup
  // restore); /api/add enforces its own 50 MB upload limit.
  adapter: node({ mode: "standalone", bodySizeLimit: 201 * 1024 * 1024 }),
  // No image optimization: saved articles hotlink their original images, and
  // skipping sharp keeps the (LGPL) libvips binaries out of the install.
  image: { service: passthroughImageService() },
  // Bind to localhost only. There is no login: anyone who can reach this port
  // owns the shelf. See README → "Reading from another device" before changing.
  server: { port: 4321, host: false },
  security: {
    // Same-origin checks for form posts (on by default; explicit on purpose).
    checkOrigin: true,
    // Astro hashes every script/style it renders into a CSP <meta> tag, so
    // inline scripts work without 'unsafe-inline'. Images may come from any
    // http(s) host because saved articles reference their original images.
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' https: http: data:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-src 'none'",
      ],
    },
  },
  vite: {
    ssr: {
      // better-sqlite3 is a native CJS module — it must be require()'d at
      // runtime, never bundled into the ESM server (bundling breaks its
      // __filename-based binding loader).
      external: ["better-sqlite3"],
    },
  },
});
