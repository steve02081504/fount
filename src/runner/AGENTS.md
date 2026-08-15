---
description: Installer runner (main.ps1 / main.sh) — first-install EULA gate, wait page, CI skip env
globs: src/runner/main.ps1,src/runner/main.sh
alwaysApply: false
---

# Installer runner

`src/runner/main.ps1` / `main.sh` (copied to GitHub Pages as `install.ps1` / `install.sh`). Polyglot stubs under `polyglot/` just exec these.

## First install (no `fount` on PATH)

Clone/zip **first** (progress and failures stay English — locale files are not on disk yet). Then source `path/src/i18n.{ps1,sh}` + `eula.{ps1,sh}` from the new tree and localize the rest. `:8930` stays up until the runner process exits (so the wait page does not treat a dropped probe as installer failure). `FOUNT_INSTALL_WAIT=1` is exported so path `cmd_open` does not open a second tab. Do not strip `open` from forwarded args.

1. Install git/curl/unzip as needed and clone or zip-download into `FOUNT_DIR`. Errors here are English.
2. Load i18n from `$FOUNT_DIR/src/public/locales`. If `FOUNT_ACCEPT_EULA` is unset and not Docker: fail when stdin is not a console; otherwise start `http://localhost:8930/` (alive probe + `GET /eula`), open `https://steve02081504.github.io/fount/wait/install/?from=runner` (`from=runner` switches the page from homepage to wait-for-install; do not rely on probing 8930), and prompt in the active locale. `[Y/N]`.
3. Browser agree → `GET /eula` writes the accept file → CLI prints `Y`. CLI `Y` writes the same file (page polling `eula: accepted` closes the dialog).
4. `N`: run `fount remove` if `path/fount` exists else `rm` the tree, uninstall packages/apps pulled in only to open a browser (not git/curl/wget/unzip used to clone or extract), exit.
5. After accept (or `FOUNT_ACCEPT_EULA=1` / Docker, which skip the prompt, browser, and 8930): copy `default/config.json` → `data/config.json` if missing. That file is the “already past the gate” flag so path CLI does not re-enter `ensure_fount_config`. Then `run.bat` / `run.sh`.

CI sets `FOUNT_ACCEPT_EULA=1`. There is no `--accept-EULA` flag.

## path CLI

No `data/config.json` (except `remove`): `ensure_fount_config` / `Ensure-FountConfig`, then the original command. Same EULA + 8930 + wait page; `N` → `fount remove`. `cmd_open` opens `wait?cold_bootting=true` only when `FOUNT_INSTALL_WAIT` is unset. See [path AGENTS](../../path/AGENTS.md).
