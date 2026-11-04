/**
 * Request guard for a no-auth, local-first app.
 *
 * Readbook has no login: anything that can talk to the server owns your shelf.
 * That is fine on your own machine, but two browser tricks can reach a
 * localhost server from a hostile web page you happen to have open:
 *
 * 1. Cross-site requests — a page on evil.example POSTs a form to
 *    http://localhost:4321/api/add. Blocked by requiring a same-origin
 *    `Origin` (or `Sec-Fetch-Site`) on every state-changing request.
 * 2. DNS rebinding — evil.example re-resolves to 127.0.0.1 so the browser
 *    treats our server as same-origin with it. Blocked by only answering
 *    requests whose `Host` header is one we expect (localhost by default).
 *
 * Plus a set of conservative security headers on every response. The pure
 * checks live in lib/guard.ts (unit-tested); this file only wires them up.
 */
import { defineMiddleware } from "astro:middleware";
import { isAllowedHost, isSameOrigin, SECURITY_HEADERS, UNSAFE_METHODS } from "./lib/guard";

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;

  if (!isAllowedHost(request.headers.get("host"))) {
    return new Response(
      "Readbook only answers on localhost. To allow another hostname, set READBOOK_ALLOWED_HOSTS.",
      { status: 421, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  if (UNSAFE_METHODS.has(request.method) && !isSameOrigin(request, url)) {
    return new Response(JSON.stringify({ error: "Cross-site request blocked." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const response = await next();
  try {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
  } catch {
    // Some responses (e.g. Response.redirect) have immutable headers; skip them.
  }
  return response;
});
