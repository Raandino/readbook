# Third-party notices

Readbook is released under the [MIT License](LICENSE).

## Code adapted from other projects

### react-tweet

- Project: <https://github.com/vercel/react-tweet>
- Upstream file: `packages/react-tweet/src/api/fetch-tweet.ts`
- Used in: `packages/extractor/src/adapters/x.ts`
- What was adapted: the syndication API token derivation (`getToken` → `token()`) and the
  `features` query-parameter list sent to `https://cdn.syndication.twimg.com/tweet-result`.
- License: MIT

```
The MIT License (MIT)

Copyright (c) 2023 Luis Alvarez.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Standards

Highlight anchoring follows the idea of the W3C
[Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) `TextQuoteSelector`
(quote + prefix + suffix). W3C Recommendations are published under the royalty-free
[W3C Patent Policy](https://www.w3.org/policies/patent-policy/). No W3C code is included.

## npm dependencies

Readbook installs its dependencies from npm; none are vendored into this repository, and each
package ships with its own license. Direct runtime dependencies:

| Package | License | Homepage |
| --- | --- | --- |
| astro | MIT | <https://astro.build> |
| @astrojs/node | MIT | <https://docs.astro.build/en/guides/integrations-guide/node/> |
| better-sqlite3 | MIT | <https://github.com/WiseLibs/better-sqlite3> |
| drizzle-orm | Apache-2.0 | <https://orm.drizzle.team> |
| @mozilla/readability | Apache-2.0 | <https://github.com/mozilla/readability> |
| @mendable/firecrawl-js | MIT (the SDK package; the Firecrawl server repo is AGPL and is **not** used — Readbook only calls the hosted API) | <https://www.npmjs.com/package/@mendable/firecrawl-js> |
| fflate | MIT | <https://github.com/101arrowz/fflate> |
| linkedom | ISC | <https://github.com/WebReflection/linkedom> |
| marked | MIT | <https://marked.js.org> |
| sanitize-html | MIT | <https://github.com/apostrophecms/sanitize-html> |

The transitive production tree is almost entirely permissive (MIT, ISC, BSD, Apache-2.0,
BlueOak, CC0). No GPL, AGPL or SSPL packages are included. Two weak-copyleft packages arrive
through Astro's toolchain and are **not** part of the built server: `lightningcss` (MPL-2.0,
build-time CSS tooling) and `libvips` (LGPL, via the optional `sharp` image library, which
Readbook disables with `ignoredOptionalDependencies` because it does not use image
optimization).

**If you redistribute a built bundle or a container image** (rather than this source), the
bundle inlines third-party code whose licenses require their notices to travel with it
(Apache-2.0 §4 for Readability and drizzle-orm; copyright lines for MIT/BSD packages).
Generate a complete notice file for your artifact with:

```sh
pnpm licenses list --prod --long
```
