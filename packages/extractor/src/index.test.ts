/**
 * The hybrid pipeline in `extract()`, with every network-touching module
 * mocked: Readability (generic/substack), Firecrawl, and the Reddit/X adapters.
 */
import type { ExtractResult, SourceKind } from "@readbook/core";
import { ExtractionError } from "@readbook/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./readability", () => ({ extractWithReadability: vi.fn() }));
vi.mock("./firecrawl", () => ({ extractWithFirecrawl: vi.fn() }));
vi.mock("./adapters/reddit", async () => {
  const { classifySource } = await import("./detect");
  return {
    redditAdapter: { kind: "reddit", matches: (u: URL) => classifySource(u) === "reddit", extract: vi.fn() },
  };
});
vi.mock("./adapters/x", async () => {
  const { classifySource } = await import("./detect");
  return { xAdapter: { kind: "x", matches: (u: URL) => classifySource(u) === "x", extract: vi.fn() } };
});

const { extract } = await import("./index");
const { extractWithReadability } = await import("./readability");
const { extractWithFirecrawl } = await import("./firecrawl");
const { redditAdapter } = await import("./adapters/reddit");
const { xAdapter } = await import("./adapters/x");
const { SafeFetchError } = await import("./net");

const readability = vi.mocked(extractWithReadability);
const firecrawl = vi.mocked(extractWithFirecrawl);
const reddit = vi.mocked(redditAdapter.extract);
const x = vi.mocked(xAdapter.extract);

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

function result(n: number, overrides: Partial<ExtractResult> = {}): ExtractResult {
  return {
    url: "https://blog.example/post",
    source: "generic" as SourceKind,
    title: `Post with ${n} words`,
    author: null,
    siteName: null,
    contentHtml: `<p>${words(n)}</p>`,
    contentText: words(n),
    excerpt: null,
    leadImageUrl: null,
    publishedAt: null,
    engine: "readability",
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<ExtractionError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ExtractionError);
  return err as ExtractionError;
}

const URL_ = "https://blog.example/post";
const KEY = { firecrawlApiKey: "fc-test" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("extract — primary path", () => {
  it("returns a rich Readability result without calling Firecrawl, finalized", async () => {
    readability.mockResolvedValue(result(500, { leadImageUrl: "https://cdn.example/a.jpg" }));
    const reading = await extract(URL_, KEY);

    expect(firecrawl).not.toHaveBeenCalled();
    expect(reading.wordCount).toBe(500);
    expect(reading.readingMinutes).toBe(2);
    expect(reading.leadImageUrl).toBe("https://cdn.example/a.jpg");
    expect(Number.isNaN(Date.parse(reading.fetchedAt))).toBe(false);
  });

  it("routes by host and passes options through to the adapter", async () => {
    readability.mockResolvedValue(result(300));
    const options = { ...KEY, userAgent: "UA/1", allowPrivateNetwork: false };
    await extract("https://someone.substack.com/p/x", options);
    expect(readability).toHaveBeenCalledWith("https://someone.substack.com/p/x", "substack", options);
  });

  it("drops a non-http(s) lead image", async () => {
    readability.mockResolvedValue(result(300, { leadImageUrl: "javascript:alert(1)" }));
    expect((await extract(URL_)).leadImageUrl).toBeNull();
  });

  it("returns a thin result as-is when there is no Firecrawl key", async () => {
    readability.mockResolvedValue(result(10));
    const reading = await extract(URL_, { firecrawlApiKey: "   " });
    expect(reading.wordCount).toBe(10);
    expect(firecrawl).not.toHaveBeenCalled();
  });

  it("wraps a raw primary error in ExtractionError when there is no key", async () => {
    const cause = new Error("socket hang up");
    readability.mockRejectedValue(cause);
    const err = await rejection(extract(URL_));
    expect(err.url).toBe(URL_);
    expect(err.cause).toBe(cause);
    expect(firecrawl).not.toHaveBeenCalled();
  });

  it("passes an ExtractionError from the adapter through unchanged", async () => {
    const original = new ExtractionError("Paywalled", URL_);
    readability.mockRejectedValue(original);
    expect(await rejection(extract(URL_))).toBe(original);
  });
});

describe("extract — Firecrawl fallback", () => {
  it("retries a thin result and keeps the richer one", async () => {
    readability.mockResolvedValue(result(20));
    firecrawl.mockResolvedValue(result(400, { engine: "firecrawl" }));
    const reading = await extract(URL_, KEY);
    expect(firecrawl).toHaveBeenCalledWith(URL_, "generic", KEY);
    expect(reading.engine).toBe("firecrawl");
    expect(reading.wordCount).toBe(400);
  });

  it("keeps the primary when Firecrawl comes back even thinner", async () => {
    readability.mockResolvedValue(result(50));
    firecrawl.mockResolvedValue(result(5, { engine: "firecrawl" }));
    expect((await extract(URL_, KEY)).engine).toBe("readability");
  });

  it("keeps the thin primary when Firecrawl fails", async () => {
    readability.mockResolvedValue(result(30));
    firecrawl.mockRejectedValue(new Error("402 payment required"));
    expect((await extract(URL_, KEY)).wordCount).toBe(30);
  });

  it("uses Firecrawl when the primary fails", async () => {
    readability.mockRejectedValue(new Error("no article found"));
    firecrawl.mockResolvedValue(result(200, { engine: "firecrawl" }));
    expect((await extract(URL_, KEY)).engine).toBe("firecrawl");
  });

  it("reports both reasons when both paths fail", async () => {
    readability.mockRejectedValue(new Error("no article found"));
    firecrawl.mockRejectedValue(new Error("quota exceeded"));
    const err = await rejection(extract(URL_, KEY));
    expect(err.message).toContain("Primary: no article found");
    expect(err.message).toContain("Firecrawl: quota exceeded");
  });

  it.each(["blocked-address", "scheme"] as const)(
    "never hands a %s refusal to Firecrawl",
    async (code) => {
      readability.mockRejectedValue(new SafeFetchError(code, "Refusing to fetch"));
      await rejection(extract(URL_, KEY));
      expect(firecrawl).not.toHaveBeenCalled();
    },
  );

  it("detects a refusal nested in an ExtractionError cause", async () => {
    readability.mockRejectedValue(
      new ExtractionError("fetch failed", URL_, new SafeFetchError("blocked-address", "private")),
    );
    await rejection(extract(URL_, KEY));
    expect(firecrawl).not.toHaveBeenCalled();
  });

  it("still retries ordinary network failures", async () => {
    readability.mockRejectedValue(new SafeFetchError("timeout", "slow"));
    firecrawl.mockResolvedValue(result(200, { engine: "firecrawl" }));
    expect((await extract(URL_, KEY)).engine).toBe("firecrawl");
  });
});

describe("extract — sources that own their strategy", () => {
  it("never retries Reddit via Firecrawl", async () => {
    reddit.mockRejectedValue(new Error("403"));
    await rejection(extract("https://www.reddit.com/r/x/comments/abc/t/", KEY));
    expect(firecrawl).not.toHaveBeenCalled();
    expect(readability).not.toHaveBeenCalled();
  });

  it("never retries X via Firecrawl, even when thin", async () => {
    x.mockResolvedValue(result(12, { source: "x", engine: "syndication" }));
    const reading = await extract("https://x.com/jack/status/20", KEY);
    expect(reading.engine).toBe("syndication");
    expect(firecrawl).not.toHaveBeenCalled();
  });
});

describe("extract — URL vetting", () => {
  it.each(["not a url", "file:///etc/passwd", "http://127.0.0.1/", "http://localhost:4321/", "http://169.254.169.254/"])(
    "refuses %s before any adapter runs",
    async (url) => {
      await rejection(extract(url, KEY));
      expect(readability).not.toHaveBeenCalled();
      expect(firecrawl).not.toHaveBeenCalled();
    },
  );

  it("lets private hosts through when allowPrivateNetwork is on", async () => {
    readability.mockResolvedValue(result(300));
    await extract("http://192.168.1.10/wiki", { allowPrivateNetwork: true });
    expect(readability).toHaveBeenCalledOnce();
  });
});
