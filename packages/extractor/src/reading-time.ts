import { WORDS_PER_MINUTE } from "@readbook/core";

/** Count words in plain text by splitting on any run of whitespace. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Estimate reading minutes. Floored at 1 so even a tweet-length Reading reads as
 * "1 min" rather than "0 min", which would look broken in the feed card.
 */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
