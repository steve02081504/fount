---
description: Installer runner (main.ps1 / main.sh) — first-install EULA gate, wait page, CI skip flag
globs: src/runner/main.ps1,src/runner/main.sh
alwaysApply: false
---

# Installer runner

`src/runner/main.ps1` / `main.sh` (copied to GitHub Pages as `install.ps1` / `install.sh`). Polyglot stubs under `polyglot/` just exec these.

## First install (no `fount` on PATH)

1. Start `http://localhost:8930/` (alive probe + EULA signal).
2. Open `https://steve02081504.github.io/fount/wait/install/?from=runner` (`from=runner` is what switches the page from homepage to wait-for-install; do not rely on probing 8930).
3. Do **not** clone yet. Prompt in English: accept the EULA, with https://steve02081504.github.io/fount/EULA/ (OSC 8 when stdout is a VT tty). `[Y/N]`.
4. Browser agree → `GET /eula` writes the accept file → CLI prints `Y` and continues. CLI `Y` writes the same file (page polling `eula: accepted` closes the dialog). `N` uninstalls packages/apps pulled in only to open a browser, then exits.
5. `--accept-EULA` / `-acceptEULA` / `accept-EULA` (any dash count, case-insensitive) or `FOUNT_ACCEPT_EULA=1` skips the prompt, browser, and 8930 server (CI / `fount init`). Strip the flag before `run.bat` / `run.sh`.

`path/src/cmd/open.*` also opens `wait/install/?from=runner` when `data/config.json` is missing so the wait UI still appears after clone.

Non-interactive without the flag: print the EULA URL and exit 1 (do not hang).
