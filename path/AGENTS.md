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

Same logic is isomorphic across `foo.{ps1,sh}`; platform-only code under `path/src/win/` or `unix/`. Shared helpers: `in_container`, `run_with_updates`, `trap_terminal_teardown`, `handle_docker_passthrough`, `check_temp_guard`, `sed_escape`.

`remove` scans `**/*.uninstall.<level>.*` under `path/src`, highest level first; level `0` deletes the install tree.

## Updates

- Sync: `update_fount_and_deno`. Background: `update_fount_and_deno_background` (after `data/installer/deno_upgraded`). `bootstrap_server` uses background; keepalive retries and exit-131 call sync before restart.
- `fount update` is the sync CLI (also how PS Start-Job re-enters).
- Plain update refreshes only the current branch via one-shot `git_fetch_remote_branch` (does **not** widen `remote.origin.fetch`).
- `fount update <branch>` checks out that branch and removes `.noupdate`; unknown names `ls-remote` once then the same one-shot fetch.
- `fount update <sha>` detaches at that commit and creates `.noupdate`.
- If the current upstream is confirmed gone on origin (not a network error), fall back to tracking `master`.
- `git_valid_branch_name` gates one-shot fetch/ls-remote. In bash `case` patterns, escape glob chars (`*\?*`, `*\**`) — do **not** quote them as `*'?'*` / `/'*|*'/'`; a dangling `'` makes `bash -n path/src/git.sh` fail and every sourced function vanish (`git_remote_branch_status: command not found`). Regression: `fount test path:git --no-parallel`.

## Termux

- `env.sh` sets `LANG` from `getprop persist.sys.locale` at CLI start (before i18n).
- `termux_ensure_sensor_api` (`unix/termux.sh`) installs `termux-api` for `termux-sensor` when missing on `fount logo` / `log` / `server`; tracked in `auto_installed_system_packages` for uninstall. Logo gravity details: [imgs/icon_anime/AGENTS.md](../imgs/icon_anime/AGENTS.md).

## CI smoke

`test_running.yaml` job `path-cmd-smoke` (CI-only):

1. `.github/path-ci/install-hooks.sh` stubs `src/server/index.mjs` / `src/log_viewer/index.mjs`.
2. `run-smoke.{sh,ps1}` exercises `server` / `background` / `log` / `reboot` / `init`.
3. `FOUNT_CLICK` via child `smoke-fount-click.ps1` (`function script:` stubs + capture file — not `global:`). Windows helper uses `powershell` (5.1); non-Windows uses `pwsh`. Windows → `Start-WTfountCmd`; non-Windows → `handle_unix_passthrough` → bash (`index.sh` `unset`s `FOUNT_CLICK`, never loads `win/wt`).
4. `restore-hooks.sh` on exit. Same workflow also runs remote init → `remove` (`test-fount`).

## Start-Process `-ArgumentList`

Always a **single string** (`Get-FountPs1ArgumentList` / `Get-WTfountCmd`), never a PowerShell array — nested/empty elements bind as `""` and throw. `Get-FountPs1ArgumentList` escapes each `@args` token (spaces / quotes / empty) then joins. Spawn failure: `-ErrorAction Stop` + try/catch → `exit 1` (PS often still exits 0 after a displayed error).
