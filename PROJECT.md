# Readbook
Turns any link you save — a newsletter, a blog post, a Reddit thread, an X thread, or any other page — into one calm, book-like reading experience on a shelf that is only yours.

## TL;DR
- **System type:** a personal, single-reader "read-it-later" library — no accounts, no feed algorithm, no ads, no social graph. Just your shelf.
- **Entry / Trigger:** you paste a link. Anything: a newsletter issue, a blog article, a Reddit post, an X thread, or a plain web page.
- **Engine / decision:** the app pulls the *real* article out of the page — stripping menus, ads, popups and clutter — and reshapes every link, whatever its origin, into one identical reading object. It tries the fast, free local reader first and only falls back to the paid online reader when a page is too locked-down or script-heavy to read locally.
- **Main output:** a clean reading on your shelf — title, author, lead image, a short preview, an estimated reading time — that opens in a distraction-free reader and remembers where you stopped.
- **Main objects:** a Reading · a Source · the Shelf (your feed) · the Reader · Reading progress.

## Por qué existe (Contexto)

### Situación actual
Today the good stuff you mean to read lives scattered and half-lost. A newsletter sits unread in an inbox between receipts and promotions. A long blog post becomes the twentieth open browser tab you keep "for later" and eventually close. A Reddit thread or an X thread is buried inside an app built to keep you scrolling — pulling you past the thing you actually wanted to read with notifications, replies, suggested posts and ads. Each of these lives in its own place, in its own format, with its own noise. There is no single shelf where "things I want to read" simply wait for you, looking the same and reading the same, the way a book does.

### Necesidad del negocio
This is a personal project. The person who felt the pain is the builder himself: he reads across newsletters, blogs, Reddit and X, and he is tired of the reading being trapped inside apps designed to distract him and inside formats he does not own. He wants one consistent, calm, book-like format for everything he reads — a shelf he owns, not a timeline someone else controls. The promise is ownership: every link he saves becomes his, in one shape, free of the clutter and the algorithm.


### Objetivo
Give one owned, consistent home to everything worth reading. No matter where a link comes from, it should arrive on the shelf looking and reading the same — quiet, legible, book-like — and stay there until it is read. The reading itself should feel like a Kindle: warm type, comfortable spacing, your choice of light, sepia or dark, and the ability to put it down and pick it back up exactly where you left off.

### Impacto esperado
Less reading lost to scattered tabs, inboxes and noisy apps; more of it actually finished. The benefit is calm and ownership: one place, one format, no algorithm deciding what surfaces next. Success looks like the shelf becoming the default place this reader goes to read — and articles getting finished instead of forgotten.

## Qué hace
It takes any link you paste, pulls out the genuine article behind the page's clutter, and files it on your personal shelf as a clean, book-like reading you can open and finish in peace.

## Cómo funciona (flujo)
1. **You paste a link.** Anything — a newsletter, a blog, a Reddit post, an X thread, or a generic page.
2. **The app recognizes where it came from** and labels it (newsletter, blog, Reddit, X, or a generic page) so the shelf and reader can treat it appropriately.
3. **It extracts the real article.** It first tries the fast, free local reader that finds the main text and discards menus, sidebars, ads and popups. If the page is too locked-down or script-heavy to read locally (this is common for X), it falls back to the paid online reader that can see what the local one cannot.
4. **It cleans and reshapes the result** into one identical reading object: a title, an author when one can be found, the site name, a lead image, a short preview, the clean article body, and an estimated reading time. Anything unsafe or messy in the page is stripped before the reading is ever stored.
5. **It files the reading on your shelf** as "unread," in the same shape as every other reading, regardless of where it came from.
6. **You open it in the reader** — a quiet, full-page reading view. As you scroll, it remembers your place; when you come back, you resume exactly where you stopped. As you read, the reading moves through its life: unread, reading, read, or set aside (archived).

## Para quién es
- **The reader (a single person — the owner).** This is a single-user product by design. There are no accounts and no second reader. It is one person's shelf.
- **Anyone who reads long-form across many sources** — newsletters, blogs, Reddit, X — and wants one calm, owned place to keep and finish it, instead of scattered tabs and noisy native apps.

## Cómo se usa
There is nothing to launch and no inbox to manage. The reader does two things: **paste a link** to save something to the shelf, and **open a card** from the shelf to read it. The shelf is a quiet feed of cards — each showing a lead image, title, author, preview and estimated reading time. Tapping a card opens the reader; inside the reader the person can adjust text size and switch between light, sepia and dark, then simply read. Closing and reopening later resumes at the same spot.

## Reglas y configuración
| Rule | Value | Why | Watch out |
| --- | --- | --- | --- |
| Reading-time estimate pace | 220 words per minute | A widely used average adult reading speed; it makes the "X min read" on each card believable without measuring the person. | It is an estimate, not a promise — dense or technical pieces read slower; it is meant to set expectations, not to be exact. |
| Minimum reading time shown | at least 1 minute | Even a very short piece should never display "0 min read," which reads as broken or empty. | A one-line post and a three-paragraph post can both show "1 min"; the floor trades precision for a sensible label. |
| Local reader tried first, paid reader second | local first, online fallback only on failure | The local reader is free and fast and handles most pages; the paid online reader is reserved for pages it can't crack, so cost is only spent when truly needed. | If the paid online reader isn't enabled, locked-down pages (like X) will fail cleanly with a clear message rather than silently saving an empty reading. |
| Every saved reading is cleaned before it's stored | clutter and unsafe content stripped on the way in | A reading-it-later shelf is only calm if what lands on it is already clean; sanitizing once, up front, keeps the reader view safe and quiet every time it's opened. | Cleaning can occasionally drop an unusual embed or widget the original page had; the trade is a consistently safe, legible body. |
| A reading's life stages | unread → reading → read → archived | These four simple states are all a personal shelf needs to answer "what's waiting, what am I in, what's done, what did I set aside" — without an algorithm or folders. | "Archived" means set aside, not deleted; it leaves the shelf view but the reading is kept. |
| Source labels | newsletter · blog · Reddit · X · generic page | Knowing where a reading came from lets the shelf show it honestly; "generic page" is the catch-all so *any* link is accepted, never rejected for being unrecognized. | The label is about origin, not quality — a "generic page" reads exactly as cleanly as a recognized one. |
| Resume where you left off | reading position remembered, from start (0) to finished (1) | The whole point of a book-like reader is to put it down and come back; remembering the exact spot removes the friction of re-finding your place. | Position is per reading and lives on this one shelf; it does not sync to other devices today. |
| Reader measure (line width) | about 66 characters per line (~38rem) | Long-form reading is most comfortable and least tiring at roughly this line length; wider lines make the eye lose its place between lines. | Deliberately narrower than the full screen — the empty margins are a feature, not wasted space. |
| Reader line spacing | about 1.7× the text height | Generous spacing is what makes the reader feel like a book rather than a web page, and keeps long passages easy on the eye. | Tighter spacing would fit more on screen but undo the calm, Kindle-like feel that is the whole point. |
| Reader themes | light · sepia · dark | Reading happens in different light and at different times of day; sepia and dark in particular reduce strain for long or night-time reading. | Theme is a reading-comfort choice, not branding — it changes the page you read, nothing else. |

## Ejemplos
- **A newsletter issue → a clean reading.** You paste a newsletter article. The app recognizes it as a newsletter, the local reader lifts out the essay and drops the header, footer and "subscribe" boxes, and it lands on the shelf with its title, author, lead image and a "7 min read." You open it that evening in sepia and finish it; next morning the card shows it as read.
- **An X thread → the paid reader steps in.** You paste an X thread. The local reader can't see past the app's script wall and comes back empty. The app falls back to the paid online reader, which pulls the thread's text, and the thread lands on the shelf as one continuous reading — no replies, no "for you," no ads.
- **An unknown blog → still works.** You paste a personal blog the app has never seen. It doesn't recognize the source, so it labels it a "generic page" and reads it anyway with the local reader. The reading lands on the shelf looking exactly like every other one.
- **Edge — you stop halfway.** You're two-thirds through a long essay and close it. The card on the shelf still says "reading." Days later you reopen it and land exactly where you stopped, not back at the top.
- **Failure — a locked page with no fallback enabled.** You paste a page only the paid online reader could handle, but that reader isn't switched on. Instead of saving a blank or broken reading, the app fails cleanly and tells you it couldn't read this page — your shelf stays clean.

## A qué le pega
**What it moves:** the share of saved reading that actually gets read, and the calm of having one place to read instead of many noisy ones. It connects, on the way in, to whatever website a pasted link points at, and to the two readers that extract the article — the free local one and the paid online fallback. Everything it saves lives in one personal library on this machine. If the app disappeared, the reader goes back to scattered tabs, an unread inbox and reading trapped inside distracting apps. If the paid online fallback is unavailable, the app still works for everything the local reader can handle and simply declines the pages it can't — it never loses a reading to a silent failure.

## Modelo / objetos
- **Reading** — one saved article in its single, normalized shape: title, author, site name, lead image, preview, clean body, estimated reading time, where it came from, and its life stage. Everything on the shelf is a Reading, no matter its origin.
- **Source** — where a Reading came from (newsletter, blog, Reddit, X, or a generic page); the label that lets the shelf treat each reading honestly while still rendering them all the same.
- **The Shelf** — your personal feed of Readings as cards. No algorithm, no ranking — your library, in your order.
- **The Reader** — the quiet, full-page reading view: warm type, comfortable measure and spacing, and light/sepia/dark themes.
- **Reading progress** — how far through a Reading you are, so you can put it down and resume exactly where you left off.

## Owners & contacto
Created and maintained by Rodolfo Andino ([@Raandino](https://github.com/Raandino)). Questions and ideas are welcome as GitHub issues; security reports go through GitHub private advisories (see `SECURITY.md`).

## Estado
Early open-source release (v0.1). Single-reader and local-only today; designed with a later move to a cloud-hosted personal library in mind. Shipped: search and status filters across the shelf, highlights with notes, a notebook of everything you've marked, written notes, EPUB/Markdown import, JSON backup/restore, and a Settings page. On the roadmap as direction (not yet built): tags and collections, automatic ingestion of new newsletter/feed items, and offline reading.
