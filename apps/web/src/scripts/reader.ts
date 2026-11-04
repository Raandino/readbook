/**
 * Reader progress: marks an unread Reading "reading" on open, restores the
 * saved scroll position, persists progress (throttled) as you scroll, flips to
 * "read" near the end, and saves the final position when you leave.
 *
 * Status only ever moves forward: re-opening something already read keeps it
 * "read", and an archived piece stays archived (only its position is saved).
 *
 * Bundled module (the CSP forbids inline scripts). Server data comes from
 * data-* attributes on #reader-root.
 */

const root = document.getElementById("reader-root");
const id = root?.dataset.readingId;

if (root && id) {
  const startProgress = Number(root.dataset.startProgress ?? "0") || 0;
  const status = root.dataset.status ?? "unread";
  const endpoint = `/api/readings/${encodeURIComponent(id)}`;
  const bar = document.getElementById("read-progress");

  let lastSent = -1;
  /** Only unread/reading pieces get their status advanced. */
  const advancesStatus = status === "unread" || status === "reading";
  let markedRead = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = (patch: Record<string, unknown>, keepalive = false): void => {
    fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      keepalive,
    }).catch(() => {});
  };

  const scrollRange = (): number => document.documentElement.scrollHeight - window.innerHeight;

  const ratio = (): number => {
    const max = scrollRange();
    if (max <= 0) return 1;
    return Math.min(1, Math.max(0, window.scrollY / max));
  };

  const markRead = (keepalive = false): void => {
    markedRead = true;
    lastSent = 1;
    send({ status: "read", progress: 1 }, keepalive);
  };

  const paint = (): number => {
    const r = ratio();
    if (bar) bar.style.width = `${(r * 100).toFixed(1)}%`;
    return r;
  };

  // Throttle progress writes to once a second; only persist meaningful changes.
  const tick = (): void => {
    pending = false;
    const r = paint();
    if (advancesStatus && !markedRead && r >= 0.95) {
      markRead();
      return;
    }
    if (Math.abs(r - lastSent) >= 0.02) {
      lastSent = r;
      send({ progress: r });
    }
  };

  // Open => this is being read.
  if (status === "unread") send({ status: "reading" });

  // Restore the prior scroll position once layout settles — unless the link
  // points at a specific highlight (#hl-…), which the highlighter scrolls to.
  if (startProgress > 0.01 && startProgress < 0.98 && !location.hash.startsWith("#hl-")) {
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, max * startProgress);
    });
  }

  window.addEventListener(
    "scroll",
    () => {
      paint();
      if (pending) return;
      pending = true;
      clearTimeout(timer);
      timer = setTimeout(tick, 1000);
    },
    { passive: true },
  );

  // Persist the final position when leaving. `keepalive` lets the PATCH outlive
  // the page (sendBeacon can only POST, which this endpoint doesn't take).
  window.addEventListener("pagehide", () => {
    if (markedRead) return;
    const r = ratio();
    if (advancesStatus && r >= 0.95) markRead(true);
    else send({ progress: r }, true);
  });

  paint();

  // A piece that fits on one screen never scrolls, so it would never reach
  // "read". Count it read after a short dwell — if it still fits by then (late
  // images may have made it scrollable, and then scrolling takes over).
  if (advancesStatus && scrollRange() <= 0) {
    setTimeout(() => {
      if (!markedRead && scrollRange() <= 0 && document.visibilityState === "visible") markRead();
    }, 3000);
  }
}
