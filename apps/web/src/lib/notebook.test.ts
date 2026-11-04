import { describe, expect, it } from "vitest";
import type { Highlight } from "@readbook/core";
import {
  blockquote,
  buildNotebook,
  displayHost,
  exportFilename,
  httpUrl,
  neutralizeLine,
  notebookToMarkdown,
  type NotebookReading,
} from "./notebook";

function reading(id: string, extra: Partial<NotebookReading> = {}): NotebookReading {
  return { id, title: `Reading ${id}`, url: `https://www.example.com/${id}`, author: null, siteName: null, note: null, ...extra };
}

function highlight(id: string, readingId: string, createdAt: string, extra: Partial<Highlight> = {}): Highlight {
  return {
    id,
    readingId,
    quote: `quote ${id}`,
    prefix: "",
    suffix: "",
    color: "yellow",
    note: null,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

describe("httpUrl / displayHost", () => {
  it("accepts only http(s)", () => {
    expect(httpUrl("https://example.com/a")?.hostname).toBe("example.com");
    expect(httpUrl("note:abc")).toBeNull();
    expect(httpUrl("file:///tmp/book.epub")).toBeNull();
    expect(httpUrl("not a url")).toBeNull();
  });
  it("drops a leading www.", () => {
    expect(displayHost(new URL("https://www.paulgraham.com/x"))).toBe("paulgraham.com");
  });
});

describe("buildNotebook", () => {
  it("groups by reading, ordered by most recent highlight, newest first within", () => {
    const groups = buildNotebook(
      [
        highlight("a1", "a", "2026-01-01T00:00:00Z"),
        highlight("b1", "b", "2026-01-02T00:00:00Z"),
        highlight("a2", "a", "2026-01-03T00:00:00Z"),
      ],
      [reading("a"), reading("b")],
    );
    expect(groups.map((g) => g.reading.id)).toEqual(["a", "b"]);
    expect(groups[0]?.highlights.map((h) => h.id)).toEqual(["a2", "a1"]);
  });

  it("appends readings that only have a note, and skips blank notes", () => {
    const groups = buildNotebook(
      [highlight("a1", "a", "2026-01-01T00:00:00Z")],
      [reading("n", { note: "Worth rereading." }), reading("a"), reading("blank", { note: "   " })],
    );
    expect(groups.map((g) => g.reading.id)).toEqual(["a", "n"]);
    expect(groups[1]?.highlights).toEqual([]);
  });

  it("drops highlights whose reading is unknown", () => {
    expect(buildNotebook([highlight("x", "missing", "2026-01-01T00:00:00Z")], [])).toEqual([]);
  });
});

describe("neutralizeLine", () => {
  it.each([
    ["# not a heading", "\\# not a heading"],
    ["> nested", "\\> nested"],
    ["```js", "\\`\\`\\`js"],
    ["~~~", "\\~~~"],
    ["- item", "\\- item"],
    ["---", "\\---"],
    ["1. first", "1\\. first"],
    ["    indented code", "indented code"],
    ["<div>", "\\<div>"],
    ["plain words", "plain words"],
    ["say <b>hi</b> & 1 < 2", "say \\<b>hi\\</b> & 1 < 2"],
    ["![x](http://a)", "\\!\\[x\\](http://a)"],
    ["[x](javascript:y)", "\\[x\\](javascript:y)"],
    ["see <https://a.example>", "see \\<https://a.example>"],
    ["*bold* and _em_ and `code`", "\\*bold\\* and \\_em\\_ and \\`code\\`"],
    ["a \\ b", "a \\\\ b"],
    ["Wow! [1]", "Wow! \\[1\\]"],
  ])("%j → %j", (input, expected) => expect(neutralizeLine(input)).toBe(expected));
});

/** True when `md` holds an unescaped `[`: the start of a link or image. */
const hasLiveBracket = (md: string): boolean => /(^|[^\\])\[/m.test(md);

describe("blockquote", () => {
  it("keeps multi-paragraph quotes in one blockquote", () => {
    expect(blockquote("First line.\n\n\nSecond line.")).toBe("> First line.\n>\n> Second line.");
  });
  it("can't be broken out of by a fence or heading", () => {
    expect(blockquote("```\n# Title")).toBe("> \\`\\`\\`\n> \\# Title");
  });
  it("keeps images and links in a quote inert", () => {
    const md = blockquote("Look: ![x](http://a)\n[x](javascript:y)");
    expect(md).toBe("> Look: \\!\\[x\\](http://a)\n> \\[x\\](javascript:y)");
    expect(hasLiveBracket(md)).toBe(false);
  });
});

describe("notebookToMarkdown", () => {
  it("renders a full section per reading", () => {
    const groups = buildNotebook(
      [
        highlight("h2", "a", "2026-02-02T10:00:00Z", { quote: "Second passage", color: "blue", note: "Why it matters.\n- not a list" }),
        highlight("h1", "a", "2026-02-01T10:00:00Z", { quote: "First passage" }),
      ],
      [reading("a", { title: "How to [Do] Great Work", author: "Paul Graham", siteName: "paulgraham.com", note: "Big one." })],
    );
    const md = notebookToMarkdown(groups, "2026-02-03T00:00:00Z");
    expect(md).toBe(
      [
        "# Readbook highlights",
        "",
        "Exported 2026-02-03 · 2 highlights from 1 reading",
        "",
        "---",
        "",
        "## How to \\[Do\\] Great Work",
        "",
        "*Paul Graham* · paulgraham.com · [Read the original](<https://www.example.com/a>)",
        "",
        "**My notes:**",
        "",
        "Big one.",
        "",
        "> First passage",
        "",
        "*Yellow highlight · 2026-02-01*",
        "",
        "> Second passage",
        "",
        "*Blue highlight · 2026-02-02*",
        "",
        "Why it matters.  ",
        "\\- not a list",
        "",
      ].join("\n"),
    );
  });

  it("keeps images and links in quotes and notes inert", () => {
    const md = notebookToMarkdown(
      buildNotebook(
        [highlight("h", "a", "2026-01-01T00:00:00Z", { quote: "![x](http://a)", note: "[x](javascript:y)" })],
        [reading("a", { url: "note:1", note: "![x](http://a) and [x](javascript:y)" })],
      ),
      "2026-01-02T00:00:00Z",
    );
    expect(md).toContain("> \\!\\[x\\](http://a)");
    expect(md).toContain("\\[x\\](javascript:y)");
    expect(md).not.toMatch(/(^|[^\\])!\[x\]\(/m);
    expect(md).not.toMatch(/(^|[^\\])\[x\]\(javascript:/m);
    expect(hasLiveBracket(md)).toBe(false);
  });

  it("omits the original link for notes and files", () => {
    const md = notebookToMarkdown(
      buildNotebook([highlight("h", "n", "2026-01-01T00:00:00Z")], [reading("n", { url: "note:123" })]),
      "2026-01-02T00:00:00Z",
    );
    expect(md).not.toContain("Read the original");
    expect(md).toContain("1 highlight from 1 reading");
  });

  it("says so when there is nothing to export", () => {
    expect(notebookToMarkdown([], "2026-01-02T00:00:00Z")).toContain("Nothing highlighted yet.");
  });
});

describe("exportFilename", () => {
  it("slugs a reading title", () => {
    expect(exportFilename("2026-01-02T00:00:00Z", "How to Do Great Work!")).toBe("readbook-how-to-do-great-work.md");
  });
  it("falls back to a dated name", () => {
    expect(exportFilename("2026-01-02T00:00:00Z")).toBe("readbook-highlights-2026-01-02.md");
    expect(exportFilename("2026-01-02T00:00:00Z", "日本語")).toBe("readbook-highlights-2026-01-02.md");
  });
});
