/**
 * feed.ts — progressive enhancement for the shelf (index.astro).
 *
 * The page is fully server-rendered: tabs are links, search is a GET form.
 * This module adds:
 *   - keyboard: "/" focuses search, Esc clears it, Cmd/Ctrl+Z undoes the last action
 *   - card actions (archive, mark read/unread, delete) applied in place, with
 *     tab counts kept in step and an "Undo" toast
 *   - delete is deferred: the DELETE request only goes out once the toast
 *     expires (or the page is left), so Undo is a true undo. In-page
 *     navigations (links, search, the add form's reload) wait for a pending
 *     DELETE first, so the next page never shows a card you just deleted.
 *   - scroll-to + a soft flash for the card that was just added (?added=<id>)
 *
 * Other scripts that navigate away (AddLinkForm) dispatch a cancelable
 * "readbook:navigate" event on document with the target URL as `detail`; if
 * a delete is pending this module cancels it and navigates once settled.
 */
import type { ReadingStatus } from "@readbook/core";

type Filter = ReadingStatus | "all";
type Action = "archive" | "unarchive" | "mark-read" | "mark-unread" | "delete";

const TOAST_MS = 6000;
/** Longest a navigation waits for a pending DELETE before going anyway. */
const SETTLE_MAX_MS = 2000;

const STATUS_LABEL: Record<ReadingStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  read: "Read",
  archived: "Archived",
};

const feed = document.querySelector<HTMLUListElement>("[data-feed]");
const emptyState = document.querySelector<HTMLElement>("[data-feed-empty]");
const search = document.getElementById("feed-q") as HTMLInputElement | null;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

const isStatus = (value: string | undefined): value is ReadingStatus =>
  value === "unread" || value === "reading" || value === "read" || value === "archived";

const filter: Filter = (() => {
  const value = feed?.dataset.filter;
  return isStatus(value) ? value : "all";
})();

/** "All" is everything except archived; every other tab is one status. */
const matchesFilter = (status: ReadingStatus): boolean =>
  filter === "all" ? status !== "archived" : status === filter;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

// ---- Search ----------------------------------------------------------------

/** The shelf URL for the current tab, with an optional search. */
function shelfUrl(query: string): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("status", filter);
  if (query) params.set("q", query);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

if (search) {
  const activeQuery = new URL(window.location.href).searchParams.get("q")?.trim() ?? "";

  search.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    search.value = "";
    // Drop the search but stay on the same tab.
    if (activeQuery) void navigateAfterSettle(shelfUrl(""));
    else search.blur();
  });

  // Submit through JS so the URL stays tidy (no "?q=" for an empty search)
  // and a pending delete lands before the next page renders.
  search.closest("form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void navigateAfterSettle(shelfUrl(search.value.trim().slice(0, 200)));
  });
}

// ---- Toast -----------------------------------------------------------------

interface ToastOptions {
  message: string;
  /** Offer an Undo button (and Cmd/Ctrl+Z) that runs this. */
  undo?: () => void;
  /**
   * Runs when the toast leaves without Undo — expiry, replacement, or page
   * exit. May return a promise so navigation can wait for it.
   */
  commit?: () => Promise<unknown> | void;
}

const toast = document.querySelector<HTMLElement>("[data-toast]");
const toastText = toast?.querySelector<HTMLElement>("[data-toast-text]") ?? null;
const toastUndo = toast?.querySelector<HTMLButtonElement>("[data-toast-undo]") ?? null;
// A separate, always-present live region: announcements are reliable even
// while the visual toast is hidden or being swapped.
const announcer = document.querySelector<HTMLElement>("[data-announcer]");

let active: ToastOptions | null = null;
/** The most recent commit still in flight (e.g. a DELETE request). */
let committing: Promise<unknown> | null = null;
let timer: number | undefined;
let remaining = TOAST_MS;
let startedAt = 0;
let paused = false;

function announce(message: string): void {
  if (!announcer) return;
  announcer.textContent = "";
  // Next frame, so repeating the same text is still announced.
  requestAnimationFrame(() => (announcer.textContent = message));
}

function startTimer(): void {
  window.clearTimeout(timer);
  startedAt = Date.now();
  timer = window.setTimeout(() => closeToast(true), remaining);
}

/** Close the toast. `commit` true = the action stands (run its commit hook). */
function closeToast(commit: boolean): void {
  window.clearTimeout(timer);
  const current = active;
  active = null;
  if (toast) toast.hidden = true;
  if (commit) track(current?.commit?.());
}

function track(result: Promise<unknown> | void): void {
  if (!result) return;
  const p = result.catch(() => undefined);
  committing = p;
  void p.finally(() => {
    if (committing === p) committing = null;
  });
}

/** Commit whatever the toast is holding and wait (bounded) for it to land. */
async function settle(): Promise<void> {
  if (active) closeToast(true);
  if (!committing) return;
  await Promise.race([committing, new Promise((resolve) => window.setTimeout(resolve, SETTLE_MAX_MS))]);
}

/** Navigate, but only after a pending delete has reached the server. */
async function navigateAfterSettle(href: string): Promise<void> {
  await settle();
  window.location.assign(href);
}

const hasPending = (): boolean => Boolean(active?.commit) || committing !== null;

function showToast(options: ToastOptions): void {
  // A newer action settles the previous one for good.
  if (active) closeToast(true);
  announce(
    options.undo ? `${options.message}. To undo, press ${isMac ? "Command" : "Control"}+Z.` : options.message,
  );
  if (!toast || !toastText || !toastUndo) {
    track(options.commit?.());
    return;
  }
  active = options;
  toastText.textContent = options.message;
  toastUndo.hidden = !options.undo;
  toastUndo.setAttribute("aria-label", `Undo: ${options.message}`);
  toast.hidden = false;
  remaining = TOAST_MS;
  paused = toast.matches(":hover") || toast.contains(document.activeElement);
  if (!paused) startTimer();
}

function undoActive(): void {
  const current = active;
  if (!current?.undo) return;
  active = null;
  window.clearTimeout(timer);
  if (toast) toast.hidden = true;
  current.undo();
}

if (toast && toastUndo) {
  toastUndo.addEventListener("click", undoActive);
  // Hold the timer while the reader is pointing at or focused on the toast.
  const pause = (): void => {
    if (paused || !active) return;
    paused = true;
    window.clearTimeout(timer);
    remaining = Math.max(1500, remaining - (Date.now() - startedAt));
  };
  const resume = (): void => {
    if (!paused) return;
    paused = false;
    if (active) startTimer();
  };
  toast.addEventListener("mouseenter", pause);
  toast.addEventListener("mouseleave", () => {
    if (!toast.contains(document.activeElement)) resume();
  });
  toast.addEventListener("focusin", pause);
  toast.addEventListener("focusout", (e) => {
    if (!toast.contains(e.relatedTarget as Node | null) && !toast.matches(":hover")) resume();
  });
}

// Same-origin links: commit a pending delete and let it land before leaving,
// or the next shelf (fetched before this page unloads) would still show it.
document.addEventListener("click", (e) => {
  if (!hasPending() || e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
  if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  e.preventDefault();
  void navigateAfterSettle(url.href);
});

// Other scripts on the page (the add form's reload) ask before navigating.
document.addEventListener("readbook:navigate", (e) => {
  const href = (e as CustomEvent<unknown>).detail;
  if (!hasPending() || typeof href !== "string") return;
  e.preventDefault();
  void navigateAfterSettle(href);
});

// Anything else that leaves the page (back button, closing the tab) settles a
// pending delete on the way out; keepalive lets the request outlive the page.
window.addEventListener("pagehide", () => {
  if (active) closeToast(true);
});

// ---- Keyboard shortcuts ----------------------------------------------------

document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || isEditable(e.target)) return;
  if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && search) {
    e.preventDefault();
    search.focus();
    search.select();
  } else if (e.key.toLowerCase() === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey && active?.undo) {
    e.preventDefault();
    undoActive();
  }
});

// ---- Counts, placement, empty state ----------------------------------------

function bumpCount(status: ReadingStatus, delta: number): void {
  const keys: Filter[] = status === "archived" ? ["archived"] : [status, "all"];
  for (const key of keys) {
    document.querySelectorAll<HTMLElement>(`[data-count-for="${key}"]`).forEach((el) => {
      el.textContent = String(Math.max(0, Number(el.textContent) + delta));
    });
  }
}

/** Keep "N results for …" honest as cards leave and return. */
function refreshSummary(): void {
  const summary = document.querySelector<HTMLElement>("[data-result-count]");
  if (!summary || !feed) return;
  const n = feed.children.length;
  summary.textContent = `${n} ${n === 1 ? "result" : "results"}`;
}

function refreshEmpty(): void {
  if (!feed || !emptyState) return;
  const isEmpty = feed.children.length === 0;
  feed.hidden = isEmpty;
  emptyState.hidden = !isEmpty;
  refreshSummary();
}

const cardLink = (wrap: Element | null | undefined): HTMLAnchorElement | null =>
  wrap?.querySelector<HTMLAnchorElement>("a.card") ?? null;

/** Take a card's list item out of view, moving focus to a neighbour if it was inside. */
function detach(item: HTMLElement): void {
  if (item.contains(document.activeElement)) {
    const neighbour = (item.nextElementSibling ?? item.previousElementSibling) as HTMLElement | null;
    const target = cardLink(neighbour) ?? (neighbour ? null : emptyState);
    item.remove();
    refreshEmpty();
    target?.focus({ preventScroll: false });
    return;
  }
  item.remove();
  refreshEmpty();
}

/** Put a list item back where it was (server order is recorded in data-order). */
function reattach(item: HTMLElement): void {
  if (!feed) return;
  const order = Number(item.dataset.order);
  const after = Array.from(feed.children).find((el) => Number((el as HTMLElement).dataset.order) > order);
  feed.insertBefore(item, after ?? null);
  refreshEmpty();
}

/** Reflect a status on the card itself (dot label + which actions show). */
function paintStatus(wrap: HTMLElement, status: ReadingStatus): void {
  wrap.dataset.status = status;
  const dot = wrap.querySelector<HTMLElement>("[data-status-label]");
  if (dot) {
    dot.dataset.status = status;
    dot.textContent = STATUS_LABEL[status];
  }
}

/** Move a card to a status in the UI: paint it, fix the counts, show/hide it. */
function placeStatus(wrap: HTMLElement, item: HTMLElement, from: ReadingStatus, to: ReadingStatus): void {
  paintStatus(wrap, to);
  bumpCount(from, -1);
  bumpCount(to, 1);
  const visible = item.isConnected;
  if (matchesFilter(to) && !visible) reattach(item);
  else if (!matchesFilter(to) && visible) detach(item);
}

// ---- Server calls ----------------------------------------------------------

async function patchStatus(id: string, status: ReadingStatus): Promise<boolean> {
  try {
    const res = await fetch(`/api/readings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deleteOnServer(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/readings/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

// ---- Card actions ----------------------------------------------------------

function shortTitle(wrap: HTMLElement): string {
  const title = wrap.dataset.title?.trim() || "Untitled";
  return title.length > 60 ? `${title.slice(0, 57).trimEnd()}…` : title;
}

/** Where an archived reading goes back to: guess from how far it was read. */
function unarchivedStatus(wrap: HTMLElement): ReadingStatus {
  const progress = Number(wrap.dataset.progress) || 0;
  if (progress >= 0.95) return "read";
  return progress > 0 ? "reading" : "unread";
}

/**
 * Mark a card as waiting on the server. aria-disabled (not `disabled`) so a
 * focused button keeps focus: disabling it would drop keyboard users to <body>.
 */
function setBusy(wrap: HTMLElement, on: boolean): void {
  wrap.setAttribute("aria-busy", String(on));
  wrap.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((b) => {
    if (on) b.setAttribute("aria-disabled", "true");
    else b.removeAttribute("aria-disabled");
  });
}

const isBusy = (wrap: HTMLElement): boolean => wrap.getAttribute("aria-busy") === "true";

/** The button that takes over when an action's own button hides (read ↔ unread …). */
const COUNTERPART: Record<Exclude<Action, "delete">, Action> = {
  archive: "unarchive",
  unarchive: "archive",
  "mark-read": "mark-unread",
  "mark-unread": "mark-read",
};

/**
 * After a status change on a card that stays in view, the clicked button may
 * now be hidden by CSS. Keep keyboard focus on the card instead of losing it.
 */
function keepFocus(wrap: HTMLElement, action: Exclude<Action, "delete">): void {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !wrap.contains(focused) || focused.getClientRects().length > 0) return;
  const next = wrap.querySelector<HTMLButtonElement>(`[data-action="${COUNTERPART[action]}"]`);
  if (next && next.getClientRects().length > 0) next.focus();
  else cardLink(wrap)?.focus();
}

const PAST_TENSE: Record<Exclude<Action, "delete">, string> = {
  archive: "Archived",
  unarchive: "Moved back to your shelf",
  "mark-read": "Marked as read",
  "mark-unread": "Marked as unread",
};

async function changeStatus(wrap: HTMLElement, item: HTMLElement, action: Exclude<Action, "delete">): Promise<void> {
  const id = wrap.dataset.readingId;
  const from = wrap.dataset.status;
  if (!id || !isStatus(from)) return;
  const to: ReadingStatus =
    action === "archive"
      ? "archived"
      : action === "unarchive"
        ? unarchivedStatus(wrap)
        : action === "mark-read"
          ? "read"
          : "unread";

  // Settle any pending delete first so its toast isn't silently replaced mid-request.
  if (active) closeToast(true);
  setBusy(wrap, true);
  const ok = await patchStatus(id, to);
  setBusy(wrap, false);
  if (!ok) {
    showToast({ message: `Couldn't update “${shortTitle(wrap)}”. Please try again.` });
    return;
  }

  placeStatus(wrap, item, from, to);
  if (item.isConnected) keepFocus(wrap, action);
  showToast({
    message: `${PAST_TENSE[action]} — “${shortTitle(wrap)}”`,
    undo: () => {
      void (async () => {
        setBusy(wrap, true);
        const reverted = await patchStatus(id, from);
        setBusy(wrap, false);
        if (!reverted) {
          showToast({ message: `Couldn't undo. “${shortTitle(wrap)}” is still ${STATUS_LABEL[to].toLowerCase()}.` });
          return;
        }
        placeStatus(wrap, item, to, from);
        cardLink(wrap)?.focus();
        announce(`Undone — “${shortTitle(wrap)}” is ${STATUS_LABEL[from].toLowerCase()} again.`);
      })();
    },
  });
}

function removeReading(wrap: HTMLElement, item: HTMLElement): void {
  const id = wrap.dataset.readingId;
  const status = wrap.dataset.status;
  if (!id || !isStatus(status)) return;

  // Hide now; the request waits for the toast so Undo can simply cancel it.
  bumpCount(status, -1);
  if (item.isConnected) detach(item);

  showToast({
    message: `Deleted “${shortTitle(wrap)}”`,
    undo: () => {
      bumpCount(status, 1);
      reattach(item);
      cardLink(wrap)?.focus();
      announce(`Restored “${shortTitle(wrap)}”.`);
    },
    commit: () =>
      deleteOnServer(id).then((ok) => {
        if (ok) return;
        bumpCount(status, 1);
        reattach(item);
        showToast({ message: `Couldn't delete “${shortTitle(wrap)}”. It's back on your shelf.` });
      }),
  });
}

const ACTIONS: readonly Action[] = ["archive", "unarchive", "mark-read", "mark-unread", "delete"];
const isAction = (value: string | undefined): value is Action => ACTIONS.some((a) => a === value);

feed?.addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>("[data-action]");
  if (!button) return;
  const wrap = button.closest<HTMLElement>(".card-wrap");
  const item = wrap?.closest<HTMLElement>("li");
  const action = button.dataset.action;
  if (!wrap || !item || !isAction(action)) return;
  e.preventDefault();
  if (isBusy(wrap)) return;
  if (action === "delete") removeReading(wrap, item);
  else void changeStatus(wrap, item, action);
});

// ---- Init ------------------------------------------------------------------

if (feed) {
  Array.from(feed.children).forEach((el, i) => ((el as HTMLElement).dataset.order = String(i)));
}

// Just added (or already there): bring it into view and let it glow once.
const added = document.querySelector<HTMLElement>(".card-wrap[data-added]");
if (added) {
  added.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
  cardLink(added)?.focus({ preventScroll: true });
  if (!reducedMotion) {
    added.classList.add("is-flashing");
    added.removeAttribute("data-added");
    // Drop the class once done, or moving the card (undo) would replay the flash.
    added.addEventListener("animationend", () => added.classList.remove("is-flashing"), { once: true });
  } else {
    window.setTimeout(() => added.removeAttribute("data-added"), 2500);
  }
}

// Focus lands on the card, so screen readers hear the card, not the notice.
{
  const notice = document.getElementById("add-status")?.textContent?.trim();
  if (notice && new URL(window.location.href).searchParams.has("added")) announce(notice);
}

// Narrow screens scroll the tab row sideways: keep the active tab in sight.
{
  const tabs = document.querySelector<HTMLElement>(".filter-tabs");
  const current = tabs?.querySelector<HTMLElement>('[aria-current="page"]');
  if (tabs && current && tabs.scrollWidth > tabs.clientWidth) {
    const overflow = current.getBoundingClientRect().right - tabs.getBoundingClientRect().right;
    if (overflow > 0) tabs.scrollLeft += overflow + 16;
  }
}

// Don't re-highlight (or re-announce) on reload: drop ?added / ?deduped from the URL.
{
  const url = new URL(window.location.href);
  if (url.searchParams.has("added") || url.searchParams.has("deduped")) {
    url.searchParams.delete("added");
    url.searchParams.delete("deduped");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }
}
