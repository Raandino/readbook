/**
 * safeFetch — the only way the extractor talks to the network.
 *
 * Readbook fetches URLs that a human pasted, which makes the server a classic
 * SSRF target: a link (or a cross-site request forged by some other tab) could
 * point at `http://127.0.0.1:…`, your router, or a cloud metadata endpoint. So
 * every request here:
 *
 * - only speaks http/https;
 * - refuses loopback, private, link-local, CGNAT, multicast and other
 *   special-purpose addresses — checked on the *resolved* IP inside the socket
 *   `lookup` hook, so DNS tricks (a public name that resolves to 10.0.0.1, or a
 *   rebinding between check and connect) cannot slip past;
 * - re-validates every redirect hop the same way;
 * - has a hard deadline and a decompressed-size cap so a hostile server can't
 *   hang the app or exhaust memory.
 *
 * `allowPrivateNetwork` turns the address check off for people who knowingly
 * read from a home-lab wiki or intranet.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { pipeline, type Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { READBOOK_USER_AGENT } from "@readbook/core";

export interface SafeFetchOptions {
  accept?: string;
  /** Max decompressed body size in bytes. Default 10 MB. */
  maxBytes?: number;
  /** Whole-request deadline (all redirects included). Default 20 s. */
  timeoutMs?: number;
  /** Max redirect hops to follow. Default 5. */
  maxRedirects?: number;
  allowPrivateNetwork?: boolean;
  userAgent?: string;
}

export interface SafeResponse {
  /** Final URL after redirects. */
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  body: Buffer;
  text(): string;
  json(): unknown;
}

/** Thrown for any network-level refusal or failure (bad scheme, blocked host, timeout, too large). */
export class SafeFetchError extends Error {
  readonly code: "scheme" | "blocked-address" | "timeout" | "too-large" | "redirects" | "network";

  constructor(code: SafeFetchError["code"], message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SafeFetchError";
    this.code = code;
  }
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Special-purpose ranges that a "read this article" fetch never needs to reach. */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT / Tailscale
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata lives here)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 96], // unspecified, loopback and IPv4-compatible (::a.b.c.d)
  ["::ffff:0:0:0", 96], // IPv4-translated
  ["64:ff9b::", 96], // NAT64 (can embed private v4)
  ["64:ff9b:1::", 48], // local-use NAT64
  ["2001::", 32], // Teredo (embeds an IPv4 address)
  ["2002::", 16], // 6to4 (embeds an IPv4 address)
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

/** True if `address` (a literal IPv4/IPv6) is in a range we refuse to connect to. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, "ipv4");
  if (family !== 6) return true; // not an IP at all — refuse rather than guess
  const lower = address.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:10.0.0.1 or ::ffff:a00:1): judge the embedded v4.
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(.+)$/.exec(lower)?.[1];
  if (mapped) {
    if (isIP(mapped) === 4) return BLOCKED.check(mapped, "ipv4");
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
    if (hex?.[1] && hex[2]) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
      const v4 = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
      return BLOCKED.check(v4, "ipv4");
    }
  }
  return BLOCKED.check(lower, "ipv6");
}

/** Parse and vet a URL for fetching: http(s) only, and literal IP hosts checked up front. */
export function assertFetchableUrl(raw: string, allowPrivateNetwork = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new SafeFetchError("scheme", `Not a valid URL: ${raw}`, cause);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("scheme", `Only http and https links can be read (got ${url.protocol})`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivateNetwork) {
    if (isIP(host) && isBlockedAddress(host)) {
      throw new SafeFetchError("blocked-address", blockedMessage(url.hostname));
    }
    if (host === "localhost" || host.endsWith(".localhost")) {
      throw new SafeFetchError("blocked-address", blockedMessage(url.hostname));
    }
  }
  return url;
}

function blockedMessage(host: string): string {
  return `Refusing to fetch ${host}: it points at a local or private network address. Enable "Allow private network" in Settings if you really mean it.`;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `lookup` for http(s).request that resolves the host and drops blocked
 * addresses before the socket connects. Supports both the single-address and
 * `all: true` (Happy Eyeballs) calling conventions Node uses.
 */
function guardedLookup(allowPrivateNetwork: boolean) {
  return (hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback): void => {
    dnsLookup(hostname, { family: options.family ?? 0, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      const usable = allowPrivateNetwork ? addresses : addresses.filter((a) => !isBlockedAddress(a.address));
      const first = usable[0];
      if (!first) {
        return callback(new SafeFetchError("blocked-address", blockedMessage(hostname)) as NodeJS.ErrnoException, []);
      }
      if (options.all) callback(null, usable);
      else callback(null, first.address, first.family);
    });
  };
}

/**
 * Wrap the response stream in the right decompressor for its Content-Encoding.
 * `pipeline` (not `.pipe`) so an error on the socket side — e.g. a connection
 * cut mid-body — reaches `onError` instead of leaving the request hanging.
 */
function decoded(res: IncomingMessage, onError: (err: unknown) => void): Readable {
  const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
  const decoder =
    encoding === "gzip" || encoding === "x-gzip"
      ? createGunzip()
      : encoding === "deflate"
        ? createInflate()
        : encoding === "br"
          ? createBrotliDecompress()
          : null;
  if (!decoder) {
    res.on("error", onError);
    res.on("aborted", () => onError(new Error("Connection closed before the page finished")));
    return res;
  }
  return pipeline(res, decoder, (err) => {
    if (err) onError(err);
  });
}

/** Decode a body using the charset from Content-Type, defaulting to UTF-8. */
function decodeText(body: Buffer, contentType: string): string {
  const charset = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

interface Hop {
  status: number;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

/** One request/response, no redirect handling. */
function requestOnce(url: URL, opts: Required<Omit<SafeFetchOptions, "maxRedirects">>, signal: AbortSignal): Promise<Hop> {
  return new Promise((resolvePromise, rejectPromise) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: "GET",
        headers: {
          "user-agent": opts.userAgent,
          accept: opts.accept,
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en-US,en;q=0.9",
        },
        lookup: guardedLookup(opts.allowPrivateNetwork) as never,
        signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Redirect bodies are irrelevant; don't buffer them.
        if (REDIRECT_STATUSES.has(status)) {
          res.resume();
          return resolvePromise({ status, headers: res.headers, body: Buffer.alloc(0) });
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          res.destroy();
          return rejectPromise(new SafeFetchError("too-large", `Page is too large to read (${declared} bytes)`));
        }
        const stream = decoded(res, (err) => rejectPromise(toSafeError(err, signal)));
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            // Reject first: destroying the stream also reports an abort error.
            rejectPromise(new SafeFetchError("too-large", `Page is larger than ${opts.maxBytes} bytes`));
            stream.destroy();
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolvePromise({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        stream.on("error", (err) => rejectPromise(toSafeError(err, signal)));
      },
    );
    req.on("error", (err) => rejectPromise(toSafeError(err, signal)));
    req.end();
  });
}

function toSafeError(err: unknown, signal: AbortSignal): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  // Node wraps errors thrown from `lookup`; surface ours unchanged.
  const cause = (err as { cause?: unknown } | null)?.cause;
  if (cause instanceof SafeFetchError) return cause;
  if (signal.aborted) return new SafeFetchError("timeout", "The site took too long to respond", err);
  const message = err instanceof Error ? err.message : String(err);
  return new SafeFetchError("network", message, err);
}

/**
 * GET a URL with SSRF protection, redirect re-validation, a deadline, and a
 * size cap. Non-2xx responses are returned (check `ok`), not thrown; only
 * network-level failures throw `SafeFetchError`.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const opts = {
    accept: options.accept ?? "*/*",
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    allowPrivateNetwork: options.allowPrivateNetwork ?? false,
    userAgent: options.userAgent ?? READBOOK_USER_AGENT,
  };
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const signal = AbortSignal.timeout(opts.timeoutMs);

  let url = assertFetchableUrl(rawUrl, opts.allowPrivateNetwork);
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, opts, signal);
    const location = res.headers.location;
    if (REDIRECT_STATUSES.has(res.status) && location) {
      if (hop >= maxRedirects) throw new SafeFetchError("redirects", `Too many redirects for ${rawUrl}`);
      url = assertFetchableUrl(new URL(location, url).toString(), opts.allowPrivateNetwork);
      continue;
    }
    const contentType = String(res.headers["content-type"] ?? "");
    const finalUrl = url.toString();
    return {
      url: finalUrl,
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      contentType,
      body: res.body,
      text: () => decodeText(res.body, contentType),
      json: () => JSON.parse(decodeText(res.body, contentType)) as unknown,
    };
  }
}
