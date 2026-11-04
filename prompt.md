# Install Readbook — instructions for an AI agent

> **If you are a person:** you don't need to read this. Copy this sentence into your AI
> assistant (Claude Code, Codex, Cursor, Windsurf, or any agent that can run commands on
> your computer):
>
> ```text
> Install Readbook for me by following https://raw.githubusercontent.com/Raandino/readbook/main/prompt.md
> ```

---

**If you are an AI agent:** a person asked you to install **Readbook** on their computer and
get it running. Follow this file from top to bottom. Assume they are **not technical**: they
may never have used a terminal, and they don't know what Node, pnpm or git are.

Readbook is a free, open-source, local-first "read-it-later" app (MIT license):
<https://github.com/Raandino/readbook>. You paste a link and read it in a calm, book-like
reader with highlights and notes. It runs on their own computer at `http://localhost:4321`,
and their library is a single file on their disk. It has no accounts and no cloud.

## Your rules

1. **Talk like a helpful friend, not a manual.** Use short, plain sentences and no jargon. If you
   must use a technical word, explain it in a few words ("Node — the engine Readbook runs on").
2. **Tell them what's next before each step**, in one sentence, and say when something may
   take a few minutes.
3. **Ask before you install anything system-wide** (Node, git, build tools, Homebrew) and
   before anything that needs an administrator password. Say what it is and why it's needed.
   Never type or store their password yourself; let them enter it when the system asks.
4. **Never ask them to paste an API key or password into the chat.** If they want to add a
   Firecrawl key, send them to Readbook's **Settings** page in the browser (step 7).
5. **Keep it on their machine.** Don't change `HOST`, don't set `READBOOK_ALLOWED_HOSTS`,
   don't open firewall ports, and don't expose Readbook to the network. It has no login, so
   anyone who can reach it can read the whole library.
6. **Don't modify Readbook's code** to work around a problem. Use the troubleshooting section,
   and if that doesn't help, explain the problem plainly and offer to draft a GitHub issue.
7. **Check each step worked** before you move on. Commands below include a check.
8. **Don't delete anything** outside the Readbook folder. If a `Readbook` folder already exists,
   ask before replacing it; usually you should update it instead (see *Updating*).

## Step 0 — Find out where you are

Find out the operating system (macOS, Windows, or Linux) and whether you can run commands in
a terminal. If you can't run commands yourself, switch to **guide mode**: give the person one
command at a time to copy and paste, tell them exactly where to paste it, and ask them to
send back what it printed.

- **macOS:** the app is **Terminal** (press ⌘ Space, type "Terminal", press Enter).
- **Windows:** use **PowerShell** (press the Windows key, type "PowerShell", press Enter).
- **Linux:** any terminal.

Tell them, roughly: *"I'm going to set up Readbook on your computer. It takes about 5–10
minutes, and I'll explain each step."*

## Step 1 — Node.js (version 22.12 or newer)

Check what's installed:

```sh
node --version
```

If it prints `v22.12.0` or higher (`v22.x` where x ≥ 12, or `v23`/`v24` and up), skip to step 2.

Otherwise (not found, or too old), ask permission, then install the **LTS** version of Node:

- **macOS:** if Homebrew is present (`brew --version` works), run `brew install node`.
  Otherwise, have them download the macOS installer from <https://nodejs.org> (the "LTS"
  button) and double-click it.
- **Windows:** `winget install OpenJS.NodeJS.LTS` (or the installer from
  <https://nodejs.org>). **Close and reopen PowerShell** afterwards, or the `node` command won't
  be found yet.
- **Linux:** use the distro's NodeSource or official package
  (<https://nodejs.org/en/download>). Distro default packages are often too old.

Check again with `node --version`.

## Step 2 — pnpm (the tool that installs Readbook's parts)

```sh
pnpm --version
```

If that prints a version number, continue. Otherwise:

```sh
corepack enable
```

Corepack comes with Node 22 and 24. If `corepack` isn't found (newer Node versions dropped it),
use this instead:

```sh
npm install --global pnpm@10
```

On macOS/Linux, if either command fails with a permission error, **don't use `sudo` on your
own**. Explain, and use `npm install --global pnpm@10 --prefix ~/.local`, then make sure
`~/.local/bin` is on the PATH. Check again with `pnpm --version`.

## Step 3 — Get Readbook

Install it in their home folder, in a folder called `Readbook`, unless they ask for a different
place.

If `git --version` works:

```sh
cd ~
git clone https://github.com/Raandino/readbook.git Readbook
cd Readbook
```

If git isn't installed, don't install it just for this. Download the ZIP instead:

- macOS/Linux: `cd ~ && curl -L -o readbook.zip https://github.com/Raandino/readbook/archive/refs/heads/main.zip && unzip -q readbook.zip && mv readbook-main Readbook && rm readbook.zip && cd Readbook`
- Windows (PowerShell): `cd ~; Invoke-WebRequest https://github.com/Raandino/readbook/archive/refs/heads/main.zip -OutFile readbook.zip; Expand-Archive readbook.zip .; Rename-Item readbook-main Readbook; Remove-Item readbook.zip; cd Readbook`

Check: the folder contains `package.json` and `README.md`.

## Step 4 — Set it up

From inside the `Readbook` folder:

```sh
pnpm run setup
```

This checks the tools, installs Readbook's parts (this can take a few minutes the first time),
creates its settings file and data folder, and checks the database engine. It's safe to run
again. Success ends with **"Ready. Next steps"**.

> Use `pnpm run setup`, with `run`. Bare `pnpm setup` is a different, built-in pnpm command.

If it fails, see **Troubleshooting** below, fix the cause, and run it again.

## Step 5 — Start Readbook

```sh
pnpm start
```

The first time, it builds the app for about 30–60 seconds, then prints a line like
`Server listening on http://localhost:4321`. **This command keeps running. That's normal:
Readbook is on while it runs.** If you can, run it in the background or in a separate
terminal so you can keep helping. Otherwise, tell the person to leave that window open.

Check it's alive (from another terminal, or wait until the "listening" line appears):

```sh
curl -s http://localhost:4321/api/health
```

It should print `{"ok":true,...}`. On Windows PowerShell, use
`Invoke-RestMethod http://localhost:4321/api/health`.

If port 4321 is already taken, start it on another port and use that port from then on:
`PORT=4322 pnpm start` (macOS/Linux) or `$env:PORT=4322; pnpm start` (Windows PowerShell).

## Step 6 — Open it

Open <http://localhost:4321> in their browser:

- macOS: `open http://localhost:4321`
- Windows: `start http://localhost:4321`
- Linux: `xdg-open http://localhost:4321`

Then give them a short tour, in your own words:

- **Add something:** paste any article link in the box at the top and press **Add**. They
  can also **write a note** or **upload an EPUB/Markdown file** with the tabs above the box.
- **Read:** click a card. The page remembers where they stopped.
- **Change the look:** use the round button at the side to switch between light, sepia and
  dark. In the reader, **A− / A+** change the text size.
- **Highlight:** select text while reading and pick a color (or press **H**). Click a
  highlight to add a note. **Notebook** (top of the page) collects every highlight.
- **Their data** stays on this computer, in `Readbook/data/readbook.db`. **Settings →
  Download backup** saves a copy.

## Step 7 — Optional: Firecrawl (only if they want it)

Most links work without anything extra. Some sites only show their text after JavaScript
runs, and Readbook can't read those on its own. For those, Readbook can use **Firecrawl**, a
paid online service with a free tier: <https://www.firecrawl.dev>.

Offer it once, without pushing. If they want it, they create an account on firecrawl.dev,
copy their API key, then open **Settings** in Readbook (top right) and paste it into
**Firecrawl API key → Save key**. **Don't take the key in chat.**

## Step 8 — Make it easy to open next time

Readbook only runs while `pnpm start` is running. When they restart their computer, it needs
starting again. Explain that simply, then **offer** to create a double-click launcher (ask
first, and put it on the Desktop only if they agree):

- **macOS:** `~/Desktop/Readbook.command` containing
  ```sh
  #!/bin/zsh -l
  # Load the same setup as a normal Terminal (nvm, Homebrew) so `pnpm` is found.
  [ -f ~/.zshrc ] && source ~/.zshrc >/dev/null 2>&1
  cd ~/Readbook || exit 1
  # Open the browser as soon as Readbook answers.
  (until curl -s http://localhost:4321/api/health >/dev/null; do sleep 1; done; open http://localhost:4321) &
  pnpm start
  ```
  then `chmod +x ~/Desktop/Readbook.command`. Double-clicking it opens a Terminal window
  (keep it open while reading), and the browser opens when Readbook is ready. If macOS blocks
  it the first time, right-click it → **Open**.
- **Windows:** `Desktop\Readbook.bat` containing
  ```bat
  @echo off
  cd /d "%USERPROFILE%\Readbook"
  start "" powershell -NoProfile -WindowStyle Hidden -Command "while (-not (Test-NetConnection localhost -Port 4321 -InformationLevel Quiet -WarningAction SilentlyContinue)) { Start-Sleep 1 }; Start-Process http://localhost:4321"
  call pnpm start
  ```
- **Linux:** the macOS script with `#!/bin/bash -l`, `~/.bashrc` and `xdg-open`.

Adjust the folder path if Readbook is installed somewhere else, and the port if you changed it.

Tell them: **to stop Readbook, close that window** (or press Ctrl+C in it).

## Step 9 — Finish

Summarize in two or three friendly sentences:
- where Readbook is (`http://localhost:4321`)
- how to start it again (the launcher, or `cd ~/Readbook && pnpm start`)
- that their library and highlights stay on their computer

## Updating later

If they ask to update Readbook: stop it, then inside the `Readbook` folder run `git pull` (or
re-download the ZIP *into a new folder* and move the old `data/` folder across), then
`pnpm run setup`, then `pnpm start`. Their library in `data/` is kept. Readbook upgrades its
database automatically. Suggest **Settings → Download backup** before updating.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `node: command not found` right after installing Node | Close and reopen the terminal (Windows especially), then try again. |
| `Node … is too old` | Install the current LTS (step 1). If they use nvm: `nvm install --lts && nvm use --lts`. |
| `pnpm: command not found` | Step 2. After `npm install --global pnpm@10`, reopen the terminal. |
| Setup fails around **better-sqlite3** / `node-gyp` / "prebuild" | That's the database engine. It usually downloads ready-made, but some systems must build it. **macOS:** `xcode-select --install` (ask first; it opens an installer), then rerun `pnpm run setup`. **Debian/Ubuntu:** `sudo apt install -y build-essential python3` (ask first). **Windows:** install "Visual Studio Build Tools" with the "Desktop development with C++" workload (ask first), or try the current Node LTS. Then rerun setup. |
| `EADDRINUSE` / port 4321 in use | Another program (maybe an older Readbook) uses it. Use `PORT=4322 pnpm start`, and that port in the browser and the launcher. |
| Browser says "Readbook only answers on localhost" | They opened it by IP or another name. Use exactly `http://localhost:4321`. |
| A specific link says Readbook **couldn't read it** | Normal for some sites (logins, heavy JavaScript, Reddit often refuses). Try another link, or add a Firecrawl key (step 7). Readbook never gets around logins or paywalls. |
| Anything else | `pnpm run doctor` prints a read-only health report. Explain the result plainly. If it's a Readbook bug, offer to draft an issue for <https://github.com/Raandino/readbook/issues>. Never include their personal links, files or keys in it. |

## Uninstalling

Only if they ask. Stop Readbook, then delete the `Readbook` folder and the launcher.
**Warn first:** this deletes their library and highlights too, unless they download a backup
from Settings beforehand. Node and pnpm can stay installed; they're harmless.
