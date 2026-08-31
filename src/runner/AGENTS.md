---
description: Installer runner (main.ps1 / main.sh) — first-install EULA gate, wait page, CI skip env
globs: src/runner/main.ps1,src/runner/main.sh
alwaysApply: false
---

# Installer runner

`src/runner/main.ps1` / `main.sh` (copied to GitHub Pages as `install.ps1` / `install.sh`). Polyglot stubs under `polyglot/` just exec these.

## Arch installation target

On Linux pacman hosts (excluding Termux), an explicit `FOUNT_DIR` wins; otherwise use the launcher on PATH or the default. Reuse a valid tree even without PATH registration. Reject an occupied unknown target before network or package operations. Stage clone retries / ZIP extraction, then copy all contents (including dotfiles) into an empty target without replacing its directory inode. Preserve cwd and relative CLI arguments. Other platforms retain their existing PATH-based discovery and installation flow; do not apply these target changes to the Windows runner.

## First install

Clone/zip **first** (progress and failures stay English — locale files are not on disk yet). Then source `path/src/i18n.{ps1,sh}` + `eula.{ps1,sh}` from the new tree and localize the rest. `:8930` stays up until the runner process exits (so the wait page does not treat a dropped probe as installer failure). `FOUNT_INSTALL_WAIT=1` is exported so path `cmd_open` does not open a second tab. Do not strip `open` from forwarded args.

1. Install git/curl/unzip as needed and clone or zip-download into `FOUNT_DIR` (staged on Arch as above). Errors here are English.
2. Load i18n from `$FOUNT_DIR/src/public/locales`. If `FOUNT_ACCEPT_EULA` is unset and not Docker: fail when stdin is not a console; otherwise start `http://localhost:8930/` (alive probe + `GET /eula`), open `https://steve02081504.github.io/fount/wait/install/?from=runner` (`from=runner` switches the page from homepage to wait-for-install; do not rely on probing 8930), and prompt in the active locale. `[Y/N]`.
3. Browser agree → `GET /eula` writes the accept file → CLI prints `Y`. CLI `Y` writes the same file (page polling `eula: accepted` closes the dialog).
4. On Linux pacman hosts (excluding Termux), `N` or unavailable console input exits without starting fount, removing files, or uninstalling packages. Other platforms retain the original refusal cleanup: `fount remove` or tree removal, then installer package cleanup.
5. After accept (or `FOUNT_ACCEPT_EULA=1` / Docker, which skip the prompt, browser, and 8930): copy `default/config.json` → `data/config.json` if missing. That file is the “already past the gate” flag so path CLI does not re-enter `ensure_fount_config`. Then `run.bat` / `run.sh`.

CI sets `FOUNT_ACCEPT_EULA=1`. There is no `--accept-EULA` flag.

## path CLI

No `data/config.json` (except `remove`): `ensure_fount_config` / `Ensure-FountConfig`, then the original command. Same EULA + 8930 + wait page; Linux pacman hosts (excluding Termux) preserve the installation on refusal, while other platforms retain `N` → `fount remove`. `cmd_open` opens `wait?cold_bootting=true` only when `FOUNT_INSTALL_WAIT` is unset. See [path AGENTS](../../path/AGENTS.md).

## `fount.exe` native child TTY ([ps12exe#59](https://github.com/steve02081504/ps12exe/issues/59))

The compiled runner (`& run.bat`) gives Deno/Node children a redirected stdout (`isTTY` false) even in a real console. `fount.exe logo` then no-ops and exits. Do not `Start-Process -NoNewWindow` or skip `canUseTui` as a workaround. After that issue closes: `fount geneexe`, then `fount.exe logo` must hold the TUI.
