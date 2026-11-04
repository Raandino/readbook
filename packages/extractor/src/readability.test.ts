import { describe, expect, it } from "vitest";
import { cleanExcerpt, cleanTitle } from "./readability";

describe("cleanTitle", () => {
  it("strips a suffix that names the site's host", () => {
    expect(
      cleanTitle("Essays: First Series/Self-Reliance - Wikisource, the free online library", "https://en.wikisource.org/wiki/X", null),
    ).toBe("Essays: First Series/Self-Reliance");
    expect(cleanTitle("Why I write | Paul's Blog", "https://pauls-blog.dev/why", "Paul's Blog")).toBe("Why I write");
  });

  it("keeps dashes that are part of the real title", () => {
    expect(cleanTitle("Cats - a field guide", "https://example.com/cats", null)).toBe("Cats - a field guide");
    expect(cleanTitle("Rust vs Go - which one?", "https://blog.example.org/x", "Example")).toBe("Rust vs Go - which one?");
  });

  it("handles empty input", () => {
    expect(cleanTitle(null, "https://example.com", null)).toBeNull();
    expect(cleanTitle("   ", "https://example.com", null)).toBeNull();
  });
});

describe("cleanExcerpt", () => {
  const body = "Whoso would be a man must be a nonconformist. ".repeat(10);
  it("keeps a real description", () => {
    expect(cleanExcerpt("Emerson argues for trusting your own judgment.", body)).toBe("Emerson argues for trusting your own judgment.");
  });
  it("replaces junk (arrows, zero-width spaces) with the opening of the text", () => {
    expect(cleanExcerpt("←", body)).toMatch(/^Whoso would be a man/);
    expect(cleanExcerpt("​", body)).toMatch(/…$/);
  });
  it("returns null when there is no text at all", () => {
    expect(cleanExcerpt(null, "   ")).toBeNull();
  });
});

describe("cleanTitle — wiki subpage paths", () => {
  it("keeps only the final part when the URL ends with it", () => {
    expect(cleanTitle("The Four Million/The Gift of the Magi", "https://en.wikisource.org/wiki/The_Gift_of_the_Magi", null)).toBe(
      "The Gift of the Magi",
    );
    expect(
      cleanTitle("The Atlantic Monthly/Volume 9/Number 56/Walking", "https://en.wikisource.org/wiki/The_Atlantic_Monthly/Volume_9/Number_56/Walking", null),
    ).toBe("Walking");
  });
  it("leaves real slashes alone", () => {
    expect(cleanTitle("TCP/IP explained", "https://example.com/posts/tcp-ip", null)).toBe("TCP/IP explained");
  });
});

describe("cleanExcerpt — headings are not summaries", () => {
  it("skips a heading-only description and leading heading blocks", () => {
    const text = "THE GIFT OF THE MAGI\n\nOne dollar and eighty-seven cents. That was all. And sixty cents of it was in pennies.";
    expect(cleanExcerpt("THE GIFT OF THE MAGI", text)).toMatch(/^One dollar and eighty-seven cents/);
  });
});
