import { WORDS_PER_MINUTE } from "@readbook/core";
import { describe, expect, it } from "vitest";
import { readingMinutes, wordCount } from "./reading-time";

describe("wordCount", () => {
  it.each([
    ["", 0],
    ["   \n\t ", 0],
    ["one", 1],
    ["  two   words ", 2],
    ["line one\nline two\ttabbed", 5],
    ["hyphen-ated words count once", 4],
  ])("%j → %i", (text, expected) => expect(wordCount(text)).toBe(expected));
});

describe("readingMinutes", () => {
  it("never reports less than one minute", () => {
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(1)).toBe(1);
  });
  it("rounds to the nearest minute at WORDS_PER_MINUTE", () => {
    expect(readingMinutes(WORDS_PER_MINUTE)).toBe(1);
    expect(readingMinutes(WORDS_PER_MINUTE * 10)).toBe(10);
    expect(readingMinutes(WORDS_PER_MINUTE * 2.4)).toBe(2);
    expect(readingMinutes(WORDS_PER_MINUTE * 2.6)).toBe(3);
  });
});
