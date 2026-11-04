import { describe, expect, it } from "vitest";
import { blockText, htmlToReading } from "./dom";

const paragraph = "<p>" + "The quick brown fox jumps over the lazy dog near the quiet river bank. ".repeat(8) + "</p>";

describe("htmlToReading", () => {
  it("drops hidden metadata before Readability sees it", () => {
    const html = `<html><head><title>T</title><meta property="og:image" content="/cover.jpg"></head><body><article>
      <div style="display:none">1493181 Secret metadata</div><span class="ws-noexport">Public domain false</span>
      <h1>Story</h1>${paragraph}${paragraph}</article></body></html>`;
    const result = htmlToReading(html, "https://example.com/story");
    expect(result?.textContent).not.toContain("Secret metadata");
    expect(result?.textContent).not.toContain("Public domain false");
    expect(result?.leadImage).toBe("/cover.jpg");
  });
});

describe("blockText", () => {
  it("separates block elements", () => {
    expect(blockText("<h2>Walking.</h2><p>I wish to speak a word.</p>")).toBe("Walking.\n\nI wish to speak a word.");
  });
});
