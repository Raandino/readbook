export const meta = {
  name: 'oss-compliance-review',
  description: 'Open-source readiness audit: licenses, provenance, platform/legal risk, secrets/privacy, security — each verified adversarially',
  whenToUse: 'Before publishing Readbook (or a release) publicly. Read-only: reports findings, changes nothing.',
  phases: [
    { title: 'Audit', detail: 'five independent auditors, one per risk dimension' },
    { title: 'Verify', detail: 'one skeptic per dimension tries to refute each finding' },
  ],
}

// Readbook is a pnpm + turbo monorepo: apps/web (Astro SSR), packages/core|db|extractor.
// Every auditor is READ-ONLY. They may run read-only shell commands (pnpm licenses, git ls-files,
// grep) and web searches, but must never edit, delete, commit, or install anything.

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three sentences: overall verdict for this dimension.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short kebab-case id' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'info'] },
          title: { type: 'string' },
          location: { type: 'string', description: 'file:line, package name, or URL' },
          evidence: { type: 'string', description: 'exact quote / command output proving it' },
          recommendation: { type: 'string', description: 'concrete fix or required attribution text' },
        },
        required: ['id', 'severity', 'title', 'location', 'evidence', 'recommendation'],
      },
    },
    artifacts: {
      type: 'string',
      description: 'Optional ready-to-paste text this dimension produced (e.g. third-party notices table). Empty string if none.',
    },
  },
  required: ['summary', 'findings', 'artifacts'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          refuted: { type: 'boolean', description: 'true if the finding is wrong, overstated, or not reproducible' },
          adjustedSeverity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'info'] },
          reasoning: { type: 'string' },
        },
        required: ['id', 'refuted', 'adjustedSeverity', 'reasoning'],
      },
    },
    missed: {
      type: 'array',
      description: 'Anything important in this dimension the auditor missed (same shape as a finding).',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'info'] },
          title: { type: 'string' },
          location: { type: 'string' },
          evidence: { type: 'string' },
          recommendation: { type: 'string' },
        },
        required: ['id', 'severity', 'title', 'location', 'evidence', 'recommendation'],
      },
    },
  },
  required: ['verdicts', 'missed'],
}

const READ_ONLY = `You are READ-ONLY: never edit, create, delete, install, or commit anything. Read-only shell commands (cat, grep, git ls-files, git status, pnpm licenses list, pnpm why) and web search are fine. Cite exact evidence for every finding; no speculation presented as fact. This is an engineering risk review, not legal advice — say so where it matters.`

const DIMENSIONS = [
  {
    key: 'licenses',
    prompt: `Audit every dependency license in this pnpm monorepo for an MIT-licensed public release.
- Run \`pnpm licenses list --json\` (all deps) and \`pnpm licenses list --prod --json\` from the repo root.
- Classify each license: permissive (MIT/ISC/BSD/Apache-2.0/0BSD/BlueOak/CC0), weak copyleft (LGPL/MPL/EPL), strong copyleft (GPL/AGPL/SSPL), unknown/custom/missing.
- Anything that is not permissive, or whose license is missing/ambiguous, is a finding. Say whether it ships in the production runtime or is dev-only (dev-only build tools are much lower risk).
- Note obligations of an MIT project that redistributes nothing bundled (we ship source, not a bundled binary) vs. obligations if someone builds and distributes the server bundle (Apache-2.0 NOTICE files, attribution). Check whether any Apache-2.0 direct dependency (e.g. @mozilla/readability, drizzle-orm) ships a NOTICE file that must be preserved.
- In \`artifacts\`, produce a ready-to-paste Markdown table of DIRECT runtime dependencies across all workspace package.json files: package | version | license | homepage, plus a one-line note on transitive license families.`,
  },
  {
    key: 'provenance',
    prompt: `Audit CODE AND ASSET PROVENANCE: is any code, algorithm, or asset in this repo copied or derived from a third party in a way that needs attribution or is incompatible with MIT?
- Read every source file under packages/ and apps/web/src (skip node_modules, dist, .astro). Look for comments like "from X", "react-tweet", "borrowed", magic constants or formulas that come from another project (e.g. the X syndication token derivation and feature-flag list in packages/extractor/src/adapters/x.ts — identify the upstream project, its license, and the exact attribution needed).
- Check assets: apps/web/public/* (favicon), any fonts (are web fonts loaded or bundled? what licenses?), root-level *.png screenshots (do they show third-party copyrighted article content or personal data that should not be published as project screenshots?).
- Check repo-tooling files that will be published (.claude/agents, .agents/skills, context/, PROJECT.md, AGENTS.md) for content copied from elsewhere or that is personal/internal and unsuitable for a public repo (e.g. personal names, private notes, TODOs aimed at the owner).
- In \`artifacts\`, draft the exact attribution text for a THIRD_PARTY_NOTICES.md covering any derived code.`,
  },
  {
    key: 'platform-legal',
    prompt: `Assess PLATFORM TERMS, COPYRIGHT, TRADEMARK, and PATENT risk of publishing this tool.
- Read packages/extractor/src (adapters for reddit, x, substack, generic; firecrawl.ts; readability.ts). For each external service it touches (Reddit public .json endpoints, X/Twitter syndication CDN cdn.syndication.twimg.com, Firecrawl API, arbitrary websites with a spoofed desktop Chrome User-Agent) summarize the relevant terms-of-service / robots / API-policy risk using web search on current official policy pages. Distinguish "the project ships code that calls an undocumented endpoint" from "the end user's own use". Recommend mitigations (honest User-Agent option, README disclaimer that users are responsible for complying with site terms, personal-use framing, not redistributing content).
- Copyright: the app stores full article copies locally for personal reading. Note the personal-use framing and any README disclaimer needed.
- Trademark: grep the UI and docs for third-party marks (Kindle, Substack, Reddit, X/Twitter, Firecrawl, Pocket, Instapaper). Flag usages that could imply endorsement (e.g. "Kindle-style" in a tagline) and suggest nominative-fair-use phrasing. Web-search whether the name "Readbook" conflicts with an existing well-known software product/trademark and report what you find (with links).
- Patents: web-search for any well-known patent assertions around read-it-later, article extraction, or text highlighting/annotation anchoring (e.g. W3C Web Annotation text-quote selectors are royalty-free under the W3C patent policy — confirm). Report honestly that a full patent clearance search is out of scope; give a calibrated risk note. MIT has no explicit patent grant — mention the trade-off vs Apache-2.0 briefly.`,
  },
  {
    key: 'secrets-privacy',
    prompt: `Audit SECRETS AND PRIVACY before the first public push. There may be no commits yet; treat everything staged or untracked-but-not-ignored as about to be published.
- Run \`git status --porcelain --untracked-files=all\` and \`git ls-files\` and \`git check-ignore -v\` on suspicious paths. List every file that would be published that should NOT be: .env files, SQLite databases (*.db, *.db-wal, *.db-shm — including under apps/web/data/), logs, .playwright-mcp/ snapshots, .astro/, .turbo/, screenshots containing personal data, editor files.
- Verify .gitignore patterns actually match nested paths (e.g. does \`data/*.db\` match \`apps/web/data/readbook.db\`? — it does NOT if the pattern contains a slash; prove it with git check-ignore).
- Grep tracked/staged content (not node_modules) for secrets: API keys (fc-..., sk-..., ghp_..., AKIA...), tokens, passwords, private emails, absolute home paths (/Users/...), personal names. NEVER print a secret value in your output — redact to the first 4 chars.
- Check .env.example contains no real values.
- Recommend exact .gitignore additions and files to remove from the index (git rm --cached) — but do not run them.`,
  },
  {
    key: 'security',
    prompt: `Threat-model and security-review this LOCAL, single-user, no-auth web app as if a stranger will clone and run it. Read apps/web/src (pages, api endpoints, middleware if any, components with inline scripts), packages/extractor/src, packages/db/src, apps/web/astro.config.mjs.
Consider and verify against the actual code:
- SSRF: the server fetches arbitrary user-supplied URLs (including redirects) — can it hit localhost, 169.254.169.254, private ranges, file:, non-http schemes? Are there timeouts and response-size limits?
- CSRF / cross-origin: can a malicious website the user visits POST to http://localhost:4321/api/* (simple multipart/form requests need no preflight)? Does Astro's security.checkOrigin apply (check the installed astro version's default in node_modules/astro)? DNS-rebinding exposure of GET endpoints (anything that would leak secrets such as an API key)?
- XSS: every set:html sink; sanitize-html allowlist (schemes for href/src/srcset); any inline script that interpolates data; lead image URLs.
- Upload abuse: EPUB zip bombs (fflate unzipSync with no size cap), huge Markdown, 50MB request bodies.
- Secrets handling: FIRECRAWL_API_KEY flows; would a settings API ever echo it back?
- Missing security headers (CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors) and binding to 0.0.0.0 vs localhost.
- Dependency advisories: run \`pnpm audit --json\` (read-only) and summarize real, reachable issues.
Each finding: concrete exploit scenario, file:line, and a minimal fix.`,
  },
]

phase('Audit')
const results = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(`${READ_ONLY}\n\nDIMENSION: ${d.key}\n\n${d.prompt}`, {
      label: `audit:${d.key}`,
      phase: 'Audit',
      schema: FINDINGS,
    }),
  (audit, d) => {
    if (!audit) return null
    if (audit.findings.length === 0) return { dimension: d.key, audit, verify: { verdicts: [], missed: [] } }
    return agent(
      `${READ_ONLY}\n\nYou are a skeptical second reviewer for the "${d.key}" dimension of an open-source readiness audit of this repo. For EACH finding below, independently re-check the evidence against the actual files/commands and try to REFUTE it: is it real, reproducible, and correctly rated? Default to refuted=true only when you can show it is wrong or overstated. Then list anything material the auditor missed in this dimension.\n\nOriginal task the auditor had:\n${d.prompt}\n\nFindings:\n${JSON.stringify(audit.findings, null, 2)}`,
      { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICTS },
    ).then((verify) => ({ dimension: d.key, audit, verify }))
  },
)

const report = results.filter(Boolean).map((r) => {
  const verdicts = new Map((r.verify?.verdicts ?? []).map((v) => [v.id, v]))
  const confirmed = r.audit.findings
    .map((f) => {
      const v = verdicts.get(f.id)
      return v ? { ...f, severity: v.adjustedSeverity, refuted: v.refuted, verifier: v.reasoning } : { ...f, refuted: false, verifier: 'not verified' }
    })
    .filter((f) => !f.refuted)
  const refuted = r.audit.findings.filter((f) => verdicts.get(f.id)?.refuted).map((f) => ({ id: f.id, title: f.title, why: verdicts.get(f.id).reasoning }))
  return {
    dimension: r.dimension,
    summary: r.audit.summary,
    confirmed,
    missedByAuditor: r.verify?.missed ?? [],
    refuted,
    artifacts: r.audit.artifacts,
  }
})

const dropped = DIMENSIONS.length - report.length
if (dropped > 0) log(`${dropped} dimension(s) returned no result — rerun with resume`)
return report
