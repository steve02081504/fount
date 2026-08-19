---
description: path CLI — entries, updates, Termux, CI smoke, Start-Process gotchas
globs: path/**
alwaysApply: false
---

# path CLI

Thin entries `path/fount.{ps1,sh}` dispatch to `path/src/cmd/<name>.*` via inline `Test-Path` + dot-source in `index.{ps1,sh}` — no early-passthrough branch in entries. Each cmd loads its own deps (`require`). `path/src/**/*.ps1` exports use `function script:` (esh-style explicit scope).

| Bootstrap | Use |
| --- | --- |
| `bootstrap_full` | Full install / runtime |
| `bootstrap_server` | Server path (uses background updates) |
| `require_mid` + `source_uninstall_hooks` | `remove` |

`fount init` (and first install) registers a non-Steam shortcut when Steam is present — skip otherwise. Windows launchers use `$FOUNT_DIR/fount.exe` (written if missing, gitignored); other platforms use `path/fount`. `fount geneexe [path]` still defaults to `./fount.exe` (cwd). `remove` unregisters this install only (level 85, before Deno uninstall). No `data/config.json` (except `remove`) is `ensure_fount_config` / `Ensure-FountConfig` then the original command — not `cmd_open`. Interactive first-run starts `:8930` (wait/install liveness) and opens `wait/install/?from=runner`; `FOUNT_INSTALL_WAIT=1` is exported and `:8930` stays up until that process exits (after the dispatched command). `cmd_open` opens `wait?cold_bootting=true` only when that flag is unset. Docker / `FOUNT_ACCEPT_EULA` skip the prompt and copy default config. `N` → `fount remove`. See [runner AGENTS](../src/runner/AGENTS.md). `fount.exe` compile / Steam registration traps (ps12exe, favicon, `shortcuts.vdf`): [docs/exe-notes.md](docs/exe-notes.md).

Same logic is isomorphic across `foo.{ps1,sh}`; platform-only code under `path/src/win/` or `unix/`. Shared helpers: `in_container`, `run_with_updates`, `trap_terminal_teardown` (optional extra cleanup function name), `handle_docker_passthrough`, `check_temp_guard`, `sed_escape`.

`remove` scans `**/*.uninstall.<level>.*` under `path/src`, highest level first; level `0` deletes the install tree.

## Updates

- Sync: `update_fount_and_deno`. Background: `update_fount_and_deno_background` (after `data/installer/deno_upgraded`). `bootstrap_server` uses background; keepalive retries and exit-131 call sync before restart.
- `fount update` is the sync CLI (also how PS Start-Job re-enters). Plain update refreshes only the current branch via one-shot `git_fetch_remote_branch` (does **not** expand `remote.origin.fetch` to `refs/heads/*`).
- `fount version` prints branch (or detached HEAD), HEAD sha, optional remote tip, and ahead/behind via the same one-shot fetch. Detached HEAD skips remote compare; `.noupdate` is noted when present.
- `fount update <branch>` — checkout + remove `.noupdate`; unknown names `ls-remote` once then one-shot fetch.
- `fount update <sha>` — detach + create `.noupdate`.
- `fount update pr/<n>` (also `pull/<n>`, `#<n>`, or a GitHub PR URL) — fetch `refs/pull/<n>/head` into `origin/pr/<n>`, detach, create `.noupdate`. Re-run to refresh the tip.
- `fount update <remote-url>` — point `origin` at that URL and check out its default branch (tracking it), clearing `.noupdate`; subsequent plain updates follow it. Detected before branch names via `git_is_remote_url` (http(s)/ssh/git/ftp/file URLs and scp-like `user@host:path`).
- If the current upstream is confirmed gone on origin (not a network error), fall back to tracking `master`.
- Git / bash / Deno-template traps: [docs/git-notes.md](docs/git-notes.md).

## Termux

- `unix/termux.sh`: locale + sensor. On Termux, `env.sh` `require unix/termux` then `termux_apply_android_lang` (before i18n) — Android locale → `LANG`, unset `LC_ALL`. `android_locale_to_lang` stops at singleton extensions (`u`/`t`/`x`/…) and keeps the first region only.
- `termux_ensure_sensor_api` installs `termux-api` for `termux-sensor` when missing on `fount logo` / `log` / `server`; tracked in `auto_installed_system_packages` for uninstall. Logo gravity: [imgs/icon_anime/AGENTS.md](../imgs/icon_anime/AGENTS.md).

## CI smoke

CI-only `path-cmd-smoke`: [docs/ci-smoke.md](docs/ci-smoke.md). Harness sets `FOUNT_ACCEPT_EULA=1` so first-run `ensure_fount_config` / `Ensure-FountConfig` copies default `config.json` and does not prompt. `test-fount` init → `remove` fails if output matches [remove-noise.patterns](CI/remove-noise.patterns). pwsh harnesses in `path/test` run on Linux CI — set `$LastExitCode` directly; do not call `cmd.exe`.

## ShellCheck

`path/**/*.sh` is linted in the path suite. Install / cache / non-ASCII filename trap: [docs/shellcheck-notes.md](docs/shellcheck-notes.md).

## Start-Process `-ArgumentList`

Always a **single string** (`Get-FountPs1ArgumentList` / `Get-WTfountCmd`), never a PowerShell array — nested/empty elements bind as `""` and throw. Spawn failure: `-ErrorAction Stop` + try/catch → `exit 1` (PS often still exits 0 after a displayed error).
