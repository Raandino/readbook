import { closeDb, setSetting } from "@readbook/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allowPrivateNetwork,
  describeFirecrawlKey,
  extractOptions,
  firecrawlApiKey,
  firecrawlProxy,
  userAgent,
} from "./config";

const ENV_KEYS = [
  "FIRECRAWL_API_KEY",
  "READBOOK_ALLOW_PRIVATE_NETWORK",
  "READBOOK_USER_AGENT",
  "READBOOK_FIRECRAWL_PROXY",
] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  closeDb(); // fresh in-memory database (READBOOK_DB_PATH=":memory:")
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  closeDb();
});

describe("firecrawlApiKey", () => {
  it("defaults to null", () => {
    expect(firecrawlApiKey()).toEqual({ value: null, source: "default" });
  });
  it("reads the env (trimmed); whitespace-only counts as unset", () => {
    process.env.FIRECRAWL_API_KEY = "  fc-env-key  ";
    expect(firecrawlApiKey()).toEqual({ value: "fc-env-key", source: "env" });
    process.env.FIRECRAWL_API_KEY = "   ";
    expect(firecrawlApiKey().source).toBe("default");
  });
  it("a saved setting beats the env", () => {
    process.env.FIRECRAWL_API_KEY = "fc-env-key";
    setSetting("firecrawlApiKey", "fc-saved-key");
    expect(firecrawlApiKey()).toEqual({ value: "fc-saved-key", source: "settings" });
  });
  it("clearing the setting falls back to the env", () => {
    process.env.FIRECRAWL_API_KEY = "fc-env-key";
    setSetting("firecrawlApiKey", "fc-saved-key");
    setSetting("firecrawlApiKey", null);
    expect(firecrawlApiKey().source).toBe("env");
  });
});

describe("describeFirecrawlKey", () => {
  it("never exposes the raw key", () => {
    setSetting("firecrawlApiKey", "fc-1234567890abcdef");
    const described = describeFirecrawlKey();
    expect(described).toEqual({ configured: true, source: "settings", preview: "fc-1…cdef" });
    expect(JSON.stringify(described)).not.toContain("1234567890ab");
  });
  it("reports an unconfigured key", () => {
    expect(describeFirecrawlKey()).toEqual({ configured: false, source: "default", preview: null });
  });
});

describe("allowPrivateNetwork", () => {
  it("defaults to false", () => {
    expect(allowPrivateNetwork()).toEqual({ value: false, source: "default" });
  });
  it.each([
    ["1", true],
    ["true", true],
    ["YES", true],
    [" True ", true],
    ["0", false],
    ["false", false],
    ["", false],
    ["nope", false],
  ])("env %j → %s", (raw, expected) => {
    process.env.READBOOK_ALLOW_PRIVATE_NETWORK = raw;
    expect(allowPrivateNetwork()).toEqual({ value: expected, source: "env" });
  });
  it("a saved setting beats the env in both directions", () => {
    process.env.READBOOK_ALLOW_PRIVATE_NETWORK = "true";
    setSetting("allowPrivateNetwork", "false");
    expect(allowPrivateNetwork()).toEqual({ value: false, source: "settings" });

    process.env.READBOOK_ALLOW_PRIVATE_NETWORK = "false";
    setSetting("allowPrivateNetwork", "true");
    expect(allowPrivateNetwork()).toEqual({ value: true, source: "settings" });
  });
});

describe("userAgent", () => {
  it("defaults to null (Readbook's own UA)", () => {
    expect(userAgent()).toEqual({ value: null, source: "default" });
  });
  it("env beats default, settings beat env", () => {
    process.env.READBOOK_USER_AGENT = " EnvAgent/1.0 ";
    expect(userAgent()).toEqual({ value: "EnvAgent/1.0", source: "env" });
    setSetting("userAgent", "SavedAgent/2.0");
    expect(userAgent()).toEqual({ value: "SavedAgent/2.0", source: "settings" });
  });
});

describe("firecrawlProxy", () => {
  it("defaults to basic", () => {
    expect(firecrawlProxy()).toEqual({ value: "basic", source: "default" });
  });
  it("accepts only basic|auto from env", () => {
    process.env.READBOOK_FIRECRAWL_PROXY = "auto";
    expect(firecrawlProxy()).toEqual({ value: "auto", source: "env" });
    process.env.READBOOK_FIRECRAWL_PROXY = "stealth";
    expect(firecrawlProxy()).toEqual({ value: "basic", source: "default" });
  });
  it("a saved setting beats the env; an invalid saved value is ignored", () => {
    process.env.READBOOK_FIRECRAWL_PROXY = "auto";
    setSetting("firecrawlProxy", "basic");
    expect(firecrawlProxy()).toEqual({ value: "basic", source: "settings" });
    setSetting("firecrawlProxy", "bogus");
    expect(firecrawlProxy()).toEqual({ value: "auto", source: "env" });
  });
});

describe("extractOptions", () => {
  it("collects every resolved value", () => {
    process.env.FIRECRAWL_API_KEY = "fc-env";
    process.env.READBOOK_FIRECRAWL_PROXY = "auto";
    setSetting("allowPrivateNetwork", "true");
    setSetting("userAgent", "Agent/1");
    expect(extractOptions()).toEqual({
      firecrawlApiKey: "fc-env",
      allowPrivateNetwork: true,
      userAgent: "Agent/1",
      firecrawlProxy: "auto",
    });
  });
  it("is Readability-only with private networks blocked by default", () => {
    expect(extractOptions()).toEqual({
      firecrawlApiKey: null,
      allowPrivateNetwork: false,
      userAgent: null,
      firecrawlProxy: "basic",
    });
  });
});
