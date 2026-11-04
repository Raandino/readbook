import { describe, expect, it } from "vitest";
import { safeHttpUrl, sanitizeHtml } from "./sanitize";

const BASE = "https://blog.example/posts/2024/essay.html";

describe("sanitizeHtml — stripping", () => {
  it("drops script, style, iframe, form and object elements with their contents", () => {
    const out = sanitizeHtml(
      [
        "<p>keep</p>",
        "<script>alert(1)</script>",
        "<style>body{display:none}</style>",
        '<iframe src="https://evil.example"></iframe>',
        '<form action="/x"><input name="a"></form>',
        '<object data="x.swf"></object>',
      ].join(""),
    );
    expect(out).toBe("<p>keep</p>");
  });

  it("strips inline event handlers and style attributes", () => {
    const out = sanitizeHtml('<p onclick="alert(1)" style="color:red" class="x" id="y">hi</p>');
    expect(out).toBe("<p>hi</p>");
    const img = sanitizeHtml('<img src="https://cdn.example/a.png" onerror="alert(1)" onload="x()">');
    expect(img).not.toMatch(/onerror|onload|alert/);
  });

  it("unwraps unknown tags but keeps their text", () => {
    expect(sanitizeHtml("<div><span>hello</span> <section>world</section></div>")).toBe("hello world");
  });

  it("keeps the reader-grade allowlist", () => {
    const html =
      "<h2>T</h2><blockquote><p><em>a</em> <strong>b</strong></p></blockquote><pre><code>x</code></pre><ul><li>1</li></ul><hr /><figure><figcaption>c</figcaption></figure>";
    const out = sanitizeHtml(html);
    for (const tag of ["h2", "blockquote", "em", "strong", "pre", "code", "ul", "li", "hr", "figure", "figcaption"]) {
      expect(out).toContain(`<${tag}`);
    }
  });

  it("escapes text so entities can't become markup", () => {
    expect(sanitizeHtml("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });
});

describe("sanitizeHtml — links", () => {
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
  ])("drops dangerous href %j", (href) => {
    for (const base of [undefined, BASE]) {
      const out = sanitizeHtml(`<a href="${href}">x</a>`, base);
      expect(out).not.toMatch(/href=/);
      expect(out).toContain(">x</a>");
    }
  });

  it("drops protocol-relative hrefs when there is no base", () => {
    expect(sanitizeHtml('<a href="//evil.example/x">x</a>')).not.toMatch(/href=/);
  });

  it("always opens links in a new tab with noopener noreferrer", () => {
    const out = sanitizeHtml('<a href="https://other.example/" target="_self" rel="opener">x</a>');
    expect(out).toBe('<a href="https://other.example/" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it("keeps mailto links", () => {
    expect(sanitizeHtml('<a href="mailto:me@example.com">mail</a>')).toContain('href="mailto:me@example.com"');
  });

  it("absolutizes relative hrefs against baseUrl", () => {
    expect(sanitizeHtml('<a href="/about">a</a>', BASE)).toContain('href="https://blog.example/about"');
    expect(sanitizeHtml('<a href="next.html">a</a>', BASE)).toContain('href="https://blog.example/posts/2024/next.html"');
    expect(sanitizeHtml('<a href="#notes">a</a>', BASE)).toContain(
      'href="https://blog.example/posts/2024/essay.html#notes"',
    );
    expect(sanitizeHtml('<a href="//cdn.example/x">a</a>', BASE)).toContain('href="https://cdn.example/x"');
  });

  it("leaves relative hrefs alone without a base (they stay relative)", () => {
    expect(sanitizeHtml('<a href="/about">a</a>')).toContain('href="/about"');
  });
});

describe("sanitizeHtml — images", () => {
  it("forces lazy loading and no-referrer, overriding the source's values", () => {
    const out = sanitizeHtml('<img src="https://cdn.example/a.png" alt="A" loading="eager" referrerpolicy="unsafe-url">');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('referrerpolicy="no-referrer"');
    expect(out).not.toContain("eager");
    expect(out).not.toContain("unsafe-url");
    expect(out).toContain('alt="A"');
  });

  it("absolutizes src against baseUrl", () => {
    expect(sanitizeHtml('<img src="/img/a.png">', BASE)).toContain('src="https://blog.example/img/a.png"');
    expect(sanitizeHtml('<img src="b.png">', BASE)).toContain('src="https://blog.example/posts/2024/b.png"');
  });

  it("absolutizes every srcset candidate and keeps descriptors", () => {
    const out = sanitizeHtml('<img src="a.jpg" srcset="a.jpg 1x, /b.jpg 2x,  https://cdn.example/c.jpg 800w">', BASE);
    const srcset = /srcset="([^"]*)"/.exec(out)?.[1];
    expect(srcset).toBe(
      "https://blog.example/posts/2024/a.jpg 1x, https://blog.example/b.jpg 2x, https://cdn.example/c.jpg 800w",
    );
  });

  it("refuses data:, javascript: and mailto: image sources", () => {
    for (const src of ["data:image/png;base64,AAAA", "javascript:alert(1)", "mailto:a@b.c"]) {
      expect(sanitizeHtml(`<img src="${src}">`, BASE)).not.toMatch(/src=/);
    }
  });

  it("drops non-allowlisted image attributes", () => {
    const out = sanitizeHtml('<img src="https://cdn.example/a.png" width="10" class="x" data-src="y">');
    expect(out).not.toMatch(/width|class|data-src/);
  });
});

describe("safeHttpUrl", () => {
  it.each([
    ["https://example.com/a", "https://example.com/a"],
    ["http://example.com", "http://example.com/"],
  ])("keeps %s", (input, expected) => expect(safeHttpUrl(input)).toBe(expected));

  it.each([null, undefined, "", "javascript:alert(1)", "data:image/png;base64,AA", "/relative.png", "not a url", "ftp://x"])(
    "rejects %j",
    (input) => expect(safeHttpUrl(input)).toBeNull(),
  );
});
