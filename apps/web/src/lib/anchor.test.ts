import { describe, expect, it } from "vitest";
import { CONTEXT_CHARS, describeRange, locateQuote, trimSpan } from "./anchor";

/** Describe the first occurrence of `quote` in `text`. */
function describeFirst(text: string, quote: string) {
  const start = text.indexOf(quote);
  const described = describeRange(text, start, start + quote.length);
  if (!described) throw new Error("expected a description");
  return described;
}

describe("trimSpan", () => {
  it("drops surrounding whitespace", () => {
    expect(trimSpan("  hello world \n", 0, 15)).toEqual({ start: 2, end: 13 });
  });
  it("returns null for an all-whitespace span", () => {
    expect(trimSpan("a   b", 1, 4)).toBeNull();
  });
  it("clamps out-of-range offsets", () => {
    expect(trimSpan("abc", -5, 99)).toEqual({ start: 0, end: 3 });
  });
});

describe("describeRange", () => {
  const text = "The quick brown fox jumps over the lazy dog.";

  it("captures the quote and its context", () => {
    expect(describeFirst(text, "brown fox")).toEqual({
      quote: "brown fox",
      prefix: "The quick ",
      suffix: " jumps over the lazy dog.",
    });
  });

  it("caps context at CONTEXT_CHARS on each side", () => {
    const long = `${"a".repeat(100)}NEEDLE${"b".repeat(100)}`;
    const d = describeFirst(long, "NEEDLE");
    expect(d.prefix).toHaveLength(CONTEXT_CHARS);
    expect(d.suffix).toHaveLength(CONTEXT_CHARS);
  });

  it("trims whitespace grabbed by the selection", () => {
    const d = describeRange(text, 9, 20); // " brown fox "
    expect(d?.quote).toBe("brown fox");
    expect(d?.prefix).toBe("The quick ");
  });

  it("returns null for an empty selection", () => {
    expect(describeRange(text, 4, 4)).toBeNull();
    expect(describeRange("a  b", 1, 3)).toBeNull();
  });
});

describe("locateQuote", () => {
  it("finds a unique match", () => {
    const text = "Alpha beta gamma delta.";
    const d = describeFirst(text, "gamma");
    expect(locateQuote(text, d)).toEqual({ start: 11, end: 16 });
  });

  it("disambiguates a repeated quote by its context", () => {
    const text = "I said yes. Then she said yes. Finally they all said yes.";
    const second = text.indexOf("yes", text.indexOf("she"));
    const d = describeRange(text, second, second + 3);
    if (!d) throw new Error("expected a description");
    expect(locateQuote(text, d)).toEqual({ start: second, end: second + 3 });

    const third = text.lastIndexOf("yes");
    const d3 = describeRange(text, third, third + 3);
    if (!d3) throw new Error("expected a description");
    expect(locateQuote(text, d3)).toEqual({ start: third, end: third + 3 });
  });

  it("prefers the earliest occurrence when context can't tell them apart", () => {
    expect(locateQuote("echo echo echo", { quote: "echo", prefix: "", suffix: "" })).toEqual({ start: 0, end: 4 });
  });

  it("still uses partial context when the article changed around the quote", () => {
    const text = "Rule one: ship. Rule two: ship again, but better.";
    const at = text.indexOf("ship again");
    // The stored suffix only partially matches the current text.
    expect(locateQuote(text, { quote: "ship", prefix: "two: ", suffix: " again, but faster" })).toEqual({
      start: at,
      end: at + 4,
    });
  });

  it("returns null when the quote is gone", () => {
    expect(locateQuote("Nothing to see here.", { quote: "elephant", prefix: "", suffix: "" })).toBeNull();
  });

  it("returns null for an empty quote", () => {
    expect(locateQuote("text", { quote: "   ", prefix: "", suffix: "" })).toBeNull();
  });

  it("tolerates whitespace drift and returns offsets into the original text", () => {
    const saved = "first paragraph ends here.\nSecond paragraph starts.";
    const d = describeFirst(saved, "here.\nSecond");
    // Re-rendered with different line breaks and indentation.
    const now = "first paragraph ends here.\n\n    Second   paragraph starts.";
    const span = locateQuote(now, d);
    expect(span).not.toBeNull();
    if (!span) return;
    expect(now.slice(span.start, span.end)).toBe("here.\n\n    Second");
  });

  it("matches when the stored quote has collapsed whitespace but the page has runs", () => {
    const now = "a  lot   of\tspace";
    const span = locateQuote(now, { quote: "lot of space", prefix: "a ", suffix: "" });
    expect(span).toEqual({ start: 3, end: 17 });
  });

  it("finds a quote at the very start of the text", () => {
    const text = "Opening words, then the rest.";
    const d = describeFirst(text, "Opening words");
    expect(d.prefix).toBe("");
    expect(locateQuote(text, d)).toEqual({ start: 0, end: 13 });
  });

  it("finds a quote at the very end of the text", () => {
    const text = "Everything leads to the end.";
    const d = describeFirst(text, "the end.");
    expect(d.suffix).toBe("");
    expect(locateQuote(text, d)).toEqual({ start: text.length - 8, end: text.length });
  });

  it("matches a quote stored with a paragraph break against text that has none", () => {
    // <p>…hard."</p><p>The following…</p> has no whitespace in textContent.
    const now = 'a point labelled "work hard."The following recipe';
    const span = locateQuote(now, { quote: '"work hard."\n\nThe following', prefix: "labelled ", suffix: " recipe" });
    expect(span && now.slice(span.start, span.end)).toBe('"work hard."The following');
  });

  it("handles leading whitespace in the text", () => {
    const text = "\n\n  Title\n\n  Body text";
    const d = describeFirst(text, "Body");
    const span = locateQuote(text, d);
    expect(span && text.slice(span.start, span.end)).toBe("Body");
  });

  it("never reuses one text's offsets for another (normalization cache)", () => {
    const a = "one two three";
    const b = "zero one two three";
    const quote = { quote: "two", prefix: "", suffix: "" };
    expect(locateQuote(a, quote)).toEqual({ start: 4, end: 7 });
    expect(locateQuote(b, quote)).toEqual({ start: 9, end: 12 });
    expect(locateQuote(a, quote)).toEqual({ start: 4, end: 7 });
  });
});
