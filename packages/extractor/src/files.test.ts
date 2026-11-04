import { ExtractionError } from "@readbook/core";
import { strToU8, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";
import { extractFile, extractNote } from "./files";

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>A Tiny Book</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
  </metadata>
  <manifest>
    <item id="c2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;

const chapter = (title: string, body: string) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

function epub(overrides: Record<string, string | null> = {}): Uint8Array {
  const entries: Record<string, string | null> = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": CONTAINER,
    "OEBPS/content.opf": OPF,
    "OEBPS/text/ch1.xhtml": chapter(
      "Chapter One",
      '<p>It was a <em>calm</em> night.</p><img src="cover.png"/><script>alert(1)</script>',
    ),
    "OEBPS/text/ch 2.xhtml": chapter("Chapter Two", '<p onclick="x()">The end came quietly.</p>'),
    ...overrides,
  };
  const zippable: Zippable = {};
  for (const [path, content] of Object.entries(entries)) {
    if (content !== null) zippable[path] = strToU8(content);
  }
  return zipSync(zippable);
}

async function rejection(promise: Promise<unknown>): Promise<ExtractionError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ExtractionError);
  return err as ExtractionError;
}

describe("extractFile — Markdown", () => {
  it("renders, sanitizes and titles from the first H1", async () => {
    const md = "Intro line\n\n# The Real Title\n\nSome **bold** text and a [link](https://example.com).\n\n<script>alert(1)</script>";
    const reading = await extractFile({ name: "notes.md", data: new TextEncoder().encode(md) });

    expect(reading.title).toBe("The Real Title");
    expect(reading.source).toBe("file");
    expect(reading.engine).toBe("file");
    expect(reading.siteName).toBe("Local file");
    expect(reading.contentHtml).toContain("<strong>bold</strong>");
    expect(reading.contentHtml).toContain('target="_blank"');
    expect(reading.contentHtml).not.toContain("<script");
    expect(reading.contentText).toContain("Some bold text");
    expect(reading.wordCount).toBeGreaterThan(5);
    expect(reading.readingMinutes).toBe(1);
    expect(reading.url).toMatch(/^readbook-file:\/\/[0-9a-f]{24}\/notes\.md$/);
    expect(Number.isNaN(Date.parse(reading.fetchedAt))).toBe(false);
  });

  it("falls back to the file name when there is no heading, and strips a BOM", async () => {
    const reading = await extractFile({ name: "my-essay.markdown", data: new TextEncoder().encode("﻿Just text.") });
    expect(reading.title).toBe("my-essay");
    expect(reading.contentText).toBe("Just text.");
  });

  it("accepts a text/markdown MIME type with any extension, and an ArrayBuffer", async () => {
    const bytes = new TextEncoder().encode("# Typed\n\nbody");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const reading = await extractFile({ name: "upload.txt", type: "text/markdown", data: buffer });
    expect(reading.title).toBe("Typed");
  });

  it("gives identical content the same URL (dedupe) and different content a different one", async () => {
    const a = await extractFile({ name: "a.md", data: strToU8("# A\n\nsame") });
    const b = await extractFile({ name: "a.md", data: strToU8("# A\n\nsame") });
    const c = await extractFile({ name: "a.md", data: strToU8("# A\n\ndifferent") });
    expect(a.url).toBe(b.url);
    expect(a.url).not.toBe(c.url);
  });

  it("uses only the base name of a path-like file name", async () => {
    const reading = await extractFile({ name: "../../etc/evil.md", data: strToU8("text") });
    expect(reading.url).toMatch(/\/evil\.md$/);
  });

  it("rejects a Markdown file with no readable text", async () => {
    const err = await rejection(extractFile({ name: "empty.md", data: strToU8("<script>x</script>\n\n   ") }));
    expect(err.message).toMatch(/readable text/);
  });
});

describe("extractFile — EPUB", () => {
  it("reads metadata and spine-ordered chapters", async () => {
    const reading = await extractFile({ name: "tiny.epub", data: epub() });

    expect(reading.title).toBe("A Tiny Book");
    expect(reading.author).toBe("Ada Lovelace");
    expect(reading.siteName).toBe("Local EPUB");
    expect(reading.source).toBe("file");
    // Spine order (ch1 then the percent-encoded "ch 2"), not manifest order.
    expect(reading.contentText.indexOf("Chapter One")).toBeLessThan(reading.contentText.indexOf("Chapter Two"));
    expect(reading.contentHtml).toContain("<hr />");
    expect(reading.contentHtml).not.toMatch(/<img|<script|onclick/);
    expect(reading.contentText).toContain("The end came quietly.");
  });

  it("is detected by MIME type too", async () => {
    const reading = await extractFile({ name: "book", type: "application/epub+zip", data: epub() });
    expect(reading.title).toBe("A Tiny Book");
  });

  it("falls back to the first heading when the OPF has no title", async () => {
    const reading = await extractFile({
      name: "untitled.epub",
      data: epub({ "OEBPS/content.opf": OPF.replace(/<dc:title>.*<\/dc:title>/, "") }),
    });
    expect(reading.title).toBe("Chapter One");
  });

  it("falls back to the manifest when the spine is empty", async () => {
    const reading = await extractFile({
      name: "nospine.epub",
      data: epub({ "OEBPS/content.opf": OPF.replace(/<spine>.*<\/spine>/, "<spine></spine>") }),
    });
    expect(reading.contentText).toContain("Chapter One");
    expect(reading.contentText).toContain("Chapter Two");
  });

  it("throws ExtractionError when META-INF/container.xml is missing", async () => {
    const err = await rejection(extractFile({ name: "broken.epub", data: epub({ "META-INF/container.xml": null }) }));
    expect(err.message).toMatch(/missing required files/);
    expect(err.url).toMatch(/^readbook-file:\/\//);
  });

  it("throws ExtractionError when the container has no rootfile", async () => {
    const err = await rejection(
      extractFile({ name: "broken.epub", data: epub({ "META-INF/container.xml": "<container></container>" }) }),
    );
    expect(err.message).toMatch(/package manifest/);
  });

  it("throws ExtractionError when the OPF the container points at is missing", async () => {
    const err = await rejection(extractFile({ name: "broken.epub", data: epub({ "OEBPS/content.opf": null }) }));
    expect(err.message).toMatch(/missing required files/);
  });

  it("throws ExtractionError when no chapter has text", async () => {
    const err = await rejection(
      extractFile({
        name: "blank.epub",
        data: epub({ "OEBPS/text/ch1.xhtml": "<html><body> </body></html>", "OEBPS/text/ch 2.xhtml": null }),
      }),
    );
    expect(err.message).toMatch(/readable chapters/);
  });

  it("throws ExtractionError for bytes that are not a zip", async () => {
    const err = await rejection(extractFile({ name: "fake.epub", data: strToU8("definitely not a zip") }));
    expect(err.message).toMatch(/could not be opened/);
  });

  it("refuses an entry that inflates past the per-entry cap (zip bomb guard)", async () => {
    const huge = new Uint8Array(26 * 1024 * 1024); // zeros compress to a few KB
    const data = zipSync({
      "META-INF/container.xml": strToU8(CONTAINER),
      "OEBPS/content.opf": strToU8(OPF),
      "OEBPS/text/ch1.xhtml": huge,
    });
    expect(data.byteLength).toBeLessThan(1024 * 1024);
    const err = await rejection(extractFile({ name: "bomb.epub", data }));
    expect(err.message).toMatch(/too large/);
  });
});

describe("extractFile — unsupported", () => {
  it("rejects other file types", async () => {
    const err = await rejection(extractFile({ name: "paper.pdf", type: "application/pdf", data: strToU8("%PDF-1.7") }));
    expect(err.message).toMatch(/EPUB or Markdown/);
  });
});

describe("extractNote", () => {
  it("uses the given title and renders Markdown", async () => {
    const reading = await extractNote({ title: "  Groceries ", body: "- eggs\n- *bread*" });
    expect(reading.title).toBe("Groceries");
    expect(reading.source).toBe("note");
    expect(reading.engine).toBe("manual");
    expect(reading.siteName).toBe("Note");
    expect(reading.contentHtml).toContain("<li>");
    expect(reading.contentHtml).toContain("<em>bread</em>");
    expect(reading.url).toMatch(/^readbook-note:\/\/[0-9a-f-]{36}$/);
  });

  it("falls back to the first heading, then to 'Untitled note'", async () => {
    expect((await extractNote({ body: "# From Heading\n\ntext" })).title).toBe("From Heading");
    expect((await extractNote({ title: "   ", body: "plain text" })).title).toBe("Untitled note");
    expect((await extractNote({ title: null, body: "plain text" })).title).toBe("Untitled note");
  });

  it("gives every note a unique URL, even with identical bodies", async () => {
    const a = await extractNote({ body: "same" });
    const b = await extractNote({ body: "same" });
    expect(a.url).not.toBe(b.url);
  });

  it("sanitizes HTML inside the Markdown body", async () => {
    const reading = await extractNote({ body: 'Hi <img src="x" onerror="alert(1)"> <a href="javascript:alert(1)">x</a>' });
    expect(reading.contentHtml).not.toMatch(/onerror|javascript:/);
  });

  it("rejects an empty or whitespace-only body", async () => {
    await rejection(extractNote({ body: "" }));
    const err = await rejection(extractNote({ title: "Title", body: " \n\t " }));
    expect(err.message).toMatch(/empty/);
  });
});

describe("leading heading becomes the title, not a duplicate", () => {
  it("removes the opening # heading from the body when it is the title", async () => {
    const reading = await extractNote({ body: "# Why I keep a shelf\n\nOne place for everything." });
    expect(reading.title).toBe("Why I keep a shelf");
    expect(reading.contentHtml).not.toContain("<h1>");
    expect(reading.excerpt).toMatch(/^One place/);
  });

  it("keeps the heading when an explicit, different title is given", async () => {
    const reading = await extractNote({ title: "Mine", body: "# Chapter one\n\nText." });
    expect(reading.title).toBe("Mine");
    expect(reading.contentHtml).toContain("<h1>Chapter one</h1>");
  });

  it("keeps a heading-only document intact", async () => {
    const reading = await extractNote({ body: "# Only a heading" });
    expect(reading.contentText).toContain("Only a heading");
  });
});

describe("Markdown titles are plain text", () => {
  it("strips emphasis, images and link syntax from a heading title", async () => {
    const reading = await extractNote({ body: "# **Contexto: lo que vimos en enero:![][image1]**\n\nTexto del documento." });
    expect(reading.title).toBe("Contexto: lo que vimos en enero:");
    const linked = await extractNote({ body: "# A [linked](https://example.com) *title* with `code`\n\nBody text here." });
    expect(linked.title).toBe("A linked title with code");
  });
});
