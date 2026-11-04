import type { LookupAddress } from "node:dns";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertFetchableUrl, isBlockedAddress, safeFetch, SafeFetchError } from "./net";

/**
 * A fake resolver for `*.test` names, so the resolved-IP check inside
 * safeFetch's socket `lookup` hook can be exercised without real DNS: a public
 * looking name that resolves to a private address (the DNS-rebinding / SSRF
 * case) must be refused at connect time. Every other name uses the real lookup.
 */
const FAKE_DNS: Record<string, LookupAddress[]> = {
  "rebind.test": [{ address: "127.0.0.1", family: 4 }],
  "mixed.test": [
    { address: "10.0.0.1", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ],
  "mapped.test": [{ address: "::ffff:127.0.0.1", family: 6 }],
};

vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  type Callback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
  const lookup = (hostname: string, options: unknown, callback: Callback): void => {
    const hit = FAKE_DNS[hostname];
    if (!hit) return (actual.lookup as (h: string, o: unknown, c: Callback) => void)(hostname, options, callback);
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    const first = hit[0]!;
    process.nextTick(() => (all ? callback(null, hit) : callback(null, first.address, first.family)));
  };
  return { ...actual, default: { ...actual, lookup }, lookup };
});

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT / Tailscale
    "100.127.255.255",
    "224.0.0.1", // multicast
    "239.255.255.250",
    "255.255.255.255", // broadcast
    "198.18.0.1",
    "192.0.2.1",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1", // v6 multicast
    "64:ff9b::a00:1", // NAT64
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1", // hex-mapped 10.0.0.1
    "::ffff:7f00:1", // hex-mapped 127.0.0.1
    "::ffff:a9fe:a9fe", // hex-mapped 169.254.169.254
    "0:0:0:0:0:ffff:7f00:1",
    "::FFFF:7F00:1",
    "not-an-ip",
    "",
  ])("blocks %j", (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "100.63.255.255", // just below CGNAT
    "100.128.0.0", // just above CGNAT
    "172.32.0.1", // just above 172.16/12
    "223.255.255.255", // just below multicast
    "2606:4700::6810:84e5",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
    "::ffff:808:808", // hex-mapped 8.8.8.8
  ])("allows %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe("assertFetchableUrl", () => {
  it.each(["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)", "data:text/html,hi", "gopher://x"])(
    "rejects scheme of %s",
    (url) => {
      expect(() => assertFetchableUrl(url)).toThrow(/http/);
      // Allowing private networks never relaxes the scheme rule.
      expect(() => assertFetchableUrl(url, true)).toThrow(SafeFetchError);
    },
  );

  it("rejects strings that are not URLs", () => {
    try {
      assertFetchableUrl("not a url");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SafeFetchError);
      expect((err as SafeFetchError).code).toBe("scheme");
    }
  });

  it("rejects literal private hosts unless allowed", () => {
    expect(() => assertFetchableUrl("http://127.0.0.1:4321/")).toThrow(/private/);
    expect(assertFetchableUrl("http://127.0.0.1:4321/", true).hostname).toBe("127.0.0.1");
  });

  it.each([
    "http://[::1]/",
    "http://[::ffff:7f00:1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://0x7f000001/", // WHATWG URL normalizes hex/decimal IPv4 forms
    "http://2130706433/",
    "http://127.1/",
  ])("rejects literal private host %s", (url) => {
    expect(() => assertFetchableUrl(url)).toThrow(SafeFetchError);
  });

  it.each(["http://localhost/", "http://LOCALHOST:4321/", "http://app.localhost/", "http://a.b.localhost:8080/x"])(
    "rejects the localhost name %s unless allowed",
    (url) => {
      try {
        assertFetchableUrl(url);
        expect.unreachable();
      } catch (err) {
        expect((err as SafeFetchError).code).toBe("blocked-address");
      }
      expect(assertFetchableUrl(url, true)).toBeInstanceOf(URL);
    },
  );

  it("accepts public names (DNS is checked later, at connect time)", () => {
    expect(assertFetchableUrl("https://paulgraham.com/greatwork.html").hostname).toBe("paulgraham.com");
    expect(assertFetchableUrl("https://localhost.example.com/").hostname).toBe("localhost.example.com");
  });
});

/**
 * A real HTTP server on 127.0.0.1, port 0. Since it lives on loopback, every
 * request except the "refuses by default" ones must opt into allowPrivateNetwork.
 */
describe("safeFetch against a local server", () => {
  let server: Server;
  let base: string;

  const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {
    "/hello": (_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<p>hello</p>");
    },
    "/echo-headers": (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.headers));
    },
    "/redirect": (_req, res) => {
      res.writeHead(302, { location: "/hello" });
      res.end();
    },
    "/redirect-loop": (_req, res) => {
      res.writeHead(301, { location: "/redirect-loop" });
      res.end();
    },
    "/redirect-file": (_req, res) => {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
    },
    "/gzip": (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "content-encoding": "gzip" });
      res.end(gzipSync(Buffer.from("compressed café")));
    },
    "/gzip-bomb": (_req, res) => {
      // ~10 KB on the wire, 10 MB once inflated.
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
      res.end(gzipSync(Buffer.alloc(10 * 1024 * 1024)));
    },
    "/big-declared": (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "content-length": String(5000) });
      res.end("x".repeat(5000));
    },
    "/big-chunked": (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" }); // no content-length → chunked
      for (let i = 0; i < 10; i++) res.write("y".repeat(1000));
      res.end();
    },
    "/latin1": (_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=iso-8859-1" });
      res.end(Buffer.from([0x63, 0x61, 0x66, 0xe9])); // "café" in Latin-1
    },
    "/not-found": (_req, res) => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("nope");
    },
    "/slow": () => {
      // Never respond; the client deadline must fire.
    },
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const route = routes[new URL(req.url ?? "/", "http://x").pathname];
      if (route) route(req, res);
      else {
        res.writeHead(500);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function failure(promise: Promise<unknown>): Promise<SafeFetchError> {
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SafeFetchError);
    return err as SafeFetchError;
  }

  it("refuses 127.0.0.1 by default", async () => {
    const err = await failure(safeFetch(`${base}/hello`));
    expect(err.code).toBe("blocked-address");
  });

  it("refuses localhost by name by default", async () => {
    const port = new URL(base).port;
    const err = await failure(safeFetch(`http://localhost:${port}/hello`));
    expect(err.code).toBe("blocked-address");
  });

  it.each(["rebind.test", "mixed.test", "mapped.test"])(
    "refuses a name (%s) that resolves to private addresses, at connect time",
    async (name) => {
      const port = new URL(base).port;
      // The literal-host check passes (it is a normal-looking name)...
      expect(assertFetchableUrl(`http://${name}:${port}/`).hostname).toBe(name);
      // ...but the resolved IP is checked before the socket connects.
      const err = await failure(safeFetch(`http://${name}:${port}/hello`));
      expect(err.code).toBe("blocked-address");
    },
  );

  it("connects to a privately-resolving name when allowPrivateNetwork is true", async () => {
    const port = new URL(base).port;
    const res = await safeFetch(`http://rebind.test:${port}/hello`, { allowPrivateNetwork: true });
    expect(res.status).toBe(200);
    expect(res.text()).toBe("<p>hello</p>");
  });

  it("fetches when allowPrivateNetwork is true", async () => {
    const res = await safeFetch(`${base}/hello`, { allowPrivateNetwork: true });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.contentType).toMatch(/text\/html/);
    expect(res.text()).toBe("<p>hello</p>");
    expect(res.url).toBe(`${base}/hello`);
  });

  it("sends the configured User-Agent and Accept, and asks for compression", async () => {
    const res = await safeFetch(`${base}/echo-headers`, {
      allowPrivateNetwork: true,
      userAgent: "ReadbookTest/1.0",
      accept: "text/html",
    });
    const headers = res.json() as Record<string, string>;
    expect(headers["user-agent"]).toBe("ReadbookTest/1.0");
    expect(headers.accept).toBe("text/html");
    expect(headers["accept-encoding"]).toContain("gzip");
  });

  it("follows a redirect and reports the final URL", async () => {
    const res = await safeFetch(`${base}/redirect`, { allowPrivateNetwork: true });
    expect(res.status).toBe(200);
    expect(res.text()).toBe("<p>hello</p>");
    expect(res.url).toBe(`${base}/hello`);
  });

  it("gives up after maxRedirects hops", async () => {
    const err = await failure(safeFetch(`${base}/redirect-loop`, { allowPrivateNetwork: true, maxRedirects: 3 }));
    expect(err.code).toBe("redirects");
  });

  it("re-validates the redirect target (no hop to file:)", async () => {
    const err = await failure(safeFetch(`${base}/redirect-file`, { allowPrivateNetwork: true }));
    expect(err.code).toBe("scheme");
  });

  it("decompresses gzip bodies", async () => {
    const res = await safeFetch(`${base}/gzip`, { allowPrivateNetwork: true });
    expect(res.text()).toBe("compressed café");
  });

  it("caps the decompressed size (gzip bomb)", async () => {
    const err = await failure(safeFetch(`${base}/gzip-bomb`, { allowPrivateNetwork: true, maxBytes: 64 * 1024 }));
    expect(err.code).toBe("too-large");
  });

  it("refuses a declared Content-Length above maxBytes", async () => {
    const err = await failure(safeFetch(`${base}/big-declared`, { allowPrivateNetwork: true, maxBytes: 1000 }));
    expect(err.code).toBe("too-large");
  });

  it("enforces maxBytes on a chunked body with no Content-Length", async () => {
    const err = await failure(safeFetch(`${base}/big-chunked`, { allowPrivateNetwork: true, maxBytes: 5000 }));
    expect(err.code).toBe("too-large");
    const ok = await safeFetch(`${base}/big-chunked`, { allowPrivateNetwork: true, maxBytes: 20_000 });
    expect(ok.body.length).toBe(10_000);
  });

  it("decodes the charset from Content-Type", async () => {
    const res = await safeFetch(`${base}/latin1`, { allowPrivateNetwork: true });
    expect(res.text()).toBe("café");
  });

  it("returns non-2xx responses instead of throwing", async () => {
    const res = await safeFetch(`${base}/not-found`, { allowPrivateNetwork: true });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.text()).toBe("nope");
  });

  it("times out a server that never answers", async () => {
    const err = await failure(safeFetch(`${base}/slow`, { allowPrivateNetwork: true, timeoutMs: 200 }));
    expect(err.code).toBe("timeout");
  });
});

describe("isBlockedAddress — IPv6 forms that embed IPv4", () => {
  it.each(["::7f00:1", "::ffff:0:7f00:1", "2002:7f00:1::", "2001:0:4136:e378::1", "64:ff9b:1::a00:1"])("blocks %s", (ip) =>
    expect(isBlockedAddress(ip)).toBe(true),
  );
});
