# Open-source readiness review

Before Readbook's first public release, its code, dependencies, assets and integrations
went through a structured review. The review is repeatable: it ships as a Claude Code
workflow at [`.claude/workflows/oss-compliance-review.js`](../.claude/workflows/oss-compliance-review.js).
Five independent read-only auditors (licenses, code provenance, platform and legal risk,
secrets and privacy, security) each produce findings with evidence. A second, skeptical
reviewer per dimension then tries to refute every finding and lists anything the first one
missed. Run it again before any major release.

> This is an engineering risk review, not legal advice.

## Results (November 2026)

### Licenses: clear for MIT

- No GPL, AGPL or SSPL dependency anywhere in the tree. All 10 direct runtime dependencies
  are MIT, ISC or Apache-2.0. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- **Fixed:** the repo had no `LICENSE` and no `license` fields. Added an MIT `LICENSE` and
  `"license": "MIT"` to every package.
- **Fixed:** the optional `sharp`/`libvips` (LGPL) image stack is disabled, since Readbook
  doesn't use image optimization.
- Build-time-only MPL-2.0 tooling (`lightningcss`) needs no action for a source release.

### Code provenance

- The X adapter's syndication token formula and feature-flag list were adapted from
  Vercel's MIT-licensed `react-tweet`. **Fixed:** attribution added in the source and in
  THIRD_PARTY_NOTICES.md.
- The favicon and icons are original. No web fonts are bundled; the app uses system fonts
  only.

### Third-party content: kept out of the repository

- **Fixed:** browser-automation snapshots (`.playwright-mcp/`) and development screenshots
  contained copyrighted articles from other sites and the author's reading history. They
  were removed from the commit and are now git-ignored. The README screenshots use
  public-domain text and the project's own notes.
- **Fixed:** a stray local database under `apps/web/data/` was not ignored. The ignore
  rules now match database files at any depth, and the database path always resolves to
  one place (`<repo>/data/readbook.db`).

### Platform terms

- **Fixed:** fetches no longer pretend to be desktop Chrome. Readbook sends an honest,
  identifiable User-Agent (`Mozilla/5.0 (compatible; Readbook/x.y; +repo)`), and Reddit
  gets the descriptive `<platform>:<app>:<version>` format its API rules require. Users can
  override the generic UA in Settings, at their own responsibility.
- **Fixed:** Firecrawl's stealth-proxy escalation is now opt-in (default `basic`). Docs
  describe Firecrawl as a fallback for JavaScript-rendered pages, never as a way around
  logins or paywalls.
- **Documented:** the X adapter uses an unofficial, undocumented public endpoint that may
  break. The README's *Responsible use* section explains personal-use framing, copyright,
  and non-affiliation.
- **Added:** a "Read the original" link in the reader, which credits the source and sends
  readers back to it.

### Trademarks and name

- UI copy no longer uses "Kindle-style". It now says "book-like" or "e-reader-style". The
  README carries a non-affiliation notice for Substack, Reddit, X, Firecrawl and Kindle.
- At least one other reader app uses the name "Readbook". No registered mark turned up,
  but this was not a clearance search. That's fine for a free open-source project. Run a
  proper search before any commercial use or app-store listing.

### Patents

- No known patent assertions target read-it-later, readability-style extraction or
  text-quote highlight anchoring, which are long-commoditized techniques. The anchoring
  follows the W3C Web Annotation model, published under the royalty-free W3C Patent Policy.
  MIT contains no explicit patent grant. If explicit contributor patent grants become
  important, Apache-2.0 is the usual alternative.

### Secrets and privacy

- The local `.env` holds a real Firecrawl key. It was always ignored and never staged, and
  `.env.*` variants are now ignored too.
- **To do before the first commit:** choose the git identity to publish. A GitHub
  `noreply` email keeps your personal address out of the history.

### Security

All findings were fixed. See [SECURITY.md](../SECURITY.md) for the threat model:

- SSRF guard at connect time, with timeouts and size caps
- Host allowlist against DNS rebinding
- Same-origin checks on writes
- A strict hashed-script CSP
- Zip-bomb limits on EPUB uploads
- A request body size cap
- Upgrades for astro, @astrojs/node, sanitize-html and @mendable/firecrawl-js to clear
  known advisories

## Re-running the review

In Claude Code, from the repo root:

```text
run the oss-compliance-review workflow
```

The workflow is read-only. It returns confirmed findings, refuted findings with reasons,
and anything the auditors missed.
