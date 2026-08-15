---
description: Installer runner (main.ps1 / main.sh) — first-install EULA gate, wait page, CI skip env
globs: src/runner/main.ps1,src/runner/main.sh
alwaysApply: false
---

# Installer runner

`src/runner/main.ps1` / `main.sh` (copied to GitHub Pages as `install.ps1` / `install.sh`). Polyglot stubs under `polyglot/` just exec these.

## First install (no `fount` on PATH)

Clone and the EULA prompt run **in parallel**. `:8930` stays up until the runner process exits (so the wait page does not treat a dropped probe as installer failure). Do not strip `open` from forwarded args.

1. If `FOUNT_ACCEPT_EULA` is unset: fail fast when stdin is not a console; otherwise start `http://localhost:8930/` (alive probe + `GET /eula`), open `https://steve02081504.github.io/fount/wait/install/?from=runner` (`from=runner` switches the page from homepage to wait-for-install; do not rely on probing 8930), and start clone/zip at the same time.
2. Prompt in English: accept the EULA, with https://steve02081504.github.io/fount/EULA/ (OSC 8 when stdout is a VT tty). `[Y/N]`.
3. Browser agree → `GET /eula` writes the accept file → CLI prints `Y`. CLI `Y` writes the same file (page polling `eula: accepted` closes the dialog).
4. `N`: kill the in-flight clone, run `fount remove` if `path/fount` exists else `rm` the tree, uninstall packages/apps pulled in only to open a browser, exit.
5. After accept (or `FOUNT_ACCEPT_EULA=1` / Docker, which skip the prompt, browser, and 8930): copy `default/config.json` → `data/config.json` if missing. That file is the “already past the gate” flag so path CLI does not re-enter `cmd_open`. Then `run.bat` / `run.sh`.

CI sets `FOUNT_ACCEPT_EULA=1`. There is no `--accept-EULA` flag.

## path CLI

No `data/config.json` (except `remove`): dispatcher always goes through `cmd_open` (prepends `open`). Same EULA + 8930 + wait page; `N` → `fount remove`. After accept, copy default `config.json` then dispatch the rest. See [path AGENTS](../../path/AGENTS.md).
