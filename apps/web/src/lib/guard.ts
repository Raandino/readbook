/**
 * Pure request-guard logic used by `src/middleware.ts`. Kept free of `astro:*`
 * imports so it can be unit-tested directly (see guard.test.ts).
 *
 * Readbook has no login: anything that can talk to the server owns your shelf.
 * Two checks keep a hostile web page in another tab from reaching it:
 *
 * - `isAllowedHost` defeats DNS rebinding by only answering requests whose
 *   `Host` header is one we expect (localhost by default).
 * - `isSameOrigin` defeats cross-site form/fetch posts by requiring a
 *   same-origin `Origin` (or `Sec-Fetch-Site`) on state-changing requests.
 */

/** Methods that change state and therefore need the same-origin check. */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Extra hostnames allowed in the Host header, e.g. when you bind to 0.0.0.0 to
 * read from your phone on the LAN: READBOOK_ALLOWED_HOSTS=192.168.1.20,readbook.lan
 * Use "*" to disable the check entirely (not recommended).
 */
export function allowedHosts(raw: string = process.env.READBOOK_ALLOWED_HOSTS ?? ""): {
  any: boolean;
  hosts: Set<string>;
} {
  const list = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return { any: list.includes("*"), hosts: new Set(list.map(normalizeEntry)) };
}

/**
 * Bring an allow-list entry into the same shape `hostnameOf` produces, so
 * "readbook.lan:8080" matches by hostname and a bare IPv6 "fe80::1" matches the
 * bracketed "[fe80::1]" form browsers put in the Host header.
 */
function normalizeEntry(entry: string): string {
  if (entry === "*") return entry;
  if (!entry.startsWith("[") && (entry.match(/:/g)?.length ?? 0) > 1) return `[${entry}]`;
  return hostnameOf(entry);
}

/** The hostname part of a Host header: "LocalHost:4321" → "localhost", "[::1]:4321" → "[::1]". */
export function hostnameOf(hostHeader: string): string {
  // Accept exactly `host[:port]` (IPv6 in brackets). Anything malformed yields
  // "", which never matches an allowed host.
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/.exec(hostHeader.trim().toLowerCase());
  return match?.[1] ?? "";
}

/**
 * True if the server should answer a request with this Host header. Loopback
 * names always pass; anything else must be listed in READBOOK_ALLOWED_HOSTS
 * (pass `allowedRaw` to override the environment, e.g. in tests).
 */
export function isAllowedHost(hostHeader: string | null, allowedRaw?: string): boolean {
  if (!hostHeader) return false;
  const hostname = hostnameOf(hostHeader);
  if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) return true;
  const { any, hosts } = allowedHosts(allowedRaw);
  return any || hosts.has(hostname);
}

/** Same-origin check for state-changing requests. */
export function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin === "null") return false;
    try {
      return new URL(origin).host === url.host;
    } catch {
      return false;
    }
  }
  // No Origin: modern browsers still send Sec-Fetch-Site. Absent both, it is
  // not a browser (curl, scripts on this machine) — those already have full
  // local access, so we let them through.
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

/** Conservative headers added to every response that doesn't already set them. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
