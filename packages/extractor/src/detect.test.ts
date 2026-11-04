import { describe, expect, it } from "vitest";
import { classifySource } from "./detect";

const kind = (url: string) => classifySource(new URL(url));

describe("classifySource", () => {
  it.each([
    "https://x.com/jack/status/20",
    "https://twitter.com/jack/status/20",
    "https://www.x.com/jack",
    "https://WWW.TWITTER.COM/jack",
  ])("%s → x", (url) => expect(kind(url)).toBe("x"));

  it.each([
    "https://reddit.com/r/programming/comments/abc/title/",
    "https://www.reddit.com/r/programming/",
    "https://old.reddit.com/r/programming/",
    "https://np.reddit.com/r/x",
  ])("%s → reddit", (url) => expect(kind(url)).toBe("reddit"));

  it.each(["https://substack.com/home/post/p-123", "https://stratechery.substack.com/p/essay", "https://A.Substack.com/p/x"])(
    "%s → substack",
    (url) => expect(kind(url)).toBe("substack"),
  );

  it.each([
    "https://paulgraham.com/greatwork.html",
    // Lookalike hosts must not be claimed by a specific adapter.
    "https://notx.com/a",
    "https://x.com.evil.example/a",
    "https://reddit.com.evil.example/r/x",
    "https://myreddit.com/r/x",
    "https://evilsubstack.com/p/x",
    "https://mobile.twitter.com/jack", // not in the X list today: falls back to generic
    "http://localhost:4321/",
  ])("%s → generic", (url) => expect(kind(url)).toBe("generic"));
});
