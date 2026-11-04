/**
 * Highlights + notes in the reader.
 *
 * - Select text in the article → a small floating toolbar offers four colors,
 *   "Note" and "Copy". Picking a color saves immediately and paints the marks.
 * - Click an existing highlight → the same toolbar in edit mode (recolor, edit
 *   note, copy, delete — with undo).
 * - A "Highlights & notes" panel lists this Reading's highlights in document
 *   order, plus a free-form note on the whole piece (autosaved).
 *
 * Anchoring is text-quote based (lib/anchor.ts): offsets are character indexes
 * into the article's `textContent`. Wrapping text in <mark> never changes that
 * text, so every highlight can be located against the same string.
 *
 * Bundled module (the CSP forbids inline scripts); server data arrives via
 * data-* attributes on #reader-root. Nothing user-supplied is ever assigned to
 * innerHTML — all rendering goes through textContent / DOM APIs.
 */
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from "@readbook/core";
import { describeRange, locateQuote, trimSpan, type TextQuote, type TextSpan } from "../lib/anchor";

const MAX_QUOTE_CHARS = 5_000;
const MAX_NOTE_CHARS = 5_000;

const root = document.getElementById("reader-root");
const article = document.getElementById("reader-article");
const toolbar = document.getElementById("hl-toolbar");
const notePop = document.getElementById("hl-note-pop");
const panel = document.getElementById("hl-panel");

if (root && article && toolbar && notePop && panel) {
  init(root, article, toolbar, notePop, panel);
}

type Mode = { kind: "create"; span: TextSpan; quote: TextQuote } | { kind: "edit"; id: string };

function init(
  root: HTMLElement,
  article: HTMLElement,
  toolbar: HTMLElement,
  notePop: HTMLElement,
  panel: HTMLElement,
): void {
  const readingId = root.dataset.readingId ?? "";
  const el = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

  // Toolbar parts.
  const swatches = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("[data-hl-color]"));
  const noteBtn = toolbar.querySelector<HTMLButtonElement>('[data-hl-action="note"]');
  const copyBtn = toolbar.querySelector<HTMLButtonElement>('[data-hl-action="copy"]');
  const deleteBtn = toolbar.querySelector<HTMLButtonElement>('[data-hl-action="delete"]');

  // Note popover parts.
  const noteQuote = el<HTMLElement>("hl-note-quote");
  const noteText = el<HTMLTextAreaElement>("hl-note-text");
  const noteSave = el<HTMLButtonElement>("hl-note-save");
  const noteCancel = el<HTMLButtonElement>("hl-note-cancel");

  // Panel parts.
  const panelToggle = el<HTMLButtonElement>("hl-panel-toggle");
  // A second toggle lives in the floating ControlRail so the panel is reachable
  // while scrolled deep into a piece.
  const railToggles = document.querySelectorAll<HTMLButtonElement>("[data-hl-panel-toggle]");
  const panelClose = el<HTMLButtonElement>("hl-panel-close");
  const scrim = el<HTMLElement>("hl-scrim");
  const countEl = el<HTMLElement>("hl-count");
  const list = el<HTMLOListElement>("hl-list");
  const emptyEl = el<HTMLElement>("hl-empty");
  const orphansEl = el<HTMLElement>("hl-orphans");
  const orphanList = el<HTMLUListElement>("hl-orphan-list");
  const readingNote = el<HTMLTextAreaElement>("reading-note");
  const readingNoteStatus = el<HTMLElement>("reading-note-status");
  const exportLink = el<HTMLAnchorElement>("hl-export");

  // Toast (status messages, undo).
  const toast = el<HTMLElement>("hl-toast");
  const toastText = el<HTMLElement>("hl-toast-text");
  const toastAction = el<HTMLButtonElement>("hl-toast-action");
  const live = el<HTMLElement>("hl-live");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia("(pointer: coarse)");
  const narrow = window.matchMedia("(max-width: 40rem)");

  // ---- State --------------------------------------------------------------

  const highlights = new Map<string, Highlight>();
  /** Where each placed highlight sits in the article text. */
  const placed = new Map<string, TextSpan>();
  let mode: Mode | null = null;
  /** The note popover's target highlight id, when open. */
  let noteFor: string | null = null;
  /** Focus to restore when the toolbar/popover closes. */
  let returnFocus: HTMLElement | null = null;
  let pointerDown = false;
  /** True while a pointer interaction on our own UI is in flight (keeps touch selections alive). */
  let usingUi = false;
  /** Whether the saved per-reading note has any text (it's part of the export). */
  let noteHasText = Boolean(readingNote?.value.trim());

  for (const h of parseHighlights(root.dataset.highlights)) highlights.set(h.id, h);

  // ---- API ----------------------------------------------------------------

  async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
      throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${res.status}).`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  // ---- Text ↔ DOM mapping -------------------------------------------------

  const articleText = (): string => article.textContent ?? "";

  /** Character offset (into article.textContent) of a DOM boundary point. */
  function offsetAt(node: Node, offset: number): number {
    const range = document.createRange();
    range.setStart(article, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  }

  /**
   * The current selection as a trimmed text span within the article. A drag
   * that starts or ends just outside it (in the title, past the last line) is
   * clamped to the article; a selection with neither end inside is ignored.
   */
  function selectionSpan(): TextSpan | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const startIn = article.contains(range.startContainer);
    const endIn = article.contains(range.endContainer);
    if (!startIn && !endIn) return null;
    const text = articleText();
    const start = startIn ? offsetAt(range.startContainer, range.startOffset) : 0;
    const end = endIn ? offsetAt(range.endContainer, range.endOffset) : text.length;
    return trimSpan(text, start, end);
  }

  /** A DOM Range covering [span.start, span.end) of the article text. */
  function rangeFor(span: TextSpan): Range | null {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let started = false;
    let pos = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const node = n as Text;
      const nodeEnd = pos + node.data.length;
      if (!started && span.start < nodeEnd) {
        range.setStart(node, span.start - pos);
        started = true;
      }
      if (started && span.end <= nodeEnd) {
        range.setEnd(node, span.end - pos);
        return range;
      }
      pos = nodeEnd;
    }
    return null;
  }

  // Whitespace-only text between block elements (e.g. "\n" inside a <ul>)
  // must not be wrapped: a <mark> there is invalid and renders as a stray blob.
  const BLOCK_CONTAINERS = new Set([
    "ARTICLE", "SECTION", "DIV", "UL", "OL", "LI", "DL", "TABLE", "THEAD", "TBODY", "TFOOT", "TR",
    "BLOCKQUOTE", "FIGURE", "PRE", "HEADER", "FOOTER", "ASIDE", "NAV", "MAIN",
  ]);

  const BLOCK_SELECTOR =
    "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, figcaption, td, th, dt, dd, div, section, article";

  /**
   * The text of [span.start, span.end) as a reader would copy it: identical to
   * the textContent slice, except a paragraph break is spelled out where the
   * span crosses from one block into the next (textContent often has no
   * whitespace there at all). Matching ignores whitespace, so this still
   * anchors against textContent.
   */
  function readableText(span: TextSpan): string {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let out = "";
    let lastBlock: Element | null = null;
    let pos = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const node = n as Text;
      const nodeStart = pos;
      pos += node.data.length;
      if (pos <= span.start) continue;
      if (nodeStart >= span.end) break;
      const piece = node.data.slice(Math.max(span.start, nodeStart) - nodeStart, Math.min(span.end, pos) - nodeStart);
      if (!piece) continue;
      const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
      if (out && block !== lastBlock && piece.trim()) {
        out = `${out.replace(/\s+$/, "")}\n\n`;
        out += piece.replace(/^\s+/, "");
      } else {
        out += piece;
      }
      if (piece.trim()) lastBlock = block;
    }
    return out.replace(/[ \t]*\n[ \t]*\n\s*/g, "\n\n").trim();
  }

  /** Describe a selection span for saving: textContent context + a readable quote. */
  function describe(span: TextSpan): TextQuote | null {
    const quote = describeRange(articleText(), span.start, span.end);
    return quote ? { ...quote, quote: readableText(span) || quote.quote } : null;
  }

  /** Wrap the text in [span.start, span.end) in <mark>s for highlight `h`. */
  function paint(h: Highlight, span: TextSpan): HTMLElement[] {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const slices: { node: Text; from: number; to: number }[] = [];
    let pos = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const node = n as Text;
      const nodeStart = pos;
      pos += node.data.length;
      if (pos <= span.start) continue;
      if (nodeStart >= span.end) break;
      const from = Math.max(span.start, nodeStart) - nodeStart;
      const to = Math.min(span.end, pos) - nodeStart;
      const parent = node.parentElement;
      if (!parent || parent.closest("svg, math")) continue;
      if (!node.data.slice(from, to).trim() && (parent === article || BLOCK_CONTAINERS.has(parent.tagName))) continue;
      slices.push({ node, from, to });
    }

    const marks = slices.map(({ node, from, to }) => {
      let target = node;
      if (to < target.data.length) target.splitText(to);
      if (from > 0) target = target.splitText(from);
      const mark = document.createElement("mark");
      mark.className = "rb-hl";
      mark.dataset.hlId = h.id;
      mark.dataset.color = h.color;
      target.parentNode?.insertBefore(mark, target);
      mark.appendChild(target);
      return mark;
    });
    decorate(h);
    return marks;
  }

  function marksFor(id: string): HTMLElement[] {
    return Array.from(article.querySelectorAll<HTMLElement>(`mark.rb-hl[data-hl-id="${CSS.escape(id)}"]`));
  }

  /** Sync color + the "has a note" dot on a highlight's marks. */
  function decorate(h: Highlight): void {
    const marks = marksFor(h.id);
    marks.forEach((mark, i) => {
      mark.dataset.color = h.color;
      if (h.note && i === marks.length - 1) mark.dataset.noteEnd = "";
      else delete mark.dataset.noteEnd;
    });
  }

  function unpaint(id: string): void {
    for (const mark of marksFor(id)) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
  }

  /** Locate and paint every highlight. Unlocatable ones become "couldn't place". */
  function paintAll(): void {
    const text = articleText();
    for (const h of highlights.values()) {
      const span = locateQuote(text, h);
      if (!span) continue;
      placed.set(h.id, span);
      paint(h, span);
    }
  }

  // ---- Floating toolbar ---------------------------------------------------

  /** Place a floating element near `rect` (viewport coords), kept on-screen. */
  function position(elm: HTMLElement, rects: { first: DOMRect; last: DOMRect }, preferBelow: boolean): void {
    elm.hidden = false;
    const gap = 10;
    const margin = 8;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const w = elm.offsetWidth;
    const h = elm.offsetHeight;
    const above = rects.first.top - h - gap;
    const fitsAbove = above >= margin;
    const fitsBelow = rects.last.bottom + gap + h <= vh - margin;
    // Honor the preferred side when it fits; otherwise take whichever does.
    const below = preferBelow ? fitsBelow || !fitsAbove : !fitsAbove;
    const anchor = below ? rects.last : rects.first;
    const top = below ? anchor.bottom + gap : above;
    const centre = anchor.left + anchor.width / 2;
    const left = Math.min(Math.max(margin, centre - w / 2), Math.max(margin, vw - w - margin));
    elm.style.top = `${Math.round(top + window.scrollY)}px`;
    elm.style.left = `${Math.round(left + window.scrollX)}px`;
  }

  function rectsOf(rangeOrMarks: Range | HTMLElement[]): { first: DOMRect; last: DOMRect } | null {
    const rects = Array.isArray(rangeOrMarks)
      ? rangeOrMarks.flatMap((m) => Array.from(m.getClientRects()))
      : Array.from(rangeOrMarks.getClientRects());
    const visible = rects.filter((r) => r.width > 0 || r.height > 0);
    const first = visible[0];
    const last = visible[visible.length - 1];
    return first && last ? { first, last } : null;
  }

  function setActive(id: string | null): void {
    for (const mark of article.querySelectorAll<HTMLElement>("mark.rb-hl.is-active")) mark.classList.remove("is-active");
    if (id) for (const mark of marksFor(id)) mark.classList.add("is-active");
  }

  function openToolbar(next: Mode, anchor: { first: DOMRect; last: DOMRect }, focus: boolean): void {
    mode = next;
    const editing = next.kind === "edit" ? highlights.get(next.id) : undefined;
    toolbar.dataset.mode = next.kind;
    toolbar.setAttribute("aria-label", editing ? "Edit highlight" : "Highlight selection");
    for (const sw of swatches) {
      sw.setAttribute("aria-pressed", String(editing?.color === sw.dataset.hlColor));
    }
    if (deleteBtn) deleteBtn.hidden = !editing;
    if (noteBtn) {
      const label = editing?.note ? "Edit note" : "Add note";
      noteBtn.setAttribute("aria-label", label);
      noteBtn.title = label;
    }
    if (copyBtn) copyBtn.dataset.copied = "false";
    setActive(editing ? editing.id : null);
    position(toolbar, anchor, coarsePointer.matches);
    if (focus) {
      if (!toolbar.contains(document.activeElement)) returnFocus = document.activeElement as HTMLElement | null;
      (swatches.find((s) => s.getAttribute("aria-pressed") === "true") ?? swatches[0])?.focus();
    }
  }

  function closeToolbar(restoreFocus = false): void {
    if (toolbar.hidden && !mode) return;
    const hadFocus = toolbar.contains(document.activeElement);
    toolbar.hidden = true;
    mode = null;
    setActive(null);
    if (restoreFocus || hadFocus) restore();
  }

  function restore(): void {
    const target = returnFocus;
    returnFocus = null;
    if (target && document.contains(target)) target.focus();
  }

  function openEdit(id: string, focus: boolean): void {
    const marks = marksFor(id);
    const rects = rectsOf(marks);
    if (!rects) return;
    closeNote(false);
    openToolbar({ kind: "edit", id }, rects, focus);
  }

  // ---- Selection tracking -------------------------------------------------

  let selTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSelectionCheck(delay: number): void {
    clearTimeout(selTimer);
    selTimer = setTimeout(checkSelection, delay);
  }

  function checkSelection(): void {
    // Focus inside the toolbar means it is being used: leave it alone even if
    // the browser collapses the selection meanwhile.
    if (usingUi || pointerDown || !notePop.hidden || toolbar.contains(document.activeElement)) return;
    const span = selectionSpan();
    if (!span) {
      if (mode?.kind === "create") closeToolbar();
      return;
    }
    const quote = describe(span);
    // Anchor to the part that will actually be highlighted (the selection may
    // have been clamped to the article).
    const range = rangeFor(span);
    const rects = range ? rectsOf(range) : null;
    if (!quote || !rects) return;
    openToolbar({ kind: "create", span, quote }, rects, false);
  }

  document.addEventListener("selectionchange", () => scheduleSelectionCheck(220));

  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Node;
    if (toolbar.contains(target) || notePop.contains(target)) {
      usingUi = true;
      return;
    }
    pointerDown = true;
    // Clicking elsewhere dismisses an edit toolbar (a new selection replaces a create one).
    if (mode?.kind === "edit") closeToolbar();
  });

  document.addEventListener("pointerup", () => {
    pointerDown = false;
    if (usingUi) {
      // Let the click land before selection checks resume.
      setTimeout(() => (usingUi = false), 400);
      return;
    }
    scheduleSelectionCheck(10);
  });
  document.addEventListener("pointercancel", () => (pointerDown = false));

  // Keep a selection (and avoid focus jumps) when clicking toolbar buttons with a mouse.
  toolbar.addEventListener("mousedown", (event) => event.preventDefault());

  // Clicking a highlight opens it for editing (links inside still navigate).
  article.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target.closest("a")) return;
    const mark = target.closest<HTMLElement>("mark.rb-hl");
    const id = mark?.dataset.hlId;
    if (!id || !window.getSelection()?.isCollapsed) return;
    openEdit(id, false);
  });

  // Hovering one piece of a multi-paragraph highlight lights up all of it.
  article.addEventListener("pointerover", (event) => {
    const id = (event.target as Element).closest<HTMLElement>("mark.rb-hl")?.dataset.hlId;
    for (const mark of article.querySelectorAll<HTMLElement>("mark.rb-hl.is-hover")) {
      if (mark.dataset.hlId !== id) mark.classList.remove("is-hover");
    }
    if (id) for (const mark of marksFor(id)) mark.classList.add("is-hover");
  });
  article.addEventListener("pointerleave", () => {
    for (const mark of article.querySelectorAll<HTMLElement>("mark.rb-hl.is-hover")) mark.classList.remove("is-hover");
  });

  // Layout changes (rotation, font size) invalidate the toolbar position.
  window.addEventListener("resize", () => {
    if (mode?.kind === "edit") closeToolbar();
    else if (mode?.kind === "create") scheduleSelectionCheck(150);
  });

  // ---- Actions ------------------------------------------------------------

  async function create(color: HighlightColor, then?: "note"): Promise<void> {
    if (mode?.kind !== "create") return;
    const { span, quote } = mode;
    if (quote.quote.length > MAX_QUOTE_CHARS) {
      say("That passage is too long to highlight (5,000 characters at most).");
      return;
    }
    closeToolbar();
    window.getSelection()?.removeAllRanges();
    try {
      const h = await api<Highlight>("/api/highlights", "POST", { readingId, ...quote, color });
      add(h, span);
      if (then === "note") openNote(h.id);
      else say("Highlighted.");
    } catch (err) {
      say(errorText(err, "Couldn't save that highlight."));
    }
  }

  function add(h: Highlight, span: TextSpan): void {
    highlights.set(h.id, h);
    placed.set(h.id, span);
    paint(h, span);
    renderPanel();
  }

  async function recolor(id: string, color: HighlightColor): Promise<void> {
    const h = highlights.get(id);
    if (!h || h.color === color) return;
    const previous = h.color;
    // Optimistic: color changes are cheap to revert.
    h.color = color;
    decorate(h);
    for (const sw of swatches) sw.setAttribute("aria-pressed", String(sw.dataset.hlColor === color));
    renderPanel();
    try {
      Object.assign(h, await api<Highlight>(`/api/highlights/${encodeURIComponent(id)}`, "PATCH", { color }));
    } catch (err) {
      h.color = previous;
      decorate(h);
      renderPanel();
      say(errorText(err, "Couldn't change the color."));
    }
  }

  async function remove(id: string): Promise<void> {
    const h = highlights.get(id);
    if (!h) return;
    closeToolbar(true);
    try {
      await api<void>(`/api/highlights/${encodeURIComponent(id)}`, "DELETE");
    } catch (err) {
      say(errorText(err, "Couldn't delete that highlight."));
      return;
    }
    const span = placed.get(id);
    unpaint(id);
    highlights.delete(id);
    placed.delete(id);
    renderPanel();
    say("Highlight removed.", "Undo", async () => {
      try {
        const restored = await api<Highlight>("/api/highlights", "POST", {
          readingId,
          quote: h.quote,
          prefix: h.prefix,
          suffix: h.suffix,
          color: h.color,
          note: h.note,
        });
        const where = span ?? locateQuote(articleText(), restored);
        if (where) add(restored, where);
        else {
          highlights.set(restored.id, restored);
          renderPanel();
        }
        say("Highlight restored.");
      } catch (err) {
        say(errorText(err, "Couldn't restore that highlight."));
      }
    });
  }

  async function copy(text: string): Promise<void> {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Older browsers / denied permission: fall back to the selection, if any.
      ok = document.execCommand("copy");
    }
    if (copyBtn && ok) {
      copyBtn.dataset.copied = "true";
      setTimeout(() => copyBtn && (copyBtn.dataset.copied = "false"), 1400);
    }
    say(ok ? "Copied to clipboard." : "Couldn't copy — try your browser's copy instead.");
  }

  for (const sw of swatches) {
    sw.addEventListener("click", () => {
      const color = sw.dataset.hlColor as HighlightColor;
      if (!HIGHLIGHT_COLORS.includes(color)) return;
      if (mode?.kind === "create") void create(color);
      else if (mode?.kind === "edit") void recolor(mode.id, color);
    });
  }

  noteBtn?.addEventListener("click", () => {
    if (mode?.kind === "create") void create("yellow", "note");
    else if (mode?.kind === "edit") openNote(mode.id);
  });

  copyBtn?.addEventListener("click", () => {
    if (mode?.kind === "create") void copy(mode.quote.quote);
    else if (mode?.kind === "edit") {
      const h = highlights.get(mode.id);
      if (h) void copy(h.quote);
    }
  });

  deleteBtn?.addEventListener("click", () => {
    if (mode?.kind === "edit") void remove(mode.id);
  });

  // Toolbar keyboard: arrows move between buttons (ARIA toolbar pattern).
  toolbar.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button:not([hidden])"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = at;
    if (event.key === "ArrowRight") next = (at + 1) % buttons.length;
    else if (event.key === "ArrowLeft") next = (at - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else next = buttons.length - 1;
    buttons[next]?.focus();
    event.preventDefault();
  });

  // ---- Note popover -------------------------------------------------------

  function openNote(id: string): void {
    const h = highlights.get(id);
    const marks = marksFor(id);
    const rects = rectsOf(marks);
    if (!h || !noteText || !rects) return;
    if (!returnFocus) returnFocus = (document.activeElement as HTMLElement | null) ?? null;
    toolbar.hidden = true;
    mode = null;
    noteFor = id;
    setActive(id);
    if (noteQuote) noteQuote.textContent = squash(h.quote);
    noteText.value = h.note ?? "";
    position(notePop, rects, true);
    noteText.focus({ preventScroll: true });
    noteText.setSelectionRange(noteText.value.length, noteText.value.length);
    if (!isOnScreen(notePop)) notePop.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }

  function closeNote(restoreFocus = true): void {
    if (notePop.hidden) return;
    notePop.hidden = true;
    noteFor = null;
    setActive(null);
    if (restoreFocus) restore();
  }

  /** Save the popover's note; the popover stays open (text intact) if that fails. */
  async function saveNote(restoreFocus = true): Promise<void> {
    const id = noteFor;
    const h = id ? highlights.get(id) : undefined;
    if (!id || !h || !noteText) return;
    const note = noteText.value.trim().slice(0, MAX_NOTE_CHARS);
    if (noteSave) noteSave.disabled = true;
    try {
      const updated = await api<Highlight>(`/api/highlights/${encodeURIComponent(id)}`, "PATCH", { note: note || null });
      Object.assign(h, updated);
      decorate(h);
      renderPanel();
      if (noteFor === id) closeNote(restoreFocus);
      say(note ? "Note saved." : "Note removed.");
    } catch (err) {
      say(errorText(err, "Couldn't save the note."));
    } finally {
      if (noteSave) noteSave.disabled = false;
    }
  }

  noteSave?.addEventListener("click", () => void saveNote());
  noteCancel?.addEventListener("click", () => closeNote());
  noteText?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveNote();
    }
  });
  // Clicking outside the popover keeps what was typed (saves it) — only Esc /
  // Cancel throw an edit away. Unchanged notes simply close.
  document.addEventListener("pointerdown", (event) => {
    if (notePop.hidden || notePop.contains(event.target as Node)) return;
    const h = noteFor ? highlights.get(noteFor) : undefined;
    const typed = noteText?.value.trim() ?? "";
    if (h && typed !== (h.note ?? "")) void saveNote(false);
    else closeNote(false);
  });

  // ---- Global keys --------------------------------------------------------

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!notePop.hidden) closeNote();
      else if (!toolbar.hidden) {
        if (mode?.kind === "create") window.getSelection()?.removeAllRanges();
        closeToolbar(true);
      } else if (isPanelOpen()) setPanel(false);
      else return;
      event.preventDefault();
      return;
    }
    // Tab while the selection toolbar is showing moves into it, so keyboard
    // selections (Shift+arrows, caret browsing) can reach every action.
    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      mode?.kind === "create" &&
      !toolbar.hidden &&
      !toolbar.contains(document.activeElement) &&
      !isTyping(event.target)
    ) {
      event.preventDefault();
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      swatches[0]?.focus();
      return;
    }
    // "h" with a selection = highlight in yellow (never while typing).
    if (
      (event.key === "h" || event.key === "H") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !isTyping(event.target)
    ) {
      const span = selectionSpan();
      if (!span) return;
      const quote = describe(span);
      if (!quote) return;
      event.preventDefault();
      mode = { kind: "create", span, quote };
      void create("yellow");
    }
  });

  // ---- Panel --------------------------------------------------------------

  const isPanelOpen = (): boolean => panel.dataset.open === "true";

  function setPanel(open: boolean, focus = true): void {
    panel.dataset.open = String(open);
    panel.inert = !open;
    panelToggle?.setAttribute("aria-expanded", String(open));
    for (const t of railToggles) t.setAttribute("aria-expanded", String(open));
    if (scrim) scrim.hidden = !open;
    document.documentElement.classList.toggle("hl-panel-open", open);
    if (!focus) return;
    if (open) panelClose?.focus({ preventScroll: true });
    else if (panel.contains(document.activeElement) || document.activeElement === document.body) {
      panelToggle?.focus({ preventScroll: true });
    }
  }

  panelToggle?.addEventListener("click", () => setPanel(!isPanelOpen()));
  for (const t of railToggles) t.addEventListener("click", () => setPanel(!isPanelOpen()));
  panelClose?.addEventListener("click", () => setPanel(false));
  scrim?.addEventListener("click", () => setPanel(false));

  function renderPanel(): void {
    const ordered = [...highlights.values()]
      .filter((h) => placed.has(h.id))
      .sort((a, b) => (placed.get(a.id)?.start ?? 0) - (placed.get(b.id)?.start ?? 0));
    const orphans = [...highlights.values()].filter((h) => !placed.has(h.id));

    if (countEl) {
      countEl.textContent = String(highlights.size);
      countEl.hidden = highlights.size === 0;
    }
    if (emptyEl) emptyEl.hidden = highlights.size > 0;
    // The per-reading export covers highlights and the reading note.
    if (exportLink) exportLink.hidden = highlights.size === 0 && !noteHasText;

    list?.replaceChildren(...ordered.map((h) => panelItem(h, false)));
    if (list) list.hidden = ordered.length === 0;
    orphanList?.replaceChildren(...orphans.map((h) => panelItem(h, true)));
    if (orphansEl) orphansEl.hidden = orphans.length === 0;
  }

  function panelItem(h: Highlight, orphan: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "hl-item";
    li.dataset.color = h.color;

    if (orphan) {
      const quote = document.createElement("p");
      quote.className = "hl-item-quote";
      quote.textContent = squash(h.quote);
      li.append(quote);
    } else {
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "hl-item-quote";
      jump.textContent = squash(h.quote);
      jump.setAttribute("aria-label", `Go to highlight: ${truncate(squash(h.quote), 80)}`);
      jump.addEventListener("click", () => jumpTo(h.id, true));
      li.append(jump);
    }

    if (h.note) {
      const note = document.createElement("p");
      note.className = "hl-item-note";
      note.textContent = h.note;
      li.append(note);
    }

    if (orphan) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "hl-item-action";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove highlight: ${truncate(squash(h.quote), 80)}`);
      remove.addEventListener("click", () => void removeOrphan(h.id));
      li.append(remove);
    }
    return li;
  }

  async function removeOrphan(id: string): Promise<void> {
    try {
      await api<void>(`/api/highlights/${encodeURIComponent(id)}`, "DELETE");
      highlights.delete(id);
      renderPanel();
      say("Highlight removed.");
    } catch (err) {
      say(errorText(err, "Couldn't delete that highlight."));
    }
  }

  /** Scroll a highlight into view and flash it; optionally open it for editing. */
  function jumpTo(id: string, edit: boolean): void {
    const marks = marksFor(id);
    const first = marks[0];
    if (!first) return;
    if (narrow.matches && isPanelOpen()) setPanel(false, false);
    first.scrollIntoView({ block: "center", behavior: scrollBehavior() });
    for (const mark of marks) {
      mark.classList.remove("rb-hl-flash");
      // Restart the animation if it's already running.
      void mark.offsetWidth;
      mark.classList.add("rb-hl-flash");
    }
    setTimeout(() => marks.forEach((m) => m.classList.remove("rb-hl-flash")), 1600);
    if (edit) {
      // On phones the sheet closes, so focus returns to its toggle afterwards.
      const active = document.activeElement as HTMLElement | null;
      returnFocus = narrow.matches || !active || active === document.body ? panelToggle : active;
      setTimeout(() => openEdit(id, true), reducedMotion.matches ? 0 : 420);
    }
  }

  // ---- Reading note (autosave) --------------------------------------------

  if (readingNote) {
    const endpoint = `/api/readings/${encodeURIComponent(readingId)}`;
    let saved = readingNote.value;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let statusTimer: ReturnType<typeof setTimeout> | undefined;

    const status = (text: string, state: "saving" | "saved" | "error" | "idle"): void => {
      if (!readingNoteStatus) return;
      clearTimeout(statusTimer);
      readingNoteStatus.textContent = text;
      readingNoteStatus.dataset.state = state;
      if (state === "saved") statusTimer = setTimeout(() => status("", "idle"), 2400);
    };

    // One save in flight at a time, so an older PATCH can never land after a
    // newer one; edits made meanwhile are picked up by a follow-up save.
    let inFlight: Promise<void> | null = null;

    const flush = async (keepalive = false): Promise<void> => {
      clearTimeout(timer);
      if (inFlight && !keepalive) {
        await inFlight;
        return flush();
      }
      const value = readingNote.value;
      if (value === saved) return;
      status("Saving…", "saving");
      const request = (async () => {
        try {
          const res = await fetch(endpoint, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note: value.trim() ? value : null }),
            keepalive,
          });
          if (!res.ok) throw new Error(String(res.status));
          saved = value;
          noteHasText = Boolean(value.trim());
          renderPanel();
          status("Saved", "saved");
        } catch {
          status("Couldn't save — your text is still here.", "error");
        }
      })();
      inFlight = request;
      await request;
      if (inFlight === request) inFlight = null;
    };

    readingNote.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), 800);
    });
    readingNote.addEventListener("blur", () => void flush());
    window.addEventListener("pagehide", () => void flush(true));
  }

  // ---- Toast --------------------------------------------------------------

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let toastHandler: (() => void) | null = null;

  function say(message: string, actionLabel?: string, action?: () => void): void {
    if (live) live.textContent = actionLabel ? `${message} ${actionLabel} is available.` : message;
    if (!toast || !toastText) return;
    clearTimeout(toastTimer);
    toastText.textContent = message;
    toastHandler = action ?? null;
    if (toastAction) {
      toastAction.hidden = !action;
      toastAction.textContent = actionLabel ?? "";
    }
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.hidden = true;
      toastHandler = null;
    }, action ? 6000 : 2600);
  }

  toastAction?.addEventListener("click", () => {
    const handler = toastHandler;
    toastHandler = null;
    if (toast) toast.hidden = true;
    handler?.();
  });

  // ---- Boot ---------------------------------------------------------------

  paintAll();
  renderPanel();

  // Deep link from the notebook: /read/:id#hl-<highlightId>.
  const hash = safeDecode(location.hash.slice(1));
  if (hash.startsWith("hl-")) {
    const id = hash.slice(3);
    if (placed.has(id)) requestAnimationFrame(() => jumpTo(id, false));
    else if (highlights.has(id)) setPanel(true);
  }

  // ---- Helpers ------------------------------------------------------------

  function scrollBehavior(): ScrollBehavior {
    return reducedMotion.matches ? "auto" : "smooth";
  }
}

function parseHighlights(raw: string | undefined): Highlight[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? (data as Highlight[]) : [];
  } catch {
    return [];
  }
}

/** decodeURIComponent that tolerates malformed escapes in a hand-edited URL. */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? `${fallback} ${err.message}` : fallback;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

function isOnScreen(elm: HTMLElement): boolean {
  const r = elm.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
}
