import type { SourceKind } from "@readbook/core";

/**
 * Map a URL to its SourceKind. Detection is host-first because that is the only
 * signal we can trust before fetching; `generic` is the deliberate safe default
 * so an unknown link still collapses into the one Reading shape.
 */
export function classifySource(url: URL): SourceKind {
  const host = url.hostname.toLowerCase();

  // X/Twitter pages are client-rendered; the x adapter reads the public syndication JSON instead.
  if (host === "x.com" || host === "twitter.com" || host === "www.x.com" || host === "www.twitter.com") {
    return "x";
  }

  // reddit.com, www.reddit.com, old.reddit.com, np.reddit.com all share the JSON API.
  if (host === "reddit.com" || host.endsWith(".reddit.com")) {
    return "reddit";
  }

  // *.substack.com is the obvious case; custom-domain Substacks fall through to
  // `generic` and still extract well via Readability, so we accept that miss.
  if (host === "substack.com" || host.endsWith(".substack.com")) {
    return "substack";
  }

  return "generic";
}
