import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allowedHosts, hostnameOf, isAllowedHost, isSameOrigin, SECURITY_HEADERS, UNSAFE_METHODS } from "./guard";

const ENV_KEY = "READBOOK_ALLOWED_HOSTS";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

describe("hostnameOf", () => {
  it.each([
    ["localhost:4321", "localhost"],
    ["LocalHost", "localhost"],
    ["  127.0.0.1:80 ", "127.0.0.1"],
    ["[::1]:4321", "[::1]"],
    ["[::1]", "[::1]"],
    ["readbook.lan:8080", "readbook.lan"],
  ])("%s → %s", (header, expected) => expect(hostnameOf(header)).toBe(expected));
});

describe("allowedHosts", () => {
  it("parses a comma list, trimming and lowercasing", () => {
    const { any, hosts } = allowedHosts(" 192.168.1.20, Readbook.LAN ,,");
    expect(any).toBe(false);
    expect([...hosts]).toEqual(["192.168.1.20", "readbook.lan"]);
  });
  it("treats * as allow-any", () => expect(allowedHosts("a.example,*").any).toBe(true));
  it("normalizes entries the way Host headers are parsed (port dropped, IPv6 bracketed)", () => {
    const { hosts } = allowedHosts("readbook.lan:8080, fe80::1, [fd00::2]:4321");
    expect([...hosts]).toEqual(["readbook.lan", "[fe80::1]", "[fd00::2]"]);
    expect(isAllowedHost("readbook.lan:4321", "readbook.lan:8080")).toBe(true);
    expect(isAllowedHost("[fe80::1]:4321", "fe80::1")).toBe(true);
    expect(isAllowedHost("[fe80::2]:4321", "fe80::1")).toBe(false);
  });
  it("is empty by default", () => {
    const { any, hosts } = allowedHosts();
    expect(any).toBe(false);
    expect(hosts.size).toBe(0);
  });
  it("reads READBOOK_ALLOWED_HOSTS when no value is passed", () => {
    process.env[ENV_KEY] = "phone.lan";
    expect(allowedHosts().hosts.has("phone.lan")).toBe(true);
  });
});

describe("isAllowedHost", () => {
  it.each(["localhost:4321", "localhost", "127.0.0.1:4321", "[::1]:4321", "app.localhost:4321", "LOCALHOST"])(
    "allows loopback %s",
    (host) => expect(isAllowedHost(host)).toBe(true),
  );

  it.each(["evil.example", "evil.example:4321", "192.168.1.20:4321", "localhost.evil.example", "127.0.0.2"])(
    "rejects %s by default",
    (host) => expect(isAllowedHost(host)).toBe(false),
  );

  it("rejects a missing Host header", () => {
    expect(isAllowedHost(null)).toBe(false);
    expect(isAllowedHost("")).toBe(false);
  });

  it("allows hosts listed in READBOOK_ALLOWED_HOSTS (port ignored, case-insensitive)", () => {
    process.env[ENV_KEY] = "192.168.1.20, readbook.lan";
    expect(isAllowedHost("192.168.1.20:4321")).toBe(true);
    expect(isAllowedHost("Readbook.LAN")).toBe(true);
    expect(isAllowedHost("other.lan")).toBe(false);
  });

  it("allows anything with *", () => {
    process.env[ENV_KEY] = "*";
    expect(isAllowedHost("anything.example")).toBe(true);
    // ...but still not a missing header.
    expect(isAllowedHost(null)).toBe(false);
  });

  it("an explicit allow-list argument overrides the environment", () => {
    process.env[ENV_KEY] = "*";
    expect(isAllowedHost("evil.example", "")).toBe(false);
    expect(isAllowedHost("readbook.lan", "readbook.lan")).toBe(true);
  });
});

describe("isSameOrigin", () => {
  const url = new URL("http://localhost:4321/api/add");
  const req = (headers: Record<string, string>) =>
    new Request(url, { method: "POST", headers });

  it("accepts a matching Origin", () => {
    expect(isSameOrigin(req({ origin: "http://localhost:4321" }), url)).toBe(true);
  });

  it.each([
    "http://evil.example",
    "http://localhost:9999",
    "http://127.0.0.1:4321", // same server, different origin string — still cross-origin
    "null",
    "not a url",
  ])("rejects Origin %s", (origin) => {
    expect(isSameOrigin(req({ origin }), url)).toBe(false);
  });

  it("Origin wins over a permissive Sec-Fetch-Site", () => {
    expect(isSameOrigin(req({ origin: "http://evil.example", "sec-fetch-site": "same-origin" }), url)).toBe(false);
  });

  it("falls back to Sec-Fetch-Site when there is no Origin", () => {
    expect(isSameOrigin(req({ "sec-fetch-site": "same-origin" }), url)).toBe(true);
    expect(isSameOrigin(req({ "sec-fetch-site": "none" }), url)).toBe(true);
    expect(isSameOrigin(req({ "sec-fetch-site": "cross-site" }), url)).toBe(false);
    expect(isSameOrigin(req({ "sec-fetch-site": "same-site" }), url)).toBe(false);
  });

  it("lets non-browser clients (no Origin, no Sec-Fetch-Site) through", () => {
    expect(isSameOrigin(req({}), url)).toBe(true);
  });
});

describe("constants", () => {
  it("guards exactly the state-changing methods", () => {
    expect([...UNSAFE_METHODS].sort()).toEqual(["DELETE", "PATCH", "POST", "PUT"]);
    expect(UNSAFE_METHODS.has("GET")).toBe(false);
  });
  it("sets the expected security headers", () => {
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("no-referrer");
  });
});

describe("hostnameOf rejects malformed Host headers", () => {
  it.each(["localhost@evil.com", "localhost evil", "localhost:80:81", "[::1", "localhost:abc", "localhost/x"])("%s → empty", (h) => {
    expect(hostnameOf(h)).toBe("");
  });
  it.each([
    ["localhost:4321", "localhost"],
    ["[::1]:4321", "[::1]"],
    ["127.0.0.1", "127.0.0.1"],
    ["Readbook.LAN:8080", "readbook.lan"],
  ])("%s → %s", (h, expected) => expect(hostnameOf(h)).toBe(expected));
});
