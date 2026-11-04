import sanitizeHtmlLib from "sanitize-html";

/**
 * Reader-grade allowlist. We keep only the structural + inline tags long-form
 * reading needs; everything else (scripts, styles, iframes, forms, embeds) is
 * dropped so the reader view stays calm and safe regardless of the source.
 */
const ALLOWED_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "img",
  "figure",
  "figcaption",
  "blockquote",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "em",
  "strong",
  "b",
  "i",
  "hr",
  "br",
];

/** Return `value` only if it is an absolute http(s) URL; anything else becomes null. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Resolve `value` against `base` (when given); leaves it untouched if it can't be parsed. */
function absolutize(value: string | undefined, base: string | undefined): string | undefined {
  if (!value || !base) return value;
  try {
    return new URL(value.trim(), base).toString();
  } catch {
    return value;
  }
}

/** Absolutize every URL in a `srcset` ("a.jpg 1x, b.jpg 2x"). */
function absolutizeSrcset(value: string | undefined, base: string | undefined): string | undefined {
  if (!value || !base) return value;
  return value
    .split(",")
    .map((candidate) => {
      const [src, ...descriptor] = candidate.trim().split(/\s+/);
      return [absolutize(src, base), ...descriptor].filter(Boolean).join(" ");
    })
    .join(", ");
}

/**
 * Sanitize extracted HTML into render-ready markup. Links always open in a new
 * tab with `noopener noreferrer` so a stored article can never reach back into
 * the app's window via `window.opener`.
 *
 * Pass the article's URL as `baseUrl` so relative links and images
 * ("/img/a.png") resolve to the original site instead of to Readbook itself.
 */
export function sanitizeHtml(html: string, baseUrl?: string): string {
  return sanitizeHtmlLib(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "srcset", "alt", "loading", "referrerpolicy"],
    },
    // Explicit (these match sanitize-html's defaults) so a future library change
    // can't quietly let javascript:/data: URLs into stored articles.
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    // Drop the contents of these entirely rather than escaping them as text.
    disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attribs) => {
        const href = absolutize(attribs.href, baseUrl);
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(href ? { href } : {}),
            target: "_blank",
            rel: "noopener noreferrer",
          },
        };
      },
      img: (tagName, attribs) => {
        const src = absolutize(attribs.src, baseUrl);
        const srcset = absolutizeSrcset(attribs.srcset, baseUrl);
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(src ? { src } : {}),
            ...(srcset ? { srcset } : {}),
            // Never leak the reader's URL to image hosts, and stay lazy.
            loading: "lazy",
            referrerpolicy: "no-referrer",
          },
        };
      },
    },
  });
}
