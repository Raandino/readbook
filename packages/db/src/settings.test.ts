import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getSetting, maskSecret, SETTING_KEYS, setSetting } from "./index.js";

beforeEach(() => {
  closeDb();
});

describe("settings", () => {
  it("lists exactly the supported keys", () => {
    expect([...SETTING_KEYS].sort()).toEqual(["allowPrivateNetwork", "firecrawlApiKey", "firecrawlProxy", "userAgent"]);
  });

  it("returns null for an unset key", () => {
    for (const key of SETTING_KEYS) expect(getSetting(key)).toBeNull();
  });

  it("sets, overwrites and reads back", () => {
    setSetting("firecrawlApiKey", "fc-one");
    expect(getSetting("firecrawlApiKey")).toBe("fc-one");
    setSetting("firecrawlApiKey", "fc-two");
    expect(getSetting("firecrawlApiKey")).toBe("fc-two");
    // Other keys are independent.
    expect(getSetting("userAgent")).toBeNull();
  });

  it("clears with null or an empty string", () => {
    setSetting("userAgent", "UA/1");
    setSetting("userAgent", null);
    expect(getSetting("userAgent")).toBeNull();

    setSetting("firecrawlProxy", "auto");
    setSetting("firecrawlProxy", "");
    expect(getSetting("firecrawlProxy")).toBeNull();
  });

  it("clearing an unset key is harmless", () => {
    expect(() => setSetting("allowPrivateNetwork", null)).not.toThrow();
  });

  it("keeps values verbatim (no trimming or coercion)", () => {
    setSetting("allowPrivateNetwork", "true");
    expect(getSetting("allowPrivateNetwork")).toBe("true");
    setSetting("userAgent", "  spaced  ");
    expect(getSetting("userAgent")).toBe("  spaced  ");
  });

  it("does not survive a fresh in-memory database", () => {
    setSetting("firecrawlApiKey", "fc-one");
    closeDb();
    expect(getSetting("firecrawlApiKey")).toBeNull();
  });
});

describe("maskSecret", () => {
  it("shows only the first and last four characters of a long secret", () => {
    expect(maskSecret("fc-1234567890abcdef")).toBe("fc-1…cdef");
  });

  it("fully masks short secrets", () => {
    expect(maskSecret("short")).toBe("•••••");
    expect(maskSecret("0123456789")).toBe("••••••••••");
    expect(maskSecret("")).toBe("");
  });

  it("never contains the middle of the secret", () => {
    const secret = "fc-SECRETMIDDLEPART-0000";
    expect(maskSecret(secret)).not.toContain("SECRETMIDDLEPART");
  });
});
