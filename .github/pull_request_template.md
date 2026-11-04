## What & why

<!-- What does this change, and why? Link the issue it closes: "Closes #123". -->

## How I tested it

<!-- Steps a reviewer can follow. Screenshots for UI changes (light, sepia and dark; desktop and a narrow phone width). -->

## Checklist

- [ ] `pnpm check` passes (typecheck, format check, tests, build)
- [ ] New logic has tests where it reasonably can (`*.test.ts` next to the code)
- [ ] Extracted or user HTML only reaches the page through `sanitizeHtml` (no new `set:html`)
- [ ] No inline scripts, inline event handlers or `style=""` from user data (the CSP forbids them)
- [ ] UI works in all three themes and at ≤ 400px wide
- [ ] No secrets, personal data or local databases committed
- [ ] Docs / `.env.example` updated if behavior or configuration changed
