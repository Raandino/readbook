# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately via
GitHub: **Security → Report a vulnerability** on
<https://github.com/Raandino/readbook/security/advisories/new>.

Include what you found, how to reproduce it, and the impact you expect. You should get an
acknowledgement within a week. Readbook is maintained by one person in their spare time, so
please allow reasonable time for a fix before disclosing publicly.

## Supported versions

Only the latest release on `main` receives fixes.

## Threat model

Readbook is a **single-user, local-first** app with **no login**. Anyone who can reach its
HTTP port controls the shelf (and the saved Firecrawl key). The defaults are built around
that fact:

| Risk | Mitigation |
| --- | --- |
| Exposure to the network | The server binds to `localhost` only. Binding to `0.0.0.0` (`HOST=0.0.0.0`) exposes an unauthenticated app — only do it on a network you trust, and see `READBOOK_ALLOWED_HOSTS`. |
| Cross-site requests from other tabs (CSRF) | Every state-changing request must be same-origin (`Origin` / `Sec-Fetch-Site` checked in `apps/web/src/middleware.ts`, plus Astro's `checkOrigin`). Settings and highlight APIs accept JSON only. |
| DNS rebinding | Requests are refused (`421`) unless the `Host` header is `localhost`, `127.0.0.1`, `[::1]` or listed in `READBOOK_ALLOWED_HOSTS`. |
| SSRF via pasted links | `packages/extractor/src/net.ts` allows only `http(s)`, resolves DNS and refuses loopback, private, link-local (cloud metadata), CGNAT, multicast and reserved addresses **at connect time** (so DNS tricks can't slip past), re-checks every redirect, and enforces a timeout and a size cap. Opt out per install with *Settings → Allow private network*. Refused links are never forwarded to Firecrawl. |
| Malicious article HTML (XSS) | All extracted HTML goes through a strict `sanitize-html` allowlist (no scripts, styles, iframes, forms, event handlers; only `http`/`https`/`mailto` links and `http`/`https` images) before it is stored. Backups are re-sanitized on import. A strict Content-Security-Policy (hashed scripts, no `unsafe-inline`) is the second layer. |
| Hostile uploads | 50 MB upload cap; EPUBs are decompressed entry-by-entry with per-entry, total and entry-count limits (zip-bomb guard); only text entries are inflated. |
| Secret leakage | The Firecrawl key is stored in your local SQLite file (or `.env`), is never sent back to the browser (only a masked preview), and is never logged. `.env` and `*.db` are git-ignored. |
| Tracking by image hosts | Article images load with `referrerpolicy="no-referrer"` and the app sends `Referrer-Policy: no-referrer`. |

### Known limitations

- There is no authentication. If you need remote access, put Readbook behind an
  authenticating reverse proxy or a VPN (e.g. Tailscale) rather than exposing the port.
- Your shelf, highlights and settings (including a saved Firecrawl key) are stored
  unencrypted in `data/readbook.db`. Protect that file like any other personal data.
- `@mendable/firecrawl-js` currently depends on `zod` 3.x, which has a memory-exhaustion
  advisory for validating oversized attacker-controlled collections. Readbook only passes
  its own small request objects to the SDK, so the issue is not reachable from user input;
  it will be resolved when the SDK moves to zod 4.

## Dependency hygiene

CI runs `pnpm audit --prod`, and Dependabot proposes weekly dependency updates.
